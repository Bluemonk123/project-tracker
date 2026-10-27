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

  // Kanban board: every status belongs to one board column.
  if (!all('PRAGMA table_info(statuses)').some(c => c.name === 'board_column')) {
    db.exec('ALTER TABLE statuses ADD COLUMN board_column TEXT');
  }
  if (getSetting('migration_board_v1') === null) {
    tx(() => {
      const addBefore = (name, color, beforeName) => {
        if (get('SELECT id FROM statuses WHERE name = ?', name)) return;
        const ref = get('SELECT position FROM statuses WHERE name = ?', beforeName);
        const pos = ref ? ref.position - 0.5 : get('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM statuses').p;
        run('INSERT INTO statuses(name, color, is_closed, is_default, position) VALUES(?,?,0,0,?)', name, color, pos);
      };
      addBefore('In design', '#7A4FA3', 'In specification');
      addBefore('In testing', '#2E8A9A', 'In review');
      const map = {
        new: ['New', 'To do'], design: ['In design', 'In specification'], develop: ['In progress', 'On hold'],
        testing: ['In testing', 'In review', 'Tested'], closed: ['Done', 'Rejected'],
      };
      for (const [col, names] of Object.entries(map)) {
        for (const n of names) run('UPDATE statuses SET board_column = ? WHERE name = ? AND board_column IS NULL', col, n);
      }
      // anything else: closed statuses go to Closed, open ones to In Develop
      run("UPDATE statuses SET board_column = CASE WHEN is_closed = 1 THEN 'closed' ELSE 'develop' END WHERE board_column IS NULL");
      all('SELECT id FROM statuses ORDER BY position, id').forEach((s, i) => run('UPDATE statuses SET position = ? WHERE id = ?', i, s.id));
      setSetting('migration_board_v1', '1');
    });
  }

  // Design / Develop / Testing: one person per stage on every work package.
  const wpCols = all('PRAGMA table_info(work_packages)').map(c => c.name);
  for (const c of ['designer_id', 'developer_id', 'tester_id']) {
    if (!wpCols.includes(c)) db.exec(`ALTER TABLE work_packages ADD COLUMN ${c} INTEGER REFERENCES users(id) ON DELETE SET NULL`);
  }
  // Stage history for existing work, rebuilt from the status changes in the activity log.
  if (getSetting('migration_stages_v1') === null) {
    tx(() => {
      const colOf = Object.fromEntries(all('SELECT id, board_column FROM statuses').map(s => [s.id, s.board_column || 'develop']));
      for (const wp of all('SELECT id, status_id, author_id, created_at FROM work_packages WHERE id NOT IN (SELECT wp_id FROM wp_stages)')) {
        const moves = [];
        for (const j of all("SELECT user_id, changes, created_at FROM journals WHERE wp_id = ? AND changes LIKE '%status_id%' ORDER BY created_at, id", wp.id)) {
          try { const c = JSON.parse(j.changes).status_id; if (c) moves.push({ from: c[0], to: c[1], at: j.created_at, by: j.user_id }); } catch { /* ignore */ }
        }
        let stage = colOf[moves.length ? moves[0].from : wp.status_id] || 'new';
        let open = run('INSERT INTO wp_stages(wp_id, stage, user_id, entered_at) VALUES(?,?,?,?)', wp.id, stage, wp.author_id, wp.created_at).id;
        for (const m of moves) {
          const next = colOf[m.to] || stage;
          if (next === stage) continue;
          run('UPDATE wp_stages SET left_at = ? WHERE id = ?', m.at, open);
          open = run('INSERT INTO wp_stages(wp_id, stage, user_id, entered_at) VALUES(?,?,?,?)', wp.id, next, m.by, m.at).id;
          stage = next;
        }
      }
      setSetting('migration_stages_v1', '1');
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
