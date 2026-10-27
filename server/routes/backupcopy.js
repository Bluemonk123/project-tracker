// Copy backups into a local folder on a schedule: another folder or disk on this computer, or a USB drive.
// Layout in the chosen folder:
//   database/tracker-YYYY-MM-DD_HHMM.db.gz   one compressed database copy per run
//   uploads/                                 mirror of uploaded files (new files are added, nothing is removed)
//   HOW TO RESTORE.txt
import { Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { db, getSetting, setSetting, BACKUP_DIR, UPLOAD_DIR } from '../db.js';
import { fail } from '../access.js';

const KEY = 'backup_copy'; // JSON { dir, hours, keep_days }
const LAST = 'backup_copy_last'; // JSON { at, ok, file, error, uploads_copied }

export function copyConfig() {
  try { return { hours: 4, keep_days: 30, dir: '', ...JSON.parse(getSetting(KEY) || '{}') }; } catch { return { hours: 4, keep_days: 30, dir: '' }; }
}
function lastResult() { try { return JSON.parse(getSetting(LAST) || 'null'); } catch { return null; } }

const README = `Project Tracker backups
=======================

database\\   one compressed copy of the database per run (newest has the latest date)
uploads\\    the files people attached to tasks and wiki pages

To restore, or to run the app on another computer with this data:
1. Stop Project Tracker.
2. Unpack the newest file in "database" (double-click it on a Mac; on Windows use 7-Zip),
   and rename the result to tracker.db.
3. Put tracker.db and the "uploads" folder into the app's "data" folder, replacing what is there.
4. Start Project Tracker.
`;

function checkFolder(dir) {
  if (!dir || !path.isAbsolute(dir)) fail(400, 'Enter the full path of the folder, e.g. C:\\Users\\you\\OneDrive\\Project Tracker Backups');
  const parent = path.dirname(dir);
  if (!fs.existsSync(dir) && !fs.existsSync(parent)) fail(400, `The folder ${parent} does not exist on this computer.`);
  fs.mkdirSync(dir, { recursive: true });
  const probe = path.join(dir, `.write-test-${process.pid}`);
  try { fs.writeFileSync(probe, 'ok'); fs.rmSync(probe); } catch { fail(400, `The app cannot write to ${dir}.`); }
}

let running = false;
export async function copyNow() {
  const cfg = copyConfig();
  if (!cfg.dir) throw new Error('No backup folder is set.');
  if (running) return lastResult();
  running = true;
  const stamp = new Date();
  const two = (n) => String(n).padStart(2, '0');
  const name = `tracker-${stamp.getFullYear()}-${two(stamp.getMonth() + 1)}-${two(stamp.getDate())}_${two(stamp.getHours())}${two(stamp.getMinutes())}.db.gz`;
  const snap = path.join(BACKUP_DIR, `.copy-${crypto.randomBytes(6).toString('hex')}.db`);
  let result;
  try {
    checkFolder(cfg.dir);
    const dbDir = path.join(cfg.dir, 'database');
    const upDir = path.join(cfg.dir, 'uploads');
    fs.mkdirSync(dbDir, { recursive: true });
    fs.mkdirSync(upDir, { recursive: true });
    db.exec(`VACUUM INTO '${snap.replace(/'/g, "''")}'`);
    // write under a temporary name first, so sync apps never pick up a half-written file
    const partial = path.join(dbDir, `.${name}.partial`);
    await pipeline(fs.createReadStream(snap), zlib.createGzip({ level: 9 }), fs.createWriteStream(partial));
    fs.renameSync(partial, path.join(dbDir, name));
    // uploaded files: copy new or changed ones only
    let copied = 0;
    for (const f of fs.readdirSync(UPLOAD_DIR)) {
      const src = path.join(UPLOAD_DIR, f), dst = path.join(upDir, f);
      const s = fs.statSync(src);
      if (!s.isFile()) continue;
      let d = null; try { d = fs.statSync(dst); } catch { /* new */ }
      if (d && d.size === s.size) continue;
      fs.copyFileSync(src, `${dst}.partial`); fs.renameSync(`${dst}.partial`, dst); copied++;
    }
    fs.writeFileSync(path.join(cfg.dir, 'HOW TO RESTORE.txt'), README.replace(/\n/g, os.EOL));
    // keep copies for keep_days days, and always the newest 5
    const copies = fs.readdirSync(dbDir).filter(f => /^tracker-.*\.db\.gz$/.test(f)).sort().reverse();
    const cutoff = Date.now() - cfg.keep_days * 86400e3;
    for (const f of copies.slice(5)) {
      const p = path.join(dbDir, f);
      if (fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { force: true });
    }
    result = { at: stamp.toISOString(), ok: true, file: name, size: fs.statSync(path.join(dbDir, name)).size, uploads_copied: copied };
  } catch (e) {
    result = { at: stamp.toISOString(), ok: false, error: e.message };
    console.error('Backup copy failed:', e.message);
  } finally {
    fs.rmSync(snap, { force: true });
    running = false;
  }
  setSetting(LAST, JSON.stringify(result));
  return result;
}

// Checked every 10 minutes: copy when the last successful copy is older than the chosen interval.
let lastOkAt = 0;
export function scheduleCopies() {
  const tick = () => {
    const cfg = copyConfig();
    if (!cfg.dir) return;
    const last = lastResult();
    if (last?.ok) lastOkAt = Math.max(lastOkAt, Date.parse(last.at));
    const lastTry = last ? Date.parse(last.at) : 0;
    const due = Date.now() - lastOkAt >= cfg.hours * 3600e3;
    const retry = !last?.ok && Date.now() - lastTry >= 30 * 60e3; // after a failure, retry every 30 minutes
    if (due && (last?.ok !== false || retry)) copyNow().catch(() => {});
  };
  setTimeout(tick, 20_000);
  setInterval(tick, 10 * 60e3).unref();
}

// Suggested folders: Documents on this computer, and the root of any other drive (a second disk or USB drive).
function suggestions() {
  const out = [path.join(os.homedir(), 'Documents', 'Project Tracker Backups')];
  if (process.platform === 'win32') {
    const appDrive = path.parse(BACKUP_DIR).root.toUpperCase();
    for (const l of 'DEFGHIJKLMNOPQRSTUVWXYZ') {
      const root = `${l}:\\`;
      if (root.toUpperCase() !== appDrive && fs.existsSync(root)) out.push(`${root}Project Tracker Backups`);
    }
  } else if (process.platform === 'darwin') {
    try { for (const v of fs.readdirSync('/Volumes')) if (v !== 'Macintosh HD') out.push(path.join('/Volumes', v, 'Project Tracker Backups')); } catch { /* ignore */ }
  }
  return out;
}

export const backupCopyRoutes = Router();
const adminOnly = (req) => { if (!req.user.is_admin) fail(403, 'Only administrators can manage backups.'); };

backupCopyRoutes.get('/admin/backup-copy', (req, res) => {
  adminOnly(req);
  res.json({ ...copyConfig(), last: lastResult(), suggestions: suggestions(), platform: process.platform, running });
});

backupCopyRoutes.put('/admin/backup-copy', async (req, res) => {
  adminOnly(req);
  const dir = String(req.body.dir || '').trim().replace(/^"(.*)"$/, '$1');
  const hours = [1, 2, 4, 6, 12, 24].includes(Number(req.body.hours)) ? Number(req.body.hours) : 4;
  const keep_days = Math.min(Math.max(parseInt(req.body.keep_days, 10) || 30, 1), 365);
  if (dir) checkFolder(dir);
  setSetting(KEY, JSON.stringify({ dir, hours, keep_days }));
  // first copy straight away so the person sees it work
  const last = dir ? await copyNow() : null;
  res.json({ ok: true, last });
});

backupCopyRoutes.post('/admin/backup-copy/run', async (req, res) => {
  adminOnly(req);
  if (!copyConfig().dir) fail(400, 'Choose a folder first.');
  res.json(await copyNow());
});
