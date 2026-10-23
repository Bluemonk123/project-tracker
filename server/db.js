import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DEFAULT_ROLES } from './permissions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(__dirname, '..');
export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT_DIR, 'data'));
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
export const BACKUP_DIR = path.join(DATA_DIR, 'backups');
export const DB_FILE = path.join(DATA_DIR, 'tracker.db');

for (const d of [DATA_DIR, UPLOAD_DIR, BACKUP_DIR]) fs.mkdirSync(d, { recursive: true });

export const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

// ---------- small query helpers ----------
const clean = (row) => (row ? { ...row } : row);
const norm = (params) => params.map(v => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));

export const get = (sql, ...params) => clean(db.prepare(sql).get(...norm(params)));
export const all = (sql, ...params) => db.prepare(sql).all(...norm(params)).map(clean);
export const run = (sql, ...params) => {
  const r = db.prepare(sql).run(...norm(params));
  return { id: Number(r.lastInsertRowid), changes: Number(r.changes) };
};

let txDepth = 0;
export function tx(fn) {
  if (txDepth > 0) return fn();
  txDepth++;
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    txDepth--;
  }
}

// ---------- passwords ----------
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}
export function verifyPassword(pw, stored) {
  const [, salt, hash] = String(stored).split('$');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(pw, salt, 64);
  const known = Buffer.from(hash, 'hex');
  return known.length === test.length && crypto.timingSafeEqual(known, test);
}

// ---------- settings ----------
export const getSetting = (key, fallback = null) => get('SELECT value FROM settings WHERE key = ?', key)?.value ?? fallback;
export const setSetting = (key, value) =>
  run('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, String(value));

// ---------- default reference data ----------
function seedDefaults() {
  tx(() => {
    if (!get('SELECT 1 AS x FROM roles LIMIT 1')) {
      DEFAULT_ROLES.forEach((r, i) =>
        run('INSERT INTO roles(name, scope, description, permissions, builtin, position) VALUES(?,?,?,?,?,?)',
          r.name, r.scope, r.description, JSON.stringify(r.permissions), r.builtin, i));
    }
    if (!get('SELECT 1 AS x FROM types LIMIT 1')) {
      [
        ['Task', '#3B6EA8', 0], ['Requirement', '#7A4FA3', 0], ['Feature', '#2F7A6B', 0],
        ['User story', '#2E8A9A', 0], ['Bug', '#C2453B', 0], ['Epic', '#B5662A', 0], ['Milestone', '#1F2933', 1],
      ].forEach(([n, c, m], i) => run('INSERT INTO types(name, color, is_milestone, position) VALUES(?,?,?,?)', n, c, m, i));
    }
    if (!get('SELECT 1 AS x FROM statuses LIMIT 1')) {
      [
        ['New', '#8A93A0', 0, 1, 0], ['In specification', '#9C7A2E', 0, 0, null], ['To do', '#5B6B85', 0, 0, null],
        ['In progress', '#3B6EA8', 0, 0, null], ['In review', '#7A4FA3', 0, 0, null], ['Tested', '#2E8A9A', 0, 0, null],
        ['On hold', '#B5662A', 0, 0, null], ['Done', '#2F7A4B', 1, 0, 100], ['Rejected', '#9AA1AB', 1, 0, null],
      ].forEach(([n, c, closed, def, ratio], i) =>
        run('INSERT INTO statuses(name, color, is_closed, is_default, done_ratio, position) VALUES(?,?,?,?,?,?)', n, c, closed, def, ratio, i));
    }
    if (!get('SELECT 1 AS x FROM priorities LIMIT 1')) {
      [['Low', '#8A93A0', 0], ['Normal', '#3B6EA8', 1], ['High', '#C98A1B', 0], ['Immediate', '#C2453B', 0]]
        .forEach(([n, c, d], i) => run('INSERT INTO priorities(name, color, is_default, position) VALUES(?,?,?,?)', n, c, d, i));
    }
    if (getSetting('app_name') === null) setSetting('app_name', 'Project Tracker');
    if (getSetting('time_activities') === null)
      setSetting('time_activities', JSON.stringify(['Development', 'Design', 'Testing', 'Meeting', 'Management', 'Support', 'Documentation', 'Other']));
  });
}
seedDefaults();

// One-off upgrades for databases created by older versions.
function migrate() {
  if (getSetting('migration_positions_v1') === null) {
    tx(() => {
      for (const name of ['Account manager', 'Business analyst']) {
        const r = DEFAULT_ROLES.find(x => x.name === name);
        if (!get("SELECT id FROM roles WHERE name = ? AND scope = 'project'", name)) {
          const pos = get('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM roles').p;
          run('INSERT INTO roles(name, scope, description, permissions, builtin, position) VALUES(?,?,?,?,0,?)',
            r.name, 'project', r.description, JSON.stringify(r.permissions), pos);
        }
      }
      // Existing project managers become the active PM of their project.
      for (const p of all(`SELECT p.id, p.manager_id, u.name FROM projects p JOIN users u ON u.id = p.manager_id
                           WHERE NOT EXISTS (SELECT 1 FROM project_positions pp WHERE pp.project_id = p.id AND pp.position = 'PM')`)) {
        run("INSERT INTO project_positions(project_id, position, user_id, user_name) VALUES(?, 'PM', ?, ?)", p.id, p.manager_id, p.name);
      }
      setSetting('migration_positions_v1', '1');
    });
  }
}
migrate();

// Remove expired sessions on start
run("DELETE FROM sessions WHERE expires_at < datetime('now')");

export function backupNow(label = 'manual') {
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const file = path.join(BACKUP_DIR, `tracker-${stamp}-${label}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return file;
}
