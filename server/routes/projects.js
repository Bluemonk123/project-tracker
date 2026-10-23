import { Router } from 'express';
import { get, all, run, tx } from '../db.js';
import { need, can, fail, visibleProjectIds, projectPerms } from '../access.js';
import { requireText, dateOrNull, updateSet, notify, todayISO } from '../util.js';
import { positionsFor, setPosition, removeUserFromPositions, POSITIONS } from '../positions.js';

const r = Router();

export function resolveProject(param) {
  const p = /^\d+$/.test(String(param))
    ? get('SELECT * FROM projects WHERE id = ?', Number(param))
    : get('SELECT * FROM projects WHERE identifier = ?', String(param));
  return p || fail(404, 'Project not found.');
}

const STATUSES = ['not_set', 'on_track', 'at_risk', 'off_track', 'finished', 'discontinued'];

export function projectStats(ids) {
  if (!ids.length) return new Map();
  const today = todayISO();
  const ph = ids.map(() => '?').join(',');
  const rows = all(`
    SELECT wp.project_id,
      COUNT(*) AS total,
      SUM(CASE WHEN s.is_closed = 1 THEN 1 ELSE 0 END) AS closed,
      SUM(CASE WHEN s.is_closed = 0 AND wp.due_date < ? THEN 1 ELSE 0 END) AS overdue,
      ROUND(AVG(CASE WHEN s.is_closed = 1 THEN 100 ELSE wp.done_ratio END)) AS progress,
      MAX(wp.updated_at) AS last_activity
    FROM work_packages wp JOIN statuses s ON s.id = wp.status_id
    WHERE wp.project_id IN (${ph}) GROUP BY wp.project_id`, today, ...ids);
  const members = all(`SELECT project_id, COUNT(*) AS n FROM project_members WHERE project_id IN (${ph}) GROUP BY project_id`, ...ids);
  const meetings = all(`SELECT project_id, MIN(starts_at) AS next_meeting FROM meetings
                        WHERE project_id IN (${ph}) AND starts_at >= datetime('now','localtime','-1 hour') AND status <> 'closed'
                        GROUP BY project_id`, ...ids);
  const map = new Map(ids.map(id => [id, { total: 0, closed: 0, open: 0, overdue: 0, progress: 0, members: 0, next_meeting: null, last_activity: null }]));
  for (const x of rows) Object.assign(map.get(x.project_id), { total: x.total, closed: x.closed, open: x.total - x.closed, overdue: x.overdue, progress: x.progress || 0, last_activity: x.last_activity });
  for (const x of members) map.get(x.project_id).members = x.n;
  for (const x of meetings) map.get(x.project_id).next_meeting = x.next_meeting;
  return map;
}

r.get('/projects', (req, res) => {
  const archived = req.query.archived === '1';
  const ids = visibleProjectIds(req, 'project.view', { includeArchived: archived });
  if (!ids.length) return res.json([]);
  const rows = all(`SELECT p.*, u.name AS manager_name,
       (SELECT r.name FROM project_members pm JOIN roles r ON r.id = pm.role_id WHERE pm.project_id = p.id AND pm.user_id = ?) AS my_role
     FROM projects p LEFT JOIN users u ON u.id = p.manager_id
     WHERE p.id IN (${ids.map(() => '?').join(',')}) ${archived ? 'AND p.archived = 1' : 'AND p.archived = 0'}
     ORDER BY p.name`, req.user.id, ...ids);
  const stats = projectStats(rows.map(p => p.id));
  const positions = positionsFor(rows.map(p => p.id));
  res.json(rows.map(p => ({ ...p, stats: stats.get(p.id), positions: positions.get(p.id) })));
});

function projectFields(b) {
  const f = {
    name: b.name !== undefined ? requireText(b.name, 'Project name') : undefined,
    description: b.description,
    color: b.color !== undefined ? (/^#[0-9a-fA-F]{6}$/.test(b.color) ? b.color : fail(400, 'Color must look like #2F7A6B.')) : undefined,
    status: b.status !== undefined ? (STATUSES.includes(b.status) ? b.status : fail(400, 'Unknown project status.')) : undefined,
    status_explanation: b.status_explanation,
    parent_id: b.parent_id === '' ? null : b.parent_id,
    manager_id: b.manager_id === '' ? null : b.manager_id,
    start_date: dateOrNull(b.start_date, 'Start date'),
    end_date: dateOrNull(b.end_date, 'End date'),
  };
  if (f.start_date && f.end_date && f.start_date > f.end_date) fail(400, 'End date must be after the start date.');
  return f;
}

r.post('/projects', (req, res) => {
  need(req, 'projects.create');
  const b = req.body;
  const identifier = requireText(b.identifier, 'Short key').toUpperCase();
  if (!/^[A-Z][A-Z0-9]{1,9}$/.test(identifier)) fail(400, 'Short key must be 2–10 letters or digits and start with a letter, e.g. CRM.');
  if (get('SELECT id FROM projects WHERE identifier = ?', identifier)) fail(400, 'Another project already uses this short key.');
  const f = projectFields(b);
  if (!f.name) fail(400, 'Project name is required.');
  const pmRole = get("SELECT id FROM roles WHERE scope = 'project' AND name = 'Project manager'") || get("SELECT id FROM roles WHERE scope='project' ORDER BY position LIMIT 1");
  const id = tx(() => {
    const { id } = run(`INSERT INTO projects(name, identifier, description, color, status, status_explanation, parent_id, manager_id, start_date, end_date, created_by)
                        VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      f.name, identifier, f.description || null, f.color || '#0070C0', f.status || 'not_set', f.status_explanation || null,
      f.parent_id || null, f.manager_id || null, f.start_date || null, f.end_date || null, req.user.id);
    run('INSERT OR IGNORE INTO project_members(project_id, user_id, role_id) VALUES(?,?,?)', id, req.user.id, pmRole.id);
    if (f.manager_id) run('INSERT OR IGNORE INTO project_members(project_id, user_id, role_id) VALUES(?,?,?)', id, f.manager_id, pmRole.id);
    if (f.manager_id) setPosition(id, 'PM', [f.manager_id], req.user.id);
    if (b.am_id) setPosition(id, 'AM', [b.am_id], req.user.id);
    if (b.ba_id) setPosition(id, 'BA', [b.ba_id], req.user.id);
    if (Array.isArray(b.dt_ids) && b.dt_ids.length) setPosition(id, 'DT', b.dt_ids, req.user.id);
    return id;
  });
  res.status(201).json({ id, identifier });
});

r.get('/projects/:pid', (req, res) => {
  const p = resolveProject(req.params.pid);
  need(req, 'project.view', p.id);
  const perms = [...projectPerms(req, p.id)];
  const statusCounts = all(`SELECT s.id, s.name, s.color, s.is_closed, COUNT(wp.id) AS n FROM statuses s
                            LEFT JOIN work_packages wp ON wp.status_id = s.id AND wp.project_id = ?
                            GROUP BY s.id ORDER BY s.position`, p.id);
  const typeCounts = all(`SELECT t.id, t.name, t.color, COUNT(wp.id) AS n,
                            SUM(CASE WHEN s.is_closed = 1 THEN 1 ELSE 0 END) AS closed
                          FROM types t LEFT JOIN work_packages wp ON wp.type_id = t.id AND wp.project_id = ?
                          LEFT JOIN statuses s ON s.id = wp.status_id
                          GROUP BY t.id ORDER BY t.position`, p.id);
  res.json({
    ...p,
    manager: p.manager_id ? get('SELECT id, name FROM users WHERE id = ?', p.manager_id) : null,
    parent: p.parent_id ? get('SELECT id, name, identifier FROM projects WHERE id = ?', p.parent_id) : null,
    children: all('SELECT id, name, identifier, color, status FROM projects WHERE parent_id = ? AND archived = 0', p.id),
    permissions: perms,
    positions: positionsFor([p.id]).get(p.id),
    stats: projectStats([p.id]).get(p.id),
    statusCounts, typeCounts,
    members: listMembers(p.id),
    versions: listVersions(p.id),
    categories: all('SELECT * FROM categories WHERE project_id = ? ORDER BY name', p.id),
    news: all(`SELECT n.*, u.name AS author_name FROM news n LEFT JOIN users u ON u.id = n.author_id
               WHERE n.project_id = ? ORDER BY n.created_at DESC LIMIT 5`, p.id),
    upcomingMeetings: all(`SELECT id, title, kind, starts_at, duration_minutes, status FROM meetings
                           WHERE project_id = ? AND starts_at >= datetime('now','localtime','-1 hour') ORDER BY starts_at LIMIT 5`, p.id),
  });
});

r.patch('/projects/:pid', (req, res) => {
  const p = resolveProject(req.params.pid);
  need(req, 'project.edit', p.id);
  const f = projectFields(req.body);
  if (f.parent_id && Number(f.parent_id) === p.id) fail(400, 'A project cannot be its own parent.');
  if (req.body.identifier !== undefined && req.body.identifier.toUpperCase() !== p.identifier) {
    const ident = String(req.body.identifier).toUpperCase();
    if (!/^[A-Z][A-Z0-9]{1,9}$/.test(ident)) fail(400, 'Short key must be 2–10 letters or digits and start with a letter.');
    if (get('SELECT id FROM projects WHERE identifier = ? AND id <> ?', ident, p.id)) fail(400, 'Another project already uses this short key.');
    f.identifier = ident;
  }
  const managerChanged = f.manager_id !== undefined && (Number(f.manager_id) || null) !== (p.manager_id || null);
  const { sql, values } = updateSet(f);
  if (sql) run(`UPDATE projects SET ${sql}, updated_at = datetime('now') WHERE id = ?`, ...values, p.id);
  if (managerChanged) setPosition(p.id, 'PM', f.manager_id ? [Number(f.manager_id)] : [], req.user.id);
  if (f.status && f.status !== p.status) {
    const ids = all('SELECT user_id FROM project_members WHERE project_id = ?', p.id).map(x => x.user_id);
    notify(ids, { actorId: req.user.id, projectId: p.id, reason: 'project_status',
      message: `${req.user.name} changed ${p.name} status to ${f.status.replace('_', ' ')}` });
  }
  res.json({ ok: true });
});

r.post('/projects/:pid/archive', (req, res) => {
  const p = resolveProject(req.params.pid);
  need(req, 'project.archive', p.id);
  run("UPDATE projects SET archived = ?, updated_at = datetime('now') WHERE id = ?", req.body.archived === false ? 0 : 1, p.id);
  res.json({ ok: true });
});

r.delete('/projects/:pid', (req, res) => {
  const p = resolveProject(req.params.pid);
  need(req, 'project.archive', p.id);
  if (String(req.body?.confirm || '').toUpperCase() !== p.identifier) fail(400, `Type the short key ${p.identifier} to confirm deletion.`);
  run('DELETE FROM projects WHERE id = ?', p.id);
  res.json({ ok: true });
});

// ---------- members ----------
export function listMembers(projectId) {
  return all(`SELECT pm.id, pm.user_id, pm.role_id, pm.created_at, u.name, u.email, u.job_title, u.status, r.name AS role_name,
                (SELECT COUNT(*) FROM work_packages wp JOIN statuses s ON s.id = wp.status_id
                  WHERE wp.project_id = pm.project_id AND wp.assignee_id = pm.user_id AND s.is_closed = 0) AS open_wps
              FROM project_members pm JOIN users u ON u.id = pm.user_id JOIN roles r ON r.id = pm.role_id
              WHERE pm.project_id = ? ORDER BY u.name`, projectId);
}

function checkProjectRole(id) {
  return get("SELECT id FROM roles WHERE id = ? AND scope = 'project'", id) || fail(400, 'Choose a project role.');
}

r.get('/projects/:pid/members', (req, res) => {
  const p = resolveProject(req.params.pid);
  need(req, 'project.view', p.id);
  res.json(listMembers(p.id));
});

r.post('/projects/:pid/members', (req, res) => {
  const p = resolveProject(req.params.pid);
  need(req, 'project.members', p.id);
  const role = checkProjectRole(req.body.role_id);
  let userIds = [];
  if (req.body.team_id) userIds = all('SELECT user_id FROM team_members WHERE team_id = ?', req.body.team_id).map(x => x.user_id);
  if (req.body.user_id) userIds.push(Number(req.body.user_id));
  if (Array.isArray(req.body.user_ids)) userIds.push(...req.body.user_ids.map(Number));
  if (!userIds.length) fail(400, 'Choose a person or a team to add.');
  let added = 0;
  tx(() => {
    for (const uid of new Set(userIds)) {
      const r1 = run('INSERT OR IGNORE INTO project_members(project_id, user_id, role_id) VALUES(?,?,?)', p.id, uid, role.id);
      added += r1.changes;
    }
  });
  notify(userIds, { actorId: req.user.id, projectId: p.id, reason: 'member_added', message: `${req.user.name} added you to ${p.name}` });
  res.status(201).json({ added });
});

r.patch('/projects/:pid/members/:mid', (req, res) => {
  const p = resolveProject(req.params.pid);
  need(req, 'project.members', p.id);
  const role = checkProjectRole(req.body.role_id);
  run('UPDATE project_members SET role_id = ? WHERE id = ? AND project_id = ?', role.id, req.params.mid, p.id);
  res.json({ ok: true });
});

r.delete('/projects/:pid/members/:mid', (req, res) => {
  const p = resolveProject(req.params.pid);
  need(req, 'project.members', p.id);
  const m = get('SELECT user_id FROM project_members WHERE id = ? AND project_id = ?', req.params.mid, p.id);
  run('DELETE FROM project_members WHERE id = ? AND project_id = ?', req.params.mid, p.id);
  if (m) removeUserFromPositions(p.id, m.user_id, req.user.id);
  res.json({ ok: true });
});

// ---------- key people (PM / AM / BA / DT) ----------
r.get('/projects/:pid/positions', (req, res) => {
  const p = resolveProject(req.params.pid);
  need(req, 'project.view', p.id);
  res.json(positionsFor([p.id]).get(p.id));
});

r.put('/projects/:pid/positions/:code', (req, res) => {
  const p = resolveProject(req.params.pid);
  need(req, 'project.members', p.id);
  const code = String(req.params.code).toUpperCase();
  const def = POSITIONS.find(x => x.code === code) || fail(400, 'Unknown position. Use PM, AM, BA or DT.');
  const ids = Array.isArray(req.body.user_ids) ? req.body.user_ids : req.body.user_id ? [req.body.user_id] : [];
  const changes = setPosition(p.id, code, ids, req.user.id);
  notify(changes.added, { actorId: req.user.id, projectId: p.id, reason: 'member_added', message: `${req.user.name} mapped you as ${def.label} of ${p.name}` });
  notify(changes.removed, { actorId: req.user.id, projectId: p.id, reason: 'member_added', message: `${req.user.name} removed you as ${def.label} of ${p.name}` });
  res.json(positionsFor([p.id]).get(p.id));
});

// ---------- versions (releases / sprints) ----------
export function listVersions(projectId) {
  return all(`SELECT v.*,
      (SELECT COUNT(*) FROM work_packages wp WHERE wp.version_id = v.id) AS total,
      (SELECT COUNT(*) FROM work_packages wp JOIN statuses s ON s.id = wp.status_id WHERE wp.version_id = v.id AND s.is_closed = 1) AS closed,
      (SELECT ROUND(AVG(CASE WHEN s.is_closed = 1 THEN 100 ELSE wp.done_ratio END)) FROM work_packages wp JOIN statuses s ON s.id = wp.status_id WHERE wp.version_id = v.id) AS progress
    FROM versions v WHERE v.project_id = ? ORDER BY v.status = 'closed', COALESCE(v.due_date, '9999'), v.name`, projectId);
}

r.get('/projects/:pid/versions', (req, res) => {
  const p = resolveProject(req.params.pid);
  need(req, 'project.view', p.id);
  res.json(listVersions(p.id));
});

r.post('/projects/:pid/versions', (req, res) => {
  const p = resolveProject(req.params.pid);
  need(req, 'project.versions', p.id);
  const name = requireText(req.body.name, 'Version name');
  if (get('SELECT id FROM versions WHERE project_id = ? AND name = ?', p.id, name)) fail(400, 'A version with this name already exists.');
  const { id } = run('INSERT INTO versions(project_id, name, description, status, start_date, due_date) VALUES(?,?,?,?,?,?)',
    p.id, name, req.body.description || null, req.body.status || 'open', dateOrNull(req.body.start_date) || null, dateOrNull(req.body.due_date) || null);
  res.status(201).json({ id });
});

r.patch('/projects/:pid/versions/:vid', (req, res) => {
  const p = resolveProject(req.params.pid);
  need(req, 'project.versions', p.id);
  const b = req.body;
  const { sql, values } = updateSet({
    name: b.name !== undefined ? requireText(b.name, 'Version name') : undefined,
    description: b.description,
    status: b.status !== undefined ? (['open', 'locked', 'closed'].includes(b.status) ? b.status : fail(400, 'Unknown version status.')) : undefined,
    start_date: dateOrNull(b.start_date), due_date: dateOrNull(b.due_date),
  });
  if (sql) run(`UPDATE versions SET ${sql} WHERE id = ? AND project_id = ?`, ...values, req.params.vid, p.id);
  res.json({ ok: true });
});

r.delete('/projects/:pid/versions/:vid', (req, res) => {
  const p = resolveProject(req.params.pid);
  need(req, 'project.versions', p.id);
  run('DELETE FROM versions WHERE id = ? AND project_id = ?', req.params.vid, p.id);
  res.json({ ok: true });
});

// ---------- categories ----------
r.post('/projects/:pid/categories', (req, res) => {
  const p = resolveProject(req.params.pid);
  need(req, 'project.versions', p.id);
  const name = requireText(req.body.name, 'Category name');
  const { id } = run('INSERT OR IGNORE INTO categories(project_id, name) VALUES(?,?)', p.id, name);
  res.status(201).json({ id });
});
r.delete('/projects/:pid/categories/:cid', (req, res) => {
  const p = resolveProject(req.params.pid);
  need(req, 'project.versions', p.id);
  run('DELETE FROM categories WHERE id = ? AND project_id = ?', req.params.cid, p.id);
  res.json({ ok: true });
});

// ---------- announcements ----------
r.get('/projects/:pid/news', (req, res) => {
  const p = resolveProject(req.params.pid);
  need(req, 'project.view', p.id);
  res.json(all(`SELECT n.*, u.name AS author_name FROM news n LEFT JOIN users u ON u.id = n.author_id
                WHERE n.project_id = ? ORDER BY n.created_at DESC`, p.id));
});
r.post('/projects/:pid/news', (req, res) => {
  const p = resolveProject(req.params.pid);
  need(req, 'news.manage', p.id);
  const title = requireText(req.body.title, 'Title');
  const { id } = run('INSERT INTO news(project_id, title, body, author_id) VALUES(?,?,?,?)', p.id, title, req.body.body || null, req.user.id);
  const ids = all('SELECT user_id FROM project_members WHERE project_id = ?', p.id).map(x => x.user_id);
  notify(ids, { actorId: req.user.id, projectId: p.id, reason: 'news', message: `${p.name}: ${title}` });
  res.status(201).json({ id });
});
r.delete('/projects/:pid/news/:nid', (req, res) => {
  const p = resolveProject(req.params.pid);
  need(req, 'news.manage', p.id);
  run('DELETE FROM news WHERE id = ? AND project_id = ?', req.params.nid, p.id);
  res.json({ ok: true });
});

// ---------- teams ----------
r.get('/teams', (_req, res) => {
  const teams = all(`SELECT t.*, u.name AS lead_name FROM teams t LEFT JOIN users u ON u.id = t.lead_id ORDER BY t.name`);
  const members = all(`SELECT tm.team_id, u.id, u.name, u.email, u.job_title FROM team_members tm JOIN users u ON u.id = tm.user_id ORDER BY u.name`);
  res.json(teams.map(t => ({ ...t, members: members.filter(m => m.team_id === t.id) })));
});

r.post('/teams', (req, res) => {
  need(req, 'teams.manage');
  const name = requireText(req.body.name, 'Team name');
  if (get('SELECT id FROM teams WHERE name = ?', name)) fail(400, 'A team with this name already exists.');
  const id = tx(() => {
    const { id } = run('INSERT INTO teams(name, description, lead_id) VALUES(?,?,?)', name, req.body.description || null, req.body.lead_id || null);
    for (const uid of req.body.member_ids || []) run('INSERT OR IGNORE INTO team_members(team_id, user_id) VALUES(?,?)', id, uid);
    if (req.body.lead_id) run('INSERT OR IGNORE INTO team_members(team_id, user_id) VALUES(?,?)', id, req.body.lead_id);
    return id;
  });
  res.status(201).json({ id });
});

r.patch('/teams/:id', (req, res) => {
  need(req, 'teams.manage');
  const t = get('SELECT * FROM teams WHERE id = ?', req.params.id) || fail(404, 'Team not found.');
  tx(() => {
    const { sql, values } = updateSet({
      name: req.body.name !== undefined ? requireText(req.body.name, 'Team name') : undefined,
      description: req.body.description,
      lead_id: req.body.lead_id === '' ? null : req.body.lead_id,
    });
    if (sql) run(`UPDATE teams SET ${sql} WHERE id = ?`, ...values, t.id);
    if (Array.isArray(req.body.member_ids)) {
      run('DELETE FROM team_members WHERE team_id = ?', t.id);
      for (const uid of req.body.member_ids) run('INSERT OR IGNORE INTO team_members(team_id, user_id) VALUES(?,?)', t.id, uid);
    }
    const lead = req.body.lead_id ?? t.lead_id;
    if (lead) run('INSERT OR IGNORE INTO team_members(team_id, user_id) VALUES(?,?)', t.id, lead);
  });
  res.json({ ok: true });
});

r.delete('/teams/:id', (req, res) => {
  need(req, 'teams.manage');
  run('DELETE FROM teams WHERE id = ?', req.params.id);
  res.json({ ok: true });
});

export default r;
