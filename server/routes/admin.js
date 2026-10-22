import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { get, all, run, tx, hashPassword, getSetting, setSetting, backupNow, BACKUP_DIR } from '../db.js';
import { need, fail, parseList } from '../access.js';
import { GLOBAL_PERMISSIONS, PROJECT_PERMISSIONS, ALL_GLOBAL_KEYS, ALL_PROJECT_KEYS } from '../permissions.js';
import { requireText, updateSet } from '../util.js';

const r = Router();

// ---------- reference data used across the app ----------
r.get('/meta', (_req, res) => {
  res.json({
    types: all('SELECT * FROM types ORDER BY position, id'),
    statuses: all('SELECT * FROM statuses ORDER BY position, id'),
    priorities: all('SELECT * FROM priorities ORDER BY position, id'),
    roles: all('SELECT id, name, scope, description, builtin FROM roles ORDER BY scope, position, id'),
    activities: parseList(getSetting('time_activities')),
    appName: getSetting('app_name', 'Project Tracker'),
  });
});

// ---------- users ----------
r.get('/admin/users', (req, res) => {
  need(req, 'admin.users');
  res.json(all(`
    SELECT u.id, u.name, u.email, u.job_title, u.is_admin, u.status, u.global_role_id, u.created_at, u.last_login_at,
           r.name AS global_role_name,
           (SELECT COUNT(*) FROM project_members pm WHERE pm.user_id = u.id) AS project_count,
           (SELECT GROUP_CONCAT(t.name, ', ') FROM team_members tm JOIN teams t ON t.id = tm.team_id WHERE tm.user_id = u.id) AS teams
    FROM users u LEFT JOIN roles r ON r.id = u.global_role_id
    ORDER BY u.status = 'locked', u.name`));
});

function checkGlobalRole(id) {
  if (id == null || id === '') return null;
  const role = get("SELECT id FROM roles WHERE id = ? AND scope = 'global'", id);
  if (!role) fail(400, 'Choose a valid global role.');
  return role.id;
}

r.post('/admin/users', (req, res) => {
  need(req, 'admin.users');
  const name = requireText(req.body.name, 'Name');
  const email = requireText(req.body.email, 'Email').toLowerCase();
  if (!/^\S+@\S+$/.test(email)) fail(400, 'Enter a valid email address.');
  if (get('SELECT id FROM users WHERE email = ?', email)) fail(400, 'A user with this email already exists.');
  const pw = String(req.body.password || '');
  if (pw.length < 8) fail(400, 'Password must be at least 8 characters.');
  if (req.body.is_admin && !req.user.is_admin) fail(403, 'Only administrators can create administrators.');
  const { id } = run(`INSERT INTO users(name, email, password_hash, is_admin, global_role_id, job_title, must_change_password)
                      VALUES(?,?,?,?,?,?,1)`,
    name, email, hashPassword(pw), req.body.is_admin ? 1 : 0, checkGlobalRole(req.body.global_role_id), req.body.job_title || null);
  if (Array.isArray(req.body.team_ids)) for (const t of req.body.team_ids) run('INSERT OR IGNORE INTO team_members(team_id, user_id) VALUES(?,?)', t, id);
  res.status(201).json({ id });
});

r.patch('/admin/users/:id', (req, res) => {
  need(req, 'admin.users');
  const user = get('SELECT * FROM users WHERE id = ?', req.params.id) || fail(404, 'User not found.');
  const b = req.body;
  if ((b.is_admin !== undefined || user.is_admin) && !req.user.is_admin) fail(403, 'Only administrators can change administrator accounts.');
  if (user.id === req.user.id && (b.status === 'locked' || b.is_admin === false || b.is_admin === 0)) fail(400, 'You cannot lock yourself or remove your own administrator rights.');
  const fields = {
    name: b.name !== undefined ? requireText(b.name, 'Name') : undefined,
    email: b.email !== undefined ? requireText(b.email, 'Email').toLowerCase() : undefined,
    job_title: b.job_title,
    status: b.status !== undefined ? (['active', 'locked'].includes(b.status) ? b.status : fail(400, 'Invalid status.')) : undefined,
    is_admin: b.is_admin !== undefined ? (b.is_admin ? 1 : 0) : undefined,
    global_role_id: b.global_role_id !== undefined ? checkGlobalRole(b.global_role_id) : undefined,
  };
  if (fields.email && get('SELECT id FROM users WHERE email = ? AND id <> ?', fields.email, user.id)) fail(400, 'Another user already has this email.');
  if (b.password) {
    if (String(b.password).length < 8) fail(400, 'Password must be at least 8 characters.');
    fields.password_hash = hashPassword(String(b.password));
    fields.must_change_password = 1;
  }
  tx(() => {
    const { sql, values } = updateSet(fields);
    if (sql) run(`UPDATE users SET ${sql} WHERE id = ?`, ...values, user.id);
    if (fields.status === 'locked' || b.password) run('DELETE FROM sessions WHERE user_id = ?', user.id);
    if (Array.isArray(b.team_ids)) {
      run('DELETE FROM team_members WHERE user_id = ?', user.id);
      for (const t of b.team_ids) run('INSERT OR IGNORE INTO team_members(team_id, user_id) VALUES(?,?)', t, user.id);
    }
  });
  res.json({ ok: true });
});

r.delete('/admin/users/:id', (req, res) => {
  need(req, 'admin.users');
  if (Number(req.params.id) === req.user.id) fail(400, 'You cannot delete your own account.');
  const user = get('SELECT * FROM users WHERE id = ?', req.params.id) || fail(404, 'User not found.');
  if (user.is_admin && !req.user.is_admin) fail(403, 'Only administrators can delete administrators.');
  run('DELETE FROM users WHERE id = ?', user.id);
  res.json({ ok: true });
});

// ---------- roles ----------
r.get('/admin/permissions', (req, res) => {
  need(req, 'admin.roles');
  res.json({ global: GLOBAL_PERMISSIONS, project: PROJECT_PERMISSIONS });
});

r.get('/admin/roles', (req, res) => {
  need(req, 'admin.roles');
  res.json(all(`SELECT r.*,
      (SELECT COUNT(*) FROM users u WHERE u.global_role_id = r.id) AS user_count,
      (SELECT COUNT(*) FROM project_members pm WHERE pm.role_id = r.id) AS member_count
    FROM roles r ORDER BY scope, position, id`).map(x => ({ ...x, permissions: parseList(x.permissions) })));
});

function cleanPerms(scope, perms) {
  const allowed = scope === 'global' ? [...ALL_GLOBAL_KEYS, ...ALL_PROJECT_KEYS] : ALL_PROJECT_KEYS;
  return [...new Set((perms || []).filter(p => allowed.includes(p)))];
}

r.post('/admin/roles', (req, res) => {
  need(req, 'admin.roles');
  const scope = req.body.scope === 'global' ? 'global' : 'project';
  const name = requireText(req.body.name, 'Role name');
  if (get('SELECT id FROM roles WHERE name = ? AND scope = ?', name, scope)) fail(400, 'A role with this name already exists.');
  const pos = get('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM roles').p;
  const { id } = run('INSERT INTO roles(name, scope, description, permissions, position) VALUES(?,?,?,?,?)',
    name, scope, req.body.description || null, JSON.stringify(cleanPerms(scope, req.body.permissions)), pos);
  res.status(201).json({ id });
});

r.patch('/admin/roles/:id', (req, res) => {
  need(req, 'admin.roles');
  const role = get('SELECT * FROM roles WHERE id = ?', req.params.id) || fail(404, 'Role not found.');
  const name = req.body.name !== undefined ? requireText(req.body.name, 'Role name') : role.name;
  if (get('SELECT id FROM roles WHERE name = ? AND scope = ? AND id <> ?', name, role.scope, role.id)) fail(400, 'A role with this name already exists.');
  run('UPDATE roles SET name = ?, description = ?, permissions = ? WHERE id = ?',
    name, req.body.description ?? role.description,
    req.body.permissions ? JSON.stringify(cleanPerms(role.scope, req.body.permissions)) : role.permissions, role.id);
  res.json({ ok: true });
});

r.delete('/admin/roles/:id', (req, res) => {
  need(req, 'admin.roles');
  const role = get('SELECT * FROM roles WHERE id = ?', req.params.id) || fail(404, 'Role not found.');
  if (role.builtin) fail(400, 'Built-in roles cannot be deleted. You can still change their permissions.');
  const used = get('SELECT COUNT(*) AS n FROM project_members WHERE role_id = ?', role.id).n;
  if (used) fail(400, `This role is used by ${used} project membership(s). Change those members to another role first.`);
  run('DELETE FROM roles WHERE id = ?', role.id);
  res.json({ ok: true });
});

// ---------- types / statuses / priorities ----------
const ENUMS = {
  types: ['name', 'color', 'is_milestone', 'position'],
  statuses: ['name', 'color', 'is_closed', 'is_default', 'done_ratio', 'position'],
  priorities: ['name', 'color', 'is_default', 'position'],
};
const USAGE_COL = { types: 'type_id', statuses: 'status_id', priorities: 'priority_id' };

for (const [table, cols] of Object.entries(ENUMS)) {
  r.post(`/admin/${table}`, (req, res) => {
    need(req, 'admin.settings');
    const name = requireText(req.body.name, 'Name');
    if (get(`SELECT id FROM ${table} WHERE name = ?`, name)) fail(400, 'That name is already used.');
    const pos = get(`SELECT COALESCE(MAX(position), 0) + 1 AS p FROM ${table}`).p;
    const vals = { name, color: req.body.color || '#5B6472', position: pos };
    for (const c of cols) if (!(c in vals) && req.body[c] !== undefined) vals[c] = typeof req.body[c] === 'boolean' ? (req.body[c] ? 1 : 0) : req.body[c];
    const keys = Object.keys(vals);
    tx(() => {
      if (vals.is_default) run(`UPDATE ${table} SET is_default = 0`);
      const { id } = run(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`, ...keys.map(k => vals[k]));
      res.status(201).json({ id });
    });
  });
  r.patch(`/admin/${table}/:id`, (req, res) => {
    need(req, 'admin.settings');
    const row = get(`SELECT * FROM ${table} WHERE id = ?`, req.params.id) || fail(404, 'Not found.');
    const fields = {};
    for (const c of cols) if (req.body[c] !== undefined) fields[c] = typeof req.body[c] === 'boolean' ? (req.body[c] ? 1 : 0) : req.body[c];
    if (fields.name !== undefined) fields.name = requireText(fields.name, 'Name');
    tx(() => {
      if (fields.is_default) run(`UPDATE ${table} SET is_default = 0`);
      const { sql, values } = updateSet(fields);
      if (sql) run(`UPDATE ${table} SET ${sql} WHERE id = ?`, ...values, row.id);
    });
    res.json({ ok: true });
  });
  r.delete(`/admin/${table}/:id`, (req, res) => {
    need(req, 'admin.settings');
    const row = get(`SELECT * FROM ${table} WHERE id = ?`, req.params.id) || fail(404, 'Not found.');
    const used = get(`SELECT COUNT(*) AS n FROM work_packages WHERE ${USAGE_COL[table]} = ?`, row.id).n;
    if (used) fail(400, `${used} work package(s) still use “${row.name}”. Change them first.`);
    if (get(`SELECT COUNT(*) AS n FROM ${table}`).n <= 1) fail(400, 'At least one entry is required.');
    run(`DELETE FROM ${table} WHERE id = ?`, row.id);
    res.json({ ok: true });
  });
}

// ---------- settings ----------
r.patch('/admin/settings', (req, res) => {
  need(req, 'admin.settings');
  if (req.body.app_name !== undefined) setSetting('app_name', requireText(req.body.app_name, 'Application name'));
  if (Array.isArray(req.body.time_activities)) {
    const list = req.body.time_activities.map(s => String(s).trim()).filter(Boolean);
    if (!list.length) fail(400, 'Keep at least one time activity.');
    setSetting('time_activities', JSON.stringify([...new Set(list)]));
  }
  res.json({ ok: true });
});

// ---------- backups ----------
r.get('/admin/backups', (req, res) => {
  if (!req.user.is_admin) fail(403, 'Only administrators can manage backups.');
  const files = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.db')).map(f => {
    const st = fs.statSync(path.join(BACKUP_DIR, f));
    return { name: f, size: st.size, created_at: st.mtime.toISOString() };
  }).sort((a, b) => b.created_at.localeCompare(a.created_at));
  res.json(files);
});

r.post('/admin/backups', (req, res) => {
  if (!req.user.is_admin) fail(403, 'Only administrators can manage backups.');
  const file = backupNow('manual');
  res.status(201).json({ name: path.basename(file) });
});

r.get('/admin/backups/:name', (req, res) => {
  if (!req.user.is_admin) fail(403, 'Only administrators can manage backups.');
  const name = path.basename(req.params.name);
  const file = path.join(BACKUP_DIR, name);
  if (!name.endsWith('.db') || !fs.existsSync(file)) fail(404, 'Backup not found.');
  res.download(file, name);
});

export default r;
