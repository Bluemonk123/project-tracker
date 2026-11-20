// Moving the app to another server.
//  GET  /admin/full-backup.zip  (administrators): the database plus every uploaded file, in one zip.
//  POST /setup/restore          (only on a new install with no accounts yet): load such a zip (or a single .db backup)
//                               instead of creating the first administrator. Everyone then signs in as before.
import { Router } from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import multer from 'multer';
import { DatabaseSync } from 'node:sqlite';
import { get, run, getSetting, setSetting, backupNow, replaceDatabase, UPLOAD_DIR, DB_FILE } from '../db.js';
import { fail } from '../access.js';
import { zipBuffers, unzipBuffer, listFiles } from '../archive.js';

export const fullBackupRoutes = Router();
fullBackupRoutes.get('/admin/full-backup.zip', (req, res) => {
  if (!req.user.is_admin) fail(403, 'Only administrators can download a full backup.');
  const snap = backupNow('export');
  try {
    const entries = [['tracker.db', fs.readFileSync(snap)]];
    for (const [rel, full] of listFiles(UPLOAD_DIR)) entries.push([`uploads/${rel}`, fs.readFileSync(full)]);
    const buf = zipBuffers(entries);
    const day = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="project-tracker-full-backup-${day}.zip"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(buf);
  } finally { fs.rmSync(snap, { force: true }); }
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2048 * 1024 * 1024 } });
export const restoreRoutes = Router();
restoreRoutes.post('/setup/restore', upload.single('file'), (req, res) => {
  if (get('SELECT COUNT(*) AS n FROM users').n > 0) fail(400, 'This app already has accounts, so a backup cannot be loaded here.');
  if (!req.file) fail(400, 'Choose the backup file.');
  const buf = req.file.buffer;
  let dbData; let files = [];
  if (buf.subarray(0, 16).toString('latin1') === 'SQLite format 3\u0000') dbData = buf;
  else {
    let entries;
    try { entries = unzipBuffer(buf); } catch (e) { fail(400, `${e.message} Choose the full backup (.zip) or a database backup (.db).`); }
    // the zip may have everything inside one folder (e.g. when zipped by hand)
    const dbEntry = entries.find(x => /(^|\/)tracker\.db$/.test(x.name)) || entries.find(x => x.name.endsWith('.db'));
    if (!dbEntry) fail(400, 'The zip has no database (tracker.db) in it.');
    dbData = dbEntry.data;
    const prefix = dbEntry.name.slice(0, dbEntry.name.length - path.basename(dbEntry.name).length);
    files = entries.filter(x => x.name.startsWith(`${prefix}uploads/`)).map(x => ({ rel: x.name.slice(prefix.length + 'uploads/'.length), data: x.data }));
  }
  if (dbData.subarray(0, 16).toString('latin1') !== 'SQLite format 3\u0000') fail(400, 'The database in this file is not readable.');

  // check it is a Project Tracker database with at least one administrator who can sign in
  const tmp = path.join(os.tmpdir(), `pt-restore-${process.pid}-${Date.now()}.db`);
  fs.writeFileSync(tmp, dbData);
  try {
    let admins = 0; let people = 0;
    try {
      const t = new DatabaseSync(tmp, { readOnly: true });
      people = t.prepare('SELECT COUNT(*) AS n FROM users').get().n;
      admins = t.prepare("SELECT COUNT(*) AS n FROM users WHERE is_admin = 1 AND status = 'active' AND password_hash IS NOT NULL AND password_hash <> ''").get().n;
      t.close();
    } catch { fail(400, 'This is not a Project Tracker database.'); }
    if (!admins) fail(400, 'This backup has no active administrator who can sign in.');

    // uploads first (paths kept inside the uploads folder), then the database
    for (const f of files) {
      const dest = path.resolve(UPLOAD_DIR, f.rel);
      if (!dest.startsWith(path.resolve(UPLOAD_DIR) + path.sep)) continue;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, f.data);
    }
    replaceDatabase(tmp);
    // a backup-copy folder from a Windows computer means nothing on this server
    try { const c = JSON.parse(getSetting('backup_copy') || 'null'); if (c?.dir && process.platform !== 'win32' && /^[A-Za-z]:[\\/]|^\\\\/.test(c.dir)) run("DELETE FROM settings WHERE key = 'backup_copy'"); } catch { /* ignore */ }
    setSetting('restored_at', new Date().toISOString());
    console.log(`  Restored a backup: ${people} people, ${files.length} uploaded files, into ${DB_FILE}`);
    res.json({ ok: true, people, files: files.length });
  } finally { fs.rmSync(tmp, { force: true }); }
});
