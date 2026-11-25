// Scheduled work: the daily database backup, the backup copy to another folder, and the support-mailbox check.
// Normally in-app timers run these. On hosting without background timers (e.g. Hostinger Cloud), set
// DISABLE_TIMERS=1 and CRON_KEY=<long random text>, then have the host's Cron Jobs call
//   https://<your-site>/api/cron?key=<CRON_KEY>      every 5 minutes.
// Each call does only the jobs that are due, so calling it often is harmless.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { BACKUP_DIR, backupNow, setSetting } from './db.js';
import { copyDue, scheduleCopies } from './routes/backupcopy.js';
import { inboundDue, scheduleInbound } from './inbound.js';
import { flushNotificationEmails } from './notifymail.js';

// Keep a daily copy of the database; prune to the newest 14 automatic backups.
export function autoBackup() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const existing = fs.readdirSync(BACKUP_DIR).filter(f => f.includes('-auto.db'));
    let ran = false;
    if (!existing.some(f => f.startsWith(`tracker-${today}`))) { backupNow('auto'); ran = true; }
    fs.readdirSync(BACKUP_DIR).filter(f => f.includes('-auto.db')).sort().reverse().slice(14)
      .forEach(f => fs.rmSync(path.join(BACKUP_DIR, f), { force: true }));
    return ran ? { ran: true, ok: true } : { skipped: 'already done today' };
  } catch (e) { console.error('Backup failed:', e.message); return { ran: true, ok: false, error: e.message }; }
}

let running = null;
export async function runDueJobs() {
  if (running) return { busy: true }; // a previous call is still working
  running = (async () => {
    const backup = autoBackup();
    const copy = await copyDue();
    const mailbox = await inboundDue();
    const notifications = await flushNotificationEmails().catch(e => ({ ok: false, error: e.message }));
    return { backup, copy, mailbox, notifications };
  })();
  try { return await running; } finally { running = null; }
}

export const timersDisabled = () => /^(1|true|yes)$/i.test(String(process.env.DISABLE_TIMERS || ''));

export function startTimers() {
  if (timersDisabled()) { console.log('  Background timers are off (DISABLE_TIMERS). Call /api/cron from the host\'s cron jobs.'); return; }
  setTimeout(autoBackup, 10_000);
  setInterval(autoBackup, 6 * 3600 * 1000).unref();
  scheduleCopies();
  scheduleInbound();
  setInterval(() => { flushNotificationEmails().catch(() => {}); }, 60_000).unref();
}

// GET /api/cron?key=...  (or header X-Cron-Key). Without CRON_KEY set, the address does not exist.
export async function cronHandler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const want = String(process.env.CRON_KEY || '');
  if (want.length < 16) return res.status(404).json({ error: 'Not found.' });
  const sent = String(req.get('x-cron-key') || req.query.key || '');
  const a = crypto.createHash('sha256').update(sent).digest();
  const b = crypto.createHash('sha256').update(want).digest();
  if (!crypto.timingSafeEqual(a, b)) return res.status(403).json({ error: 'Wrong key.' });
  const started = Date.now();
  setSetting('cron_last_at', new Date().toISOString()); // shown in Administration, to see that the host's cron job runs
  const jobs = await runDueJobs();
  res.json({ ok: true, at: new Date().toISOString(), ms: Date.now() - started, jobs });
}
