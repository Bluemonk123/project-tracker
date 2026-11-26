import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DEFAULT_ROLES, JOB_ROLES, CLIENT_VIEW } from './permissions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(__dirname, '..');
export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT_DIR, 'data'));
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
export const BACKUP_DIR = path.join(DATA_DIR, 'backups');
export const DB_FILE = path.join(DATA_DIR, 'tracker.db');

for (const d of [DATA_DIR, UPLOAD_DIR, BACKUP_DIR]) fs.mkdirSync(d, { recursive: true });

function openDb() {
  const d = new DatabaseSync(DB_FILE);
  d.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  d.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  return d;
}
export let db = openDb(); // (let: replaced when a full backup is restored on a new install)

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
        ['Task', '#3B6EA8', 0], ['Feature', '#2F7A6B', 0], ['Requirement', '#7A4FA3', 0], ['Enhancement', '#2E8A9A', 0],
        ['Bug', '#C2453B', 0], ['Epic', '#B5662A', 0], ['Milestone', '#1F2933', 1],
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
      [['P4 - Low', '#8A93A0', 0], ['P3 - Normal', '#3B6EA8', 1], ['P2 - High', '#C98A1B', 0], ['P1 - Immediate', '#C2453B', 0]]
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
      // (the role then called "Account manager" is "Project manager" in DEFAULT_ROLES now)
      const newNames = !!get("SELECT id FROM roles WHERE name = 'Product manager' AND scope = 'project'");
      for (const [name, def] of [['Account manager', 'Project manager'], ['Business analyst', 'Business analyst']]) {
        const r = DEFAULT_ROLES.find(x => x.name === def);
        const use = newNames ? def : name; // older databases get the old name; it is renamed further down
        if (!get("SELECT id FROM roles WHERE name = ? AND scope = 'project'", use)) {
          const pos = get('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM roles').p;
          run('INSERT INTO roles(name, scope, description, permissions, builtin, position) VALUES(?,?,?,?,0,?)',
            use, 'project', r.description, JSON.stringify(r.permissions), pos);
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

  // Design / Develop / Testing: one person per stage on every task.
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

  // Technologies: who last updated the version used, and permissions to manage / update them.
  const techCols = all('PRAGMA table_info(project_technologies)').map(c => c.name);
  if (!techCols.includes('version_updated_at')) db.exec('ALTER TABLE project_technologies ADD COLUMN version_updated_at TEXT');
  if (!techCols.includes('version_updated_by')) db.exec('ALTER TABLE project_technologies ADD COLUMN version_updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL');
  if (getSetting('migration_tech_perms_v1') === null) {
    tx(() => {
      // the full-rights role is "Project manager" in databases that still have "Account manager", else "Product manager"
      const fullRole = get("SELECT id FROM roles WHERE scope = 'project' AND name = 'Account manager'") ? 'Project manager' : 'Product manager';
      const grant = { [fullRole]: ['tech.manage', 'tech.version'], 'Team lead': ['tech.manage', 'tech.version'],
        'Business analyst': ['tech.version'], Developer: ['tech.version'] };
      for (const [name, keys] of Object.entries(grant)) {
        const role = get("SELECT id, permissions FROM roles WHERE scope = 'project' AND name = ?", name);
        if (!role) continue;
        let perms = []; try { perms = JSON.parse(role.permissions) || []; } catch { /* ignore */ }
        run('UPDATE roles SET permissions = ? WHERE id = ?', JSON.stringify([...new Set([...perms, ...keys])]), role.id);
      }
      setSetting('migration_tech_perms_v1', '1');
    });
  }

  // Project Board: customer name on projects, document slot on attachments, and who may edit / upload.
  const projCols = all('PRAGMA table_info(projects)').map(c => c.name);
  if (!projCols.includes('customer_name')) db.exec('ALTER TABLE projects ADD COLUMN customer_name TEXT');
  // Project Board details (go live, customer status, hosting / repository links, environments) as JSON
  if (!projCols.includes('board_data')) db.exec('ALTER TABLE projects ADD COLUMN board_data TEXT');
  const roleCols = all('PRAGMA table_info(project_customer_roles)').map(c => c.name);
  for (const c of ['pain_points', 'challenges', 'touch_points']) if (!roleCols.includes(c)) db.exec(`ALTER TABLE project_customer_roles ADD COLUMN ${c} TEXT`);
  // Project members: how much of the person's time goes to the project, in percent
  const pmCols = all('PRAGMA table_info(project_members)').map(c => c.name);
  if (!pmCols.includes('occupancy')) db.exec('ALTER TABLE project_members ADD COLUMN occupancy INTEGER');
  // Teams: member order, and each member's current and proposed roles (JSON lists)
  const tmCols = all('PRAGMA table_info(team_members)').map(c => c.name);
  for (const c of ['position INTEGER', 'current_roles TEXT', 'proposed_roles TEXT']) {
    if (!tmCols.includes(c.split(' ')[0])) db.exec(`ALTER TABLE team_members ADD COLUMN ${c}`);
  }
  // Approvals: when each approver marked it done, and who clicked Done
  const apCols = all('PRAGMA table_info(project_approvals)').map(c => c.name);
  for (const c of ['first_done_at TEXT', 'first_done_by INTEGER', 'second_done_at TEXT', 'second_done_by INTEGER', 'section_id INTEGER']) {
    if (!apCols.includes(c.split(' ')[0])) db.exec(`ALTER TABLE project_approvals ADD COLUMN ${c}`);
  }
  const attCols = all('PRAGMA table_info(attachments)').map(c => c.name);
  if (!attCols.includes('doc_slot')) db.exec('ALTER TABLE attachments ADD COLUMN doc_slot TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS idx_attach_docs ON attachments(container_type, container_id, doc_slot)');
  if (getSetting('migration_board_perms_v1') === null) {
    tx(() => {
      const grant = { 'Product manager': ['project.brief', 'project.documents'], 'Team lead': ['project.documents'],
        'Account manager': ['project.brief', 'project.documents'], 'Project manager': ['project.brief', 'project.documents'], 'Business analyst': ['project.brief', 'project.documents'] };
      for (const [name, keys] of Object.entries(grant)) {
        const role = get("SELECT id, permissions FROM roles WHERE scope = 'project' AND name = ?", name);
        if (!role) continue;
        let perms = []; try { perms = JSON.parse(role.permissions) || []; } catch { /* ignore */ }
        run('UPDATE roles SET permissions = ? WHERE id = ?', JSON.stringify([...new Set([...perms, ...keys])]), role.id);
      }
      setSetting('migration_board_perms_v1', '1');
    });
  }

  // Teams: the "Account Manager" role was renamed "Project Manager"
  if (getSetting('migration_team_role_pm_v1') === null) {
    run(`UPDATE team_members SET current_roles = replace(current_roles, '"Account Manager"', '"Project Manager"'),
         proposed_roles = replace(proposed_roles, '"Account Manager"', '"Project Manager"')`);
    setSetting('migration_team_role_pm_v1', '1');
  }  // Project roles renamed: "Project manager" -> "Product manager", then "Account manager" -> "Project manager".
  // Only on databases that still have "Account manager" (new databases are created with the new names).
  if (!getSetting('roles_pm_rename_v1')) {
    tx(() => {
      if (get("SELECT id FROM roles WHERE scope = 'project' AND name = 'Account manager'")) {
        run("UPDATE roles SET name = 'Product manager' WHERE scope = 'project' AND name = 'Project manager'");
        run("UPDATE roles SET name = 'Project manager' WHERE scope = 'project' AND name = 'Account manager'");
      }
      setSetting('roles_pm_rename_v1', '1');
    });
  }

  // Task Board: a last "Rejected" column. The existing Rejected status moves there (or one is added).
  if (getSetting('migration_rejected_col_v1') === null) {
    const rj = get("SELECT id FROM statuses WHERE lower(name) = 'rejected'");
    if (rj) run("UPDATE statuses SET board_column = 'rejected', is_closed = 1 WHERE id = ?", rj.id);
    else run("INSERT INTO statuses(name, color, is_closed, is_default, position, board_column) VALUES('Rejected', '#C25B6B', 1, 0, (SELECT COALESCE(MAX(position), 0) + 1 FROM statuses), 'rejected')");
    setSetting('migration_rejected_col_v1', '1');
  }
  // Task types in this order: Task, Feature, Requirement, Enhancement, Bug, Epic, Milestone.
  // Missing ones are added; any other type that no task uses is removed; one still in use is kept at the end.
  if (getSetting('migration_types_v2') === null) {
    tx(() => {
      const want = [['Task', '#3B6EA8', 0], ['Feature', '#2F7A6B', 0], ['Requirement', '#7A4FA3', 0], ['Enhancement', '#2E8A9A', 0],
        ['Bug', '#C2453B', 0], ['Epic', '#B5662A', 0], ['Milestone', '#1F2933', 1]];
      want.forEach(([n, c, m], i) => {
        const t = get('SELECT id FROM types WHERE lower(name) = lower(?)', n);
        if (t) run('UPDATE types SET name = ?, position = ? WHERE id = ?', n, i, t.id);
        else run('INSERT INTO types(name, color, is_milestone, position) VALUES(?,?,?,?)', n, c, m, i);
      });
      const names = want.map(w => w[0].toLowerCase());
      let pos = want.length;
      for (const t of all('SELECT id, name FROM types ORDER BY position, id')) {
        if (names.includes(t.name.toLowerCase())) continue;
        if (get('SELECT 1 AS x FROM work_packages WHERE type_id = ? LIMIT 1', t.id)) run('UPDATE types SET position = ? WHERE id = ?', pos++, t.id);
        else run('DELETE FROM types WHERE id = ?', t.id);
      }
      setSetting('migration_types_v2', '1');
    });
  }
  // Priorities get a P number (P1 highest), and tasks get a criticality (C1 highest)
  if (getSetting('migration_levels_v1') === null) {
    tx(() => {
      for (const [old, nw] of [['Immediate', 'P1 - Immediate'], ['High', 'P2 - High'], ['Normal', 'P3 - Normal'], ['Low', 'P4 - Low']]) {
        if (!get('SELECT 1 AS x FROM priorities WHERE name = ?', nw)) run('UPDATE priorities SET name = ? WHERE name = ?', nw, old);
      }
      if (!get('SELECT 1 AS x FROM criticalities LIMIT 1')) {
        [['C3', '#3B6EA8'], ['C2', '#C98A1B'], ['C1', '#C2453B']].forEach(([n, c], i) => run('INSERT INTO criticalities(name, color, position) VALUES(?,?,?)', n, c, i));
      }
      if (!all('PRAGMA table_info(work_packages)').some(c => c.name === 'criticality_id')) {
        db.exec('ALTER TABLE work_packages ADD COLUMN criticality_id INTEGER REFERENCES criticalities(id) ON DELETE SET NULL');
      }
      setSetting('migration_levels_v1', '1');
    });
  }
  // Tasks: who asked for the work, and when it was closed; remarks can name an author who has no account (imports)
  {
    const wcols = all('PRAGMA table_info(work_packages)').map(c => c.name);
    if (!wcols.includes('requested_by')) db.exec('ALTER TABLE work_packages ADD COLUMN requested_by TEXT');
    if (!wcols.includes('location')) db.exec('ALTER TABLE work_packages ADD COLUMN location TEXT'); // local / staging / production / external
    if (!wcols.includes('module')) db.exec('ALTER TABLE work_packages ADD COLUMN module TEXT'); // which part of the application
    if (!wcols.includes('solution')) db.exec('ALTER TABLE work_packages ADD COLUMN solution TEXT'); // how it was solved (the description is the problem)
    if (!wcols.includes('closed_on')) {
      db.exec('ALTER TABLE work_packages ADD COLUMN closed_on TEXT');
      run(`UPDATE work_packages SET closed_on = date(updated_at) WHERE status_id IN (SELECT id FROM statuses WHERE is_closed = 1)`);
    }
    if (!all('PRAGMA table_info(wp_remarks)').some(c => c.name === 'author_name')) db.exec('ALTER TABLE wp_remarks ADD COLUMN author_name TEXT');
    if (!all('PRAGMA table_info(journals)').some(c => c.name === 'author_name')) db.exec('ALTER TABLE journals ADD COLUMN author_name TEXT'); // comment author with no account (imports)
    // Remarks were folded into comments: each remark becomes a comment in the task's Activity, at its own time
    if (getSetting('migration_remarks_to_comments_v1') === null) {
      tx(() => {
        for (const r of all('SELECT r.*, u.name AS for_name FROM wp_remarks r LEFT JOIN users u ON u.id = r.user_id ORDER BY r.id')) {
          run('INSERT INTO journals(wp_id, user_id, notes, changes, created_at, author_name) VALUES(?,?,?,NULL,?,?)',
            r.wp_id, r.created_by, r.for_name ? `**For ${r.for_name}:** ${r.body}` : r.body, r.created_at, r.created_by ? null : r.author_name);
        }
        run('DELETE FROM wp_remarks');
        setSetting('migration_remarks_to_comments_v1', '1');
      });
    }
  }
  // ---------- Sprints: a task belongs to at most one sprint ----------
  if (!all('PRAGMA table_info(work_packages)').some(c => c.name === 'sprint_id')) db.exec('ALTER TABLE work_packages ADD COLUMN sprint_id INTEGER REFERENCES sprints(id) ON DELETE SET NULL');
  db.exec('CREATE INDEX IF NOT EXISTS idx_wp_sprint ON work_packages(sprint_id)');
  // each sprint belongs to a project, and optionally to one of its versions
  const spCols = all('PRAGMA table_info(sprints)').map(c => c.name);
  if (!spCols.includes('project_id')) db.exec('ALTER TABLE sprints ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE');
  if (!spCols.includes('version_id')) db.exec('ALTER TABLE sprints ADD COLUMN version_id INTEGER REFERENCES versions(id) ON DELETE SET NULL');
  // a sprint can cover several projects: they are kept in sprint_projects (sprints.project_id is no longer used)
  if (!getSetting('sprint_projects_v1')) {
    db.exec('INSERT OR IGNORE INTO sprint_projects(sprint_id, project_id) SELECT id, project_id FROM sprints WHERE project_id IS NOT NULL');
    setSetting('sprint_projects_v1', '1');
  }
  // ---------- Ticket Board (helpdesk) ----------
  const nCols = all('PRAGMA table_info(notifications)').map(c => c.name);
  if (!nCols.includes('ticket_id')) db.exec('ALTER TABLE notifications ADD COLUMN ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE');
  if (!nCols.includes('link')) db.exec('ALTER TABLE notifications ADD COLUMN link TEXT');
  // a ticket converted into a task stays linked to it
  if (!all('PRAGMA table_info(tickets)').some(c => c.name === 'wp_id')) db.exec('ALTER TABLE tickets ADD COLUMN wp_id INTEGER REFERENCES work_packages(id) ON DELETE SET NULL');
  db.exec('CREATE INDEX IF NOT EXISTS idx_tickets_wp ON tickets(wp_id)');
  // tickets raised by email keep the email's Message-ID (so the same email is never added twice)
  if (!all('PRAGMA table_info(tickets)').some(c => c.name === 'email_message_id')) db.exec('ALTER TABLE tickets ADD COLUMN email_message_id TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS idx_tickets_msgid ON tickets(email_message_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_ticket_messages_msgid ON ticket_messages(email_message_id)');
  // where a task came from: project (created in the project), ticket, or email (a ticket that arrived by email)
  if (!all('PRAGMA table_info(work_packages)').some(c => c.name === 'source')) {
    db.exec("ALTER TABLE work_packages ADD COLUMN source TEXT NOT NULL DEFAULT 'project'");
    run(`UPDATE work_packages SET source = CASE WHEN (SELECT channel FROM tickets t WHERE t.wp_id = work_packages.id LIMIT 1) = 'email' THEN 'email' ELSE 'ticket' END
         WHERE id IN (SELECT wp_id FROM tickets WHERE wp_id IS NOT NULL)`);
  }
  for (const [k, v] of [['ticket_sla_hours_urgent', 4], ['ticket_sla_hours_high', 8], ['ticket_sla_hours_normal', 24]]) {
    if (getSetting(k) === null) setSetting(k, v);
  }
  // Groups: add the standard ones that were never added; one an admin deactivated stays as it is.
  const seeded = (() => { try { return JSON.parse(getSetting('ticket_groups_seeded') || '[]'); } catch { return []; } })();
  ['Support', 'Development', 'Training', 'Research'].forEach((g, i) => {
    if (seeded.includes(g)) return;
    run('INSERT OR IGNORE INTO ticket_groups(name, active, position) VALUES(?, 1, ?)', g, i);
    seeded.push(g);
  });
  setSetting('ticket_groups_seeded', JSON.stringify(seeded));
  if (getSetting('ticket_macros_seeded') === null) {
    run(`INSERT INTO ticket_macros(name, body_template, set_status, is_internal, display_order) VALUES(?,?,?,0,1)`, 'Ask for more details',
      'Hi {customer_first_name},\n\nThanks for raising ticket {ticket_id}. Could you share a few more details (steps, screenshots) so we can look into it?\n\nRegards,\n{agent_first_name}', 'pending');
    run(`INSERT INTO ticket_macros(name, body_template, set_status, is_internal, display_order) VALUES(?,?,?,0,2)`, 'Solved',
      'Hi {customer_first_name},\n\nTicket {ticket_id} is now fixed. Reply here if anything still looks wrong.\n\nRegards,\n{agent_first_name}', 'solved');
    setSetting('ticket_macros_seeded', '1');
  }
  // One-time move: tasks raised with the earlier "New Ticket" button (type or status "Ticket") become helpdesk tickets,
  // and the Ticket column, status and type leave the Task Board. Finds nothing to do on later runs.
  if (getSetting('migration_helpdesk_v1') === null) {
    tx(() => {
      const iso = (t) => (t ? (String(t).includes('T') ? String(t) : String(t).replace(' ', 'T') + 'Z') : new Date().toISOString());
      const tStatus = all("SELECT id FROM statuses WHERE board_column = 'tickets'").map(r => r.id);
      const tType = get("SELECT id FROM types WHERE name = 'Ticket'")?.id || null;
      const wps = all(`SELECT w.*, s.is_closed, u.name AS author_name, u.email AS author_email FROM work_packages w
                       JOIN statuses s ON s.id = w.status_id LEFT JOIN users u ON u.id = w.author_id
                       WHERE w.type_id = ? OR w.status_id IN (${tStatus.map(() => '?').join(',') || 'NULL'})`, tType, ...tStatus);
      const defStatus = get("SELECT id FROM statuses WHERE is_default = 1 AND (board_column IS NULL OR board_column <> 'tickets') ORDER BY position LIMIT 1")?.id
        || get("SELECT id FROM statuses WHERE board_column IS NULL OR board_column <> 'tickets' ORDER BY position LIMIT 1")?.id;
      const defType = get("SELECT id FROM types WHERE name <> 'Ticket' ORDER BY position LIMIT 1")?.id;
      for (const w of wps) {
        const no = get('SELECT COALESCE(MAX(ticket_no), 10000000) + 1 AS n FROM tickets').n;
        const solved = w.is_closed ? 1 : 0;
        const tid = run(`INSERT INTO tickets(ticket_no, status, subject, feedback, priority, ticket_type, group_name, channel, source,
                           requester_kind, requester_user_id, raised_by, requester_email, assignee_id, raised_on, solved_at, created_by, created_at, updated_at)
                         VALUES(?,?,?,?,'normal','issue','Support','web','task board','staff',?,?,?,?,?,?,?,?,?)`,
          no, solved ? 'solved' : 'open', String(w.subject || '').slice(0, 200), String(w.description || w.subject || '(no description)').slice(0, 5000),
          w.author_id, w.author_name || 'Unknown', w.author_email, w.assignee_id, iso(w.created_at), solved ? iso(w.updated_at) : null,
          w.author_id, iso(w.created_at), iso(w.updated_at)).id;
        run(`INSERT INTO ticket_messages(ticket_id, author_type, author_name, body, created_at) VALUES(?, 'system', 'System', ?, ?)`,
          tid, `Moved from the Task Board (${w.subject})`, new Date().toISOString());
        for (const a of all("SELECT * FROM attachments WHERE container_type = 'wp' AND container_id = ?", w.id)) {
          run(`INSERT INTO ticket_attachments(ticket_id, file_name, stored_name, mime_type, size_bytes, uploaded_by, created_at) VALUES(?,?,?,?,?,?,?)`,
            tid, a.filename, a.stored_name, a.content_type, a.size, a.uploaded_by, iso(a.created_at));
        }
        // keep a task that has time logged on it (as an ordinary task); remove the rest
        if (get('SELECT 1 AS x FROM time_entries WHERE wp_id = ? LIMIT 1', w.id)) {
          run('UPDATE work_packages SET status_id = CASE WHEN status_id IN (' + (tStatus.join(',') || 'NULL') + ') THEN ? ELSE status_id END, type_id = CASE WHEN type_id = ? THEN ? ELSE type_id END WHERE id = ?',
            defStatus, tType, defType, w.id);
        } else {
          run("DELETE FROM attachments WHERE container_type = 'wp' AND container_id = ?", w.id); // the files now belong to the ticket
          run('DELETE FROM work_packages WHERE id = ?', w.id);
        }
      }
      for (const sid of tStatus) if (!get('SELECT 1 AS x FROM work_packages WHERE status_id = ? LIMIT 1', sid)) run('DELETE FROM statuses WHERE id = ?', sid);
      if (tType && !get('SELECT 1 AS x FROM work_packages WHERE type_id = ? LIMIT 1', tType)) run('DELETE FROM types WHERE id = ?', tType);
      setSetting('migration_helpdesk_v1', String(wps.length));
    });
  }
  // Modules list: start from the modules the tasks already use
  if (!getSetting('project_modules_v1')) {
    db.exec("INSERT OR IGNORE INTO project_modules(project_id, name) SELECT project_id, TRIM(module) FROM work_packages WHERE TRIM(COALESCE(module, '')) <> '' GROUP BY project_id, LOWER(TRIM(module))");
    setSetting('project_modules_v1', '1');
  }
  // Email copies of notifications: per-notification state, and each person's choice (on unless turned off)
  if (!all('PRAGMA table_info(notifications)').some(c => c.name === 'email_state')) db.exec('ALTER TABLE notifications ADD COLUMN email_state TEXT');
  if (!all('PRAGMA table_info(users)').some(c => c.name === 'email_notify')) db.exec('ALTER TABLE users ADD COLUMN email_notify INTEGER NOT NULL DEFAULT 1');
  db.exec("CREATE INDEX IF NOT EXISTS idx_notif_email ON notifications(email_state) WHERE email_state = 'pending'");
  // Data Security tab: roles that manage the tech stack may also update the security checks
  if (!getSetting('migration_security_perm_v1')) {
    tx(() => {
      for (const role of all("SELECT id, permissions FROM roles WHERE scope = 'project'")) {
        let perms = []; try { perms = JSON.parse(role.permissions) || []; } catch { /* ignore */ }
        if (perms.includes('tech.manage') && !perms.includes('security.manage')) run('UPDATE roles SET permissions = ? WHERE id = ?', JSON.stringify([...perms, 'security.manage']), role.id);
      }
      setSetting('migration_security_perm_v1', '1');
    });
  }

  // Ticket roles (Administration → Roles → Ticket roles) and four new project permissions. Nobody loses access:
  //  - the roles table accepts scope 'ticket' (rebuilt once; SQLite cannot change a CHECK in place)
  //  - users get ticket_role_id; whoever had Ticket Board permissions in their global role gets a ticket role
  //    with the same permissions, and those permissions leave the global roles
  //  - roles that could already plan sprints / upload / edit modules / see the Project Board get the new keys
  if (!getSetting('migration_ticket_roles_v1')) {
    const rolesSql = get("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'roles'")?.sql || '';
    if (!rolesSql.includes("'ticket'")) {
      db.exec('PRAGMA foreign_keys = OFF');
      try {
        tx(() => {
          db.exec(`CREATE TABLE roles_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
            scope TEXT NOT NULL CHECK (scope IN ('global','project','ticket')),
            description TEXT, permissions TEXT NOT NULL DEFAULT '[]', builtin INTEGER NOT NULL DEFAULT 0,
            position INTEGER NOT NULL DEFAULT 0, UNIQUE (name, scope))`);
          db.exec('INSERT INTO roles_new(id, name, scope, description, permissions, builtin, position) SELECT id, name, scope, description, permissions, builtin, position FROM roles');
          db.exec('DROP TABLE roles');
          db.exec('ALTER TABLE roles_new RENAME TO roles');
        });
      } finally { db.exec('PRAGMA foreign_keys = ON'); }
    }
    if (!all('PRAGMA table_info(users)').some(c => c.name === 'ticket_role_id')) db.exec('ALTER TABLE users ADD COLUMN ticket_role_id INTEGER REFERENCES roles(id) ON DELETE SET NULL');
    tx(() => {
      const TICKET = ['tickets.view', 'tickets.create', 'tickets.edit'];
      const list = (v) => { try { return JSON.parse(v) || []; } catch { return []; } };
      const ensureRole = (name, perms, description, builtin = 0) => {
        const r = get("SELECT id FROM roles WHERE scope = 'ticket' AND name = ?", name);
        if (r) return r.id;
        const pos = get("SELECT COALESCE(MAX(position), 0) + 1 AS p FROM roles WHERE scope = 'ticket'").p;
        return run("INSERT INTO roles(name, scope, description, permissions, builtin, position) VALUES(?, 'ticket', ?, ?, ?, ?)", name, description, JSON.stringify(perms), builtin, pos).id;
      };
      const agent = ensureRole('Support agent', TICKET, 'Works on tickets: sees the Ticket Board, creates, replies and changes tickets.', 1);
      const viewer = ensureRole('Support viewer', ['tickets.view'], 'Sees the Ticket Board and tickets, without changing them.');
      for (const g of all("SELECT id, name, permissions FROM roles WHERE scope = 'global'")) {
        const perms = list(g.permissions);
        const t = TICKET.filter(k => perms.includes(k));
        if (t.length) {
          const same = (a, b) => a.length === b.length && a.every(k => b.includes(k));
          const roleId = same(t, TICKET) ? agent : same(t, ['tickets.view']) ? viewer
            : ensureRole(`Ticket access (${g.name})`, t, `Created from the "${g.name}" global role.`);
          run('UPDATE users SET ticket_role_id = ? WHERE global_role_id = ? AND ticket_role_id IS NULL', roleId, g.id);
        }
        run('UPDATE roles SET permissions = ? WHERE id = ?', JSON.stringify(perms.filter(k => !TICKET.includes(k))), g.id);
      }
      // new project permissions, given where the same thing was allowed before
      for (const r of all("SELECT id, scope, permissions FROM roles WHERE scope IN ('global','project')")) {
        const p = new Set(list(r.permissions));
        const before = p.size;
        if (p.has('wp.edit') || p.has('wp.edit_own')) p.add('sprint.manage');
        if (p.has('wp.create')) p.add('wp.import');
        if (p.has('wp.edit') || p.has('project.brief')) p.add('modules.manage');
        if (p.has('project.view') || [...p].some(k => /^(wp|project|meetings|wiki|time|tech|security|files|news)\./.test(k))) p.add('board.view');
        if (p.size !== before) run('UPDATE roles SET permissions = ? WHERE id = ?', JSON.stringify([...p]), r.id);
      }
      setSetting('migration_ticket_roles_v1', '1');
    });
  }
  // "Change the assignee" became its own ticket permission: roles that could work on tickets keep being able to assign
  if (!getSetting('migration_ticket_assign_v1')) {
    tx(() => {
      for (const r of all("SELECT id, permissions FROM roles WHERE scope = 'ticket'")) {
        let p = []; try { p = JSON.parse(r.permissions) || []; } catch { /* ignore */ }
        if (p.includes('tickets.edit') && !p.includes('tickets.assign')) run('UPDATE roles SET permissions = ? WHERE id = ?', JSON.stringify([...p, 'tickets.assign']), r.id);
      }
      setSetting('migration_ticket_assign_v1', '1');
    });
  }
  if (!all('PRAGMA table_info(users)').some(c => c.name === 'ticket_access')) db.exec("ALTER TABLE users ADD COLUMN ticket_access TEXT");
  // Ticket roles folded back into global roles (simpler: one role per person + project roles). Each person keeps
  // their access: if everyone with a global role shared the same ticket role, its permissions join that global role;
  // otherwise those people move to a copy "<global role> + <ticket role>". Then the ticket roles are removed.
  if (!getSetting('migration_ticket_roles_merge_v1')) {
    tx(() => {
      const list = (v) => { try { return JSON.parse(v) || []; } catch { return []; } };
      const tRoles = new Map(all("SELECT id, name, permissions FROM roles WHERE scope = 'ticket'").map(r => [r.id, r]));
      if (all('PRAGMA table_info(users)').some(c => c.name === 'ticket_role_id')) {
        const groups = all('SELECT global_role_id AS g, ticket_role_id AS t, COUNT(*) AS n FROM users WHERE ticket_role_id IS NOT NULL GROUP BY global_role_id, ticket_role_id');
        for (const { g, t } of groups) {
          const tr = tRoles.get(t); if (!tr) continue;
          const tp = list(tr.permissions).filter(k => k.startsWith('tickets.'));
          const gr = g ? get("SELECT * FROM roles WHERE id = ? AND scope = 'global'", g) : null;
          const total = g ? get('SELECT COUNT(*) AS n FROM users WHERE global_role_id = ?', g).n : 0;
          const same = g ? get('SELECT COUNT(*) AS n FROM users WHERE global_role_id = ? AND ticket_role_id = ?', g, t).n : 0;
          if (gr && total === same) {
            run('UPDATE roles SET permissions = ? WHERE id = ?', JSON.stringify([...new Set([...list(gr.permissions), ...tp])]), gr.id);
          } else {
            const name = `${gr?.name || 'Staff'} + ${tr.name}`;
            let copy = get("SELECT id FROM roles WHERE scope = 'global' AND name = ?", name);
            if (!copy) {
              const pos = get("SELECT COALESCE(MAX(position), 0) + 1 AS p FROM roles WHERE scope = 'global'").p;
              copy = { id: run("INSERT INTO roles(name, scope, description, permissions, builtin, position) VALUES(?, 'global', ?, ?, 0, ?)",
                name, `${gr?.description || ''} Also: ${tr.name}.`.trim(), JSON.stringify([...new Set([...list(gr?.permissions), ...tp])]), pos).id };
            }
            if (g) run('UPDATE users SET global_role_id = ? WHERE global_role_id = ? AND ticket_role_id = ?', copy.id, g, t);
            else run('UPDATE users SET global_role_id = ? WHERE global_role_id IS NULL AND ticket_role_id = ?', copy.id, t);
          }
        }
        run('UPDATE users SET ticket_role_id = NULL');
      }
      run("DELETE FROM roles WHERE scope = 'ticket'");
      setSetting('migration_ticket_roles_merge_v1', '1');
    });
  }

  // ONE role list (the job roles: Backend Developer, Frontend Developer, ... plus Client (view only)) replaces
  // the global roles (Manager / Employee) and the old project roles. Each person has their own roles (users.role_ids,
  // also shown as "Current role" on the Teams page) and "Sees all projects"; each project membership has one role
  // from the same list. Nobody loses access:
  //  - old project roles are renamed (memberships keep them); missing job roles are created from the closest one
  //  - the Teams page "current roles" become each person's roles
  //  - people with a global role that had permissions (e.g. Manager) get a role with the same permissions and,
  //    if it had project permissions, "Sees all projects"
  if (!all('PRAGMA table_info(users)').some(c => c.name === 'role_ids')) db.exec('ALTER TABLE users ADD COLUMN role_ids TEXT');
  if (!all('PRAGMA table_info(users)').some(c => c.name === 'all_projects')) db.exec('ALTER TABLE users ADD COLUMN all_projects INTEGER NOT NULL DEFAULT 0');
  if (!getSetting('migration_single_roles_v1')) {
    if (get('SELECT 1 AS x FROM users LIMIT 1')) { try { backupNow('before-roles-change'); } catch { /* backup folder not ready */ } }
    tx(() => {
      const list = (v) => { try { return JSON.parse(v) || []; } catch { return []; } };
      const byName = (n) => get("SELECT * FROM roles WHERE scope = 'project' AND name = ?", n);
      for (const [from, to] of [['Product manager', 'Product Manager'], ['Project manager', 'Project Manager'], ['Business analyst', 'Business Analyst'],
        ['QA / Tester', 'Functional Testing'], ['Developer', 'Backend Developer'], ['Viewer', 'Client (view only)']]) {
        const r = byName(from);
        if (r && !byName(to)) run('UPDATE roles SET name = ? WHERE id = ?', to, r.id);
      }
      const client = byName('Client (view only)');
      if (client) run('UPDATE roles SET permissions = ?, description = ? WHERE id = ?', JSON.stringify(CLIENT_VIEW), 'Customers and stakeholders: can see the project and its tasks, nothing else.', client.id);
      const copyFrom = { 'Frontend Developer': 'Backend Developer', DevOps: 'Backend Developer', 'System Admin': 'Backend Developer', UAT: 'Functional Testing',
        'Product Master': 'Product Manager', 'Client Facing': 'Project Manager', 'Backend Developer': null, 'Functional Testing': null,
        'Product Manager': null, 'Project Manager': null, 'Business Analyst': null, 'Client (view only)': null };
      for (const name of [...JOB_ROLES, 'Client (view only)']) {
        if (byName(name)) continue;
        const src = copyFrom[name] ? byName(copyFrom[name]) : null;
        run("INSERT INTO roles(name, scope, description, permissions, builtin, position) VALUES(?, 'project', ?, ?, 0, 0)",
          name, src ? `Started as a copy of ${src.name}.` : null, src ? src.permissions : JSON.stringify(name === 'Client (view only)' ? CLIENT_VIEW : []));
      }
      const lead = byName('Team lead');
      if (lead && !get('SELECT 1 AS x FROM project_members WHERE role_id = ?', lead.id)) run('DELETE FROM roles WHERE id = ?', lead.id);
      // each person's roles = their current roles on the Teams page
      const ids = new Map(all("SELECT id, name FROM roles WHERE scope = 'project'").map(r => [r.name.toLowerCase(), r.id]));
      for (const u of all('SELECT id FROM users')) {
        const names = new Set(all('SELECT current_roles FROM team_members WHERE user_id = ?', u.id).flatMap(t => list(t.current_roles)));
        const mine = [...names].map(n => ids.get(String(n).toLowerCase())).filter(Boolean);
        run('UPDATE users SET role_ids = ? WHERE id = ?', JSON.stringify([...new Set(mine)]), u.id);
      }
      // global roles with permissions (e.g. Manager): same permissions as a role in the list
      for (const g of all("SELECT * FROM roles WHERE scope = 'global'")) {
        const perms = list(g.permissions);
        const users = all('SELECT id, role_ids FROM users WHERE global_role_id = ? AND is_admin = 0', g.id);
        if (!perms.length || !users.length) continue;
        let r = byName(g.name);
        if (!r) r = { id: run("INSERT INTO roles(name, scope, description, permissions, builtin, position) VALUES(?, 'project', ?, ?, 0, 0)", g.name, g.description, g.permissions).id };
        const seesAll = perms.some(k => !/^(admin|teams|projects|reports|tickets)\./.test(k)) ? 1 : 0;
        for (const u of users) run('UPDATE users SET role_ids = ?, all_projects = MAX(all_projects, ?) WHERE id = ?', JSON.stringify([...new Set([...list(u.role_ids), r.id])]), seesAll, u.id);
      }
      // Developer memberships of people who are Frontend (not Backend) developers on the Teams page
      const be = byName('Backend Developer'); const fe = byName('Frontend Developer');
      if (be && fe) {
        for (const m of all('SELECT pm.project_id, pm.user_id, u.role_ids FROM project_members pm JOIN users u ON u.id = pm.user_id WHERE pm.role_id = ?', be.id)) {
          const mine = list(m.role_ids);
          if (mine.includes(fe.id) && !mine.includes(be.id)) run('UPDATE project_members SET role_id = ? WHERE project_id = ? AND user_id = ?', fe.id, m.project_id, m.user_id);
        }
      }
      // order: job roles as on the Teams page, then Client (view only), then the rest
      const order = [...JOB_ROLES, 'Client (view only)'];
      all("SELECT id, name FROM roles WHERE scope = 'project' ORDER BY position, id").forEach((r, i) => {
        const at = order.indexOf(r.name);
        run('UPDATE roles SET position = ?, builtin = 0 WHERE id = ?', at >= 0 ? at : order.length + i, r.id);
      });
      setSetting('migration_single_roles_v1', '1');
    });
  }
  // Tickets by email: the whole original email (.eml file in the uploads folder), to read the full mail trail
  db.exec(`CREATE TABLE IF NOT EXISTS ticket_emails (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    message_id INTEGER REFERENCES ticket_messages(id) ON DELETE CASCADE,
    stored_name TEXT NOT NULL, from_addr TEXT, subject TEXT, sent_at TEXT, size_bytes INTEGER, created_at TEXT NOT NULL)`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_ticket_emails ON ticket_emails(ticket_id)');
  // Priorities: "no timeline" (P0 - Not Required: no due date is set or calculated). The TAT of each priority (working
  // days) is kept in the working calendar (calendar.js) and edited in Administration → Priorities.
  if (!all('PRAGMA table_info(priorities)').some(c => c.name === 'no_timeline')) db.exec('ALTER TABLE priorities ADD COLUMN no_timeline INTEGER NOT NULL DEFAULT 0');
  if (!getSetting('migration_p0_v1')) {
    if (!get("SELECT 1 AS x FROM priorities WHERE no_timeline = 1 OR name LIKE 'P0%'")) {
      run('UPDATE priorities SET position = position + 1');
      run("INSERT INTO priorities(name, color, is_default, position, no_timeline) VALUES('P0 - Not Required', '#8A94A6', 0, 0, 1)");
    }
    setSetting('migration_p0_v1', '1');
  }
  // Research: requirements and research with solution / reference files and notes
  db.exec(`CREATE TABLE IF NOT EXISTS research_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT, stage TEXT NOT NULL DEFAULT 'new',
    assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL, requestor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reviewer_id INTEGER REFERENCES users(id) ON DELETE SET NULL, created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  db.exec(`CREATE TABLE IF NOT EXISTS research_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL REFERENCES research_items(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('solution', 'reference')), filename TEXT NOT NULL, stored_name TEXT NOT NULL,
    content_type TEXT, size INTEGER, uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL)`);
  db.exec(`CREATE TABLE IF NOT EXISTS research_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL REFERENCES research_items(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, body TEXT NOT NULL, created_at TEXT NOT NULL)`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_research_files ON research_files(item_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_research_notes ON research_notes(item_id)');
  // Role list order (leadership, planning, build, testing, kept roles, outside people) and plain descriptions
  if (!getSetting('migration_role_order_v1')) {
    tx(() => {
      const order = ['Product Master', 'Product Manager', 'Project Manager', 'Business Analyst', 'Client Facing', 'Backend Developer', 'Frontend Developer',
        'DevOps', 'System Admin', 'Functional Testing', 'UAT', 'Manager', 'Team lead', 'Client (view only)'];
      const about = {
        'Product Master': 'Owns the product direction across projects: priorities, roadmap and final decisions.',
        'Product Manager': 'Runs a project: members, planning, sprints and delivery.',
        'Project Manager': 'Owns the client relationship: follows progress, meetings and time.',
        'Business Analyst': 'Writes and maintains requirements, specs and acceptance criteria.',
        'Client Facing': 'Talks to customers: shares updates, collects feedback and raises requests.',
        'Backend Developer': 'Builds server-side features, APIs and databases; works on tasks and logs time.',
        'Frontend Developer': 'Builds screens and user interfaces; works on tasks and logs time.',
        DevOps: 'Builds, deploys and keeps the environments and pipelines running.',
        'System Admin': 'Looks after servers, hosting, access and backups.',
        'Functional Testing': 'Tests features against the requirements and reports bugs.',
        UAT: 'Checks finished work with the customer before it goes live.',
        Manager: 'Kept from the earlier setup: monitors every project (same access as before).',
        'Team lead': 'Kept from the earlier setup: leads a team inside a project.',
        'Client (view only)': 'Customers and stakeholders: can see the project and its tasks, nothing else.',
      };
      all("SELECT id, name, description FROM roles WHERE scope = 'project' ORDER BY position, id").forEach((r, i) => {
        const at = order.indexOf(r.name);
        const desc = about[r.name] && (!r.description || /^Started as a copy|^Created from/.test(r.description) || r.name === 'Product Master' || r.name === 'Client Facing') ? about[r.name] : r.description;
        run('UPDATE roles SET position = ?, description = ? WHERE id = ?', at >= 0 ? at : order.length + i, desc, r.id);
      });
      setSetting('migration_role_order_v1', '1');
    });
  }
}
migrate();

// Remove expired sessions on start
run("DELETE FROM sessions WHERE expires_at < datetime('now')");

// Swap in another database file (restore on a fresh install). Brings it up to this version's layout.
export function replaceDatabase(srcFile) {
  db.close();
  for (const f of [DB_FILE, `${DB_FILE}-wal`, `${DB_FILE}-shm`]) fs.rmSync(f, { force: true });
  fs.copyFileSync(srcFile, DB_FILE);
  db = openDb();
  migrate();
  run("DELETE FROM sessions");
}

export function backupNow(label = 'manual') {
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const file = path.join(BACKUP_DIR, `tracker-${stamp}-${label}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return file;
}

// Largest file people can upload, in MB: the MAX_UPLOAD_MB environment variable if set,
// otherwise Administration -> General, otherwise 25.
export const UPLOAD_LIMIT_FROM_ENV = !!process.env.MAX_UPLOAD_MB;
export function maxUploadMb() {
  const n = Number(process.env.MAX_UPLOAD_MB || getSetting('max_upload_mb') || 25);
  return Number.isFinite(n) && n > 0 ? n : 25;
}
