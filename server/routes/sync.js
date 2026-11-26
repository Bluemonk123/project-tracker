// Copy the live data to the staging copy on the office computer (sync-from-production.bat).
//
// On PRODUCTION an administrator creates a "sync key" (Administration → Backups → Copy live data to staging); only its
// SHA-256 is stored, it can be replaced or switched off at any time. With that key the script downloads the same full
// backup an administrator can download: GET /api/sync/full-backup.zip with header X-Sync-Key.
//
// On STAGING (APP_ENV=staging only) the script loads it: POST /api/sync/restore, accepted only from this computer
// (loopback, not through a proxy) and with the one-time token the staging app writes to data/.sync-local-token.
// The current local database is backed up first. After loading, the copy's email is switched off (no checking of the
// live support mailbox, no emails to real people from the test copy).
import { Router } from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { run, getSetting, setSetting, backupNow, replaceDatabase, UPLOAD_DIR, DATA_DIR } from '../db.js';
import { fail } from '../access.js';
import { zipBuffers, unzipBuffer, listFiles } from '../archive.js';

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const isStaging = () => String(process.env.APP_ENV || '').toLowerCase() === 'staging';

// --- production: download with the sync key (no sign-in) ---
export const syncPublicRoutes = Router();
const hits = [];
syncPublicRoutes.get('/sync/full-backup.zip', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const want = getSetting('sync_key_hash', '');
  const sent = String(req.get('x-sync-key') || '');
  const now = Date.now();
  while (hits.length && now - hits[0] > 3600e3) hits.shift();
  if (hits.length >= 20) fail(429, 'Too many downloads this hour. Try again later.');
  hits.push(now);
  if (!want || sent.length < 24) fail(403, 'Copying the live data is switched off, or the sync key is missing.');
  const a = Buffer.from(sha(sent)); const b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) fail(403, 'Wrong sync key.');
  const snap = backupNow('export');
  try {
    const entries = [['tracker.db', fs.readFileSync(snap)]];
    for (const [rel, full] of listFiles(UPLOAD_DIR)) entries.push([`uploads/${rel}`, fs.readFileSync(full)]);
    setSetting('sync_last_at', new Date().toISOString());
    res.setHeader('Content-Type', 'application/zip');
    res.send(zipBuffers(entries));
  } finally { fs.rmSync(snap, { force: true }); }
});

// --- production: administrators create / switch off the key ---
export const syncAdminRoutes = Router();
syncAdminRoutes.get('/admin/sync-key', (req, res) => {
  if (!req.user.is_admin) fail(403, 'Administrators only.');
  res.json({ on: !!getSetting('sync_key_hash', ''), created_at: getSetting('sync_key_at', '') || null, last_used: getSetting('sync_last_at', '') || null });
});
syncAdminRoutes.post('/admin/sync-key', (req, res) => {
  if (!req.user.is_admin) fail(403, 'Administrators only.');
  const key = `ptsync_${crypto.randomBytes(24).toString('hex')}`;
  setSetting('sync_key_hash', sha(key));
  setSetting('sync_key_at', new Date().toISOString());
  res.json({ key }); // shown once
});
syncAdminRoutes.delete('/admin/sync-key', (req, res) => {
  if (!req.user.is_admin) fail(403, 'Administrators only.');
  run("DELETE FROM settings WHERE key IN ('sync_key_hash', 'sync_key_at')");
  res.json({ ok: true });
});

// --- staging: load the downloaded backup (from this computer only) ---
const TOKEN_FILE = path.join(DATA_DIR, '.sync-local-token');
export function writeLocalSyncToken() {
  if (!isStaging()) return;
  try { fs.writeFileSync(TOKEN_FILE, crypto.randomBytes(24).toString('hex'), { mode: 0o600 }); } catch { /* the script then explains */ }
}
const loopback = (req) => /^(127\.|::1$|::ffff:127\.)/.test(req.socket.remoteAddress || '') && !req.get('x-forwarded-for');

export const syncLocalRoutes = Router();
syncLocalRoutes.post('/sync/restore', express.raw({ type: '*/*', limit: '2048mb' }), (req, res) => {
  if (!isStaging()) fail(404, 'Not found.');
  if (!loopback(req)) fail(403, 'Only the sync script on this computer can load a copy.');
  let token = '';
  try { token = fs.readFileSync(TOKEN_FILE, 'utf8').trim(); } catch { /* none */ }
  const sent = String(req.get('x-local-token') || '');
  if (!token || sent.length !== token.length || !crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(token))) fail(403, 'Wrong local token. Restart staging and run the script again.');
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || !buf.length) fail(400, 'No backup received.');
  let entries;
  try { entries = unzipBuffer(buf); } catch (e) { fail(400, `The download is not a full backup: ${e.message}`); }
  const dbEntry = entries.find(x => x.name === 'tracker.db');
  if (!dbEntry || dbEntry.data.subarray(0, 16).toString('latin1') !== 'SQLite format 3\u0000') fail(400, 'The download has no readable database.');
  const tmp = path.join(os.tmpdir(), `pt-sync-${process.pid}-${Date.now()}.db`);
  fs.writeFileSync(tmp, dbEntry.data);
  try {
    let people = 0;
    try { const t = new DatabaseSync(tmp, { readOnly: true }); people = t.prepare('SELECT COUNT(*) AS n FROM users').get().n; t.close(); }
    catch { fail(400, 'This is not a Project Tracker database.'); }
    const before = backupNow('before-sync');
    let files = 0;
    for (const f of entries.filter(x => x.name.startsWith('uploads/'))) {
      const dest = path.resolve(UPLOAD_DIR, f.name.slice('uploads/'.length));
      if (!dest.startsWith(path.resolve(UPLOAD_DIR) + path.sep)) continue;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, f.data); files++;
    }
    replaceDatabase(tmp);
    // the test copy must not read the live support mailbox or email real people
    try { const i = JSON.parse(getSetting('imap_config') || '{}') || {}; setSetting('imap_config', JSON.stringify({ ...i, enabled: false, pass: '' })); } catch { /* none */ }
    run("DELETE FROM settings WHERE key IN ('smtp_config', 'sync_key_hash', 'sync_key_at', 'backup_copy', 'cron_last_at')");
    run("UPDATE notifications SET email_state = 'skipped' WHERE email_state = 'pending'");
    setSetting('synced_from_production_at', new Date().toISOString());
    console.log(`  Loaded the live data: ${people} people, ${files} files (previous local data saved as ${path.basename(before)}).`);
    res.json({ ok: true, people, files, backup: path.basename(before) });
  } finally { fs.rmSync(tmp, { force: true }); }
});

export const syncInfo = () => ({ staging: isStaging(), synced_at: getSetting('synced_from_production_at', '') || null });
