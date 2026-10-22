import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { get, all, run, tx, UPLOAD_DIR } from '../db.js';
import { need, can, fail, visibleProjectIds } from '../access.js';
import { requireText, intOrNull, notify, mentionedUserIds, todayISO } from '../util.js';
import { resolveProject, projectStats } from './projects.js';

const r = Router();

// ---------- wiki ----------
r.get('/projects/:pid/wiki', (req, res) => {
  const p = resolveProject(req.params.pid);
  need(req, 'wiki.view', p.id);
  res.json(all(`SELECT w.id, w.title, w.parent_id, w.updated_at, u.name AS updated_by_name FROM wiki_pages w
                LEFT JOIN users u ON u.id = w.updated_by WHERE w.project_id = ? ORDER BY w.title COLLATE NOCASE`, p.id));
});

r.post('/projects/:pid/wiki', (req, res) => {
  const p = resolveProject(req.params.pid);
  need(req, 'wiki.edit', p.id);
  const title = requireText(req.body.title, 'Page title');
  if (get('SELECT id FROM wiki_pages WHERE project_id = ? AND title = ?', p.id, title)) fail(400, 'A page with this title already exists.');
  const content = String(req.body.content || '');
  const id = tx(() => {
    const { id } = run('INSERT INTO wiki_pages(project_id, parent_id, title, content, updated_by) VALUES(?,?,?,?,?)',
      p.id, intOrNull(req.body.parent_id) || null, title, content, req.user.id);
    run('INSERT INTO wiki_versions(page_id, content, user_id) VALUES(?,?,?)', id, content, req.user.id);
    return id;
  });
  notify(mentionedUserIds(content), { actorId: req.user.id, projectId: p.id, reason: 'mentioned', message: `${req.user.name} mentioned you on wiki page “${title}”` });
  res.status(201).json({ id });
});

function loadPage(req, id, edit = false) {
  const w = get(`SELECT w.*, u.name AS updated_by_name, p.name AS project_name, p.identifier AS project_identifier
                 FROM wiki_pages w JOIN projects p ON p.id = w.project_id LEFT JOIN users u ON u.id = w.updated_by WHERE w.id = ?`, id) || fail(404, 'Page not found.');
  need(req, edit ? 'wiki.edit' : 'wiki.view', w.project_id);
  return w;
}

r.get('/wiki/:id', (req, res) => {
  const w = loadPage(req, req.params.id);
  res.json({
    ...w,
    children: all('SELECT id, title FROM wiki_pages WHERE parent_id = ? ORDER BY title', w.id),
    versions: get('SELECT COUNT(*) AS n FROM wiki_versions WHERE page_id = ?', w.id).n,
    attachments: all(`SELECT a.*, u.name AS uploaded_by_name FROM attachments a LEFT JOIN users u ON u.id = a.uploaded_by
                      WHERE a.container_type = 'wiki' AND a.container_id = ?`, w.id),
    can_edit: can(req, 'wiki.edit', w.project_id),
  });
});

r.patch('/wiki/:id', (req, res) => {
  const w = loadPage(req, req.params.id, true);
  const title = req.body.title !== undefined ? requireText(req.body.title, 'Page title') : w.title;
  if (get('SELECT id FROM wiki_pages WHERE project_id = ? AND title = ? AND id <> ?', w.project_id, title, w.id)) fail(400, 'A page with this title already exists.');
  const content = req.body.content !== undefined ? String(req.body.content) : w.content;
  const parent = req.body.parent_id !== undefined ? (intOrNull(req.body.parent_id) || null) : w.parent_id;
  if (parent === w.id) fail(400, 'A page cannot be its own parent.');
  tx(() => {
    run("UPDATE wiki_pages SET title = ?, content = ?, parent_id = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?", title, content, parent, req.user.id, w.id);
    if (content !== w.content) run('INSERT INTO wiki_versions(page_id, content, user_id) VALUES(?,?,?)', w.id, content, req.user.id);
  });
  const newMentions = mentionedUserIds(content).filter(id => !mentionedUserIds(w.content).includes(id));
  notify(newMentions, { actorId: req.user.id, projectId: w.project_id, reason: 'mentioned', message: `${req.user.name} mentioned you on wiki page “${title}”` });
  res.json({ ok: true });
});

r.delete('/wiki/:id', (req, res) => {
  const w = loadPage(req, req.params.id, true);
  run('DELETE FROM wiki_pages WHERE id = ?', w.id);
  res.json({ ok: true });
});

r.get('/wiki/:id/versions', (req, res) => {
  const w = loadPage(req, req.params.id);
  res.json(all(`SELECT v.id, v.created_at, v.content, u.name AS user_name FROM wiki_versions v LEFT JOIN users u ON u.id = v.user_id
                WHERE v.page_id = ? ORDER BY v.id DESC LIMIT 50`, w.id));
});

// ---------- attachments ----------
const MAX_MB = Number(process.env.MAX_UPLOAD_MB || 25);
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, _file, cb) => cb(null, crypto.randomBytes(16).toString('hex')),
  }),
  limits: { fileSize: MAX_MB * 1024 * 1024 },
});

function containerProject(type, id) {
  const sql = {
    wp: 'SELECT project_id FROM work_packages WHERE id = ?',
    meeting: 'SELECT project_id FROM meetings WHERE id = ?',
    wiki: 'SELECT project_id FROM wiki_pages WHERE id = ?',
    project: 'SELECT id AS project_id FROM projects WHERE id = ?',
  }[type];
  if (!sql) fail(400, 'Unknown attachment target.');
  const row = get(sql, id) || fail(404, 'Item not found.');
  if (!row.project_id) fail(400, 'Files can only be attached to project items.');
  return row.project_id;
}

r.post('/attachments', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) return next(Object.assign(new Error(err.code === 'LIMIT_FILE_SIZE' ? `Files must be ${MAX_MB} MB or smaller.` : err.message), { status: 400 }));
    try {
      if (!req.file) fail(400, 'Choose a file to upload.');
      const type = String(req.body.container_type);
      const cid = Number(req.body.container_id);
      let projectId;
      try { projectId = containerProject(type, cid); need(req, 'files.upload', projectId); }
      catch (e) { fs.rmSync(req.file.path, { force: true }); throw e; }
      const name = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
      const { id } = run(`INSERT INTO attachments(container_type, container_id, project_id, filename, stored_name, content_type, size, uploaded_by)
                          VALUES(?,?,?,?,?,?,?,?)`, type, cid, projectId, name, req.file.filename, req.file.mimetype, req.file.size, req.user.id);
      if (type === 'wp') run('INSERT INTO journals(wp_id, user_id, changes) VALUES(?,?,?)', cid, req.user.id, JSON.stringify({ attachment: [null, name] }));
      res.status(201).json({ id, filename: name });
    } catch (e) { next(e); }
  });
});

r.get('/attachments/:id/download', (req, res) => {
  const a = get('SELECT * FROM attachments WHERE id = ?', req.params.id) || fail(404, 'File not found.');
  need(req, 'project.view', a.project_id);
  const file = path.join(UPLOAD_DIR, path.basename(a.stored_name));
  if (!fs.existsSync(file)) fail(404, 'The file is missing from the server.');
  const inline = req.query.inline === '1' && /^(image\/|application\/pdf|text\/plain)/.test(a.content_type || '');
  res.setHeader('Content-Type', a.content_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.filename)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  fs.createReadStream(file).pipe(res);
});

r.delete('/attachments/:id', (req, res) => {
  const a = get('SELECT * FROM attachments WHERE id = ?', req.params.id) || fail(404, 'File not found.');
  if (a.uploaded_by !== req.user.id) need(req, 'wp.edit', a.project_id);
  run('DELETE FROM attachments WHERE id = ?', a.id);
  fs.rmSync(path.join(UPLOAD_DIR, path.basename(a.stored_name)), { force: true });
  res.json({ ok: true });
});

// ---------- notifications ----------
r.get('/notifications', (req, res) => {
  const where = req.query.unread === '1' ? 'AND n.read_at IS NULL' : '';
  res.json(all(`SELECT n.*, u.name AS actor_name, p.identifier AS project_identifier, p.name AS project_name
                FROM notifications n LEFT JOIN users u ON u.id = n.actor_id LEFT JOIN projects p ON p.id = n.project_id
                WHERE n.user_id = ? ${where} ORDER BY n.created_at DESC, n.id DESC LIMIT 200`, req.user.id));
});

r.post('/notifications/read', (req, res) => {
  if (req.body.all) run("UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL", req.user.id);
  else for (const id of req.body.ids || []) run("UPDATE notifications SET read_at = datetime('now') WHERE id = ? AND user_id = ?", id, req.user.id);
  res.json({ ok: true });
});

// ---------- my page ----------
function weekStart(d = new Date()) {
  const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

r.get('/dashboard', (req, res) => {
  const me = req.user.id;
  const today = todayISO();
  const ids = visibleProjectIds(req, 'wp.view');
  const ph = ids.map(() => '?').join(',') || 'NULL';
  const myWork = all(`SELECT wp.id, wp.subject, wp.due_date, wp.start_date, wp.done_ratio, p.identifier || '-' || wp.number AS key, p.color AS project_color,
                        p.name AS project_name, s.name AS status_name, s.color AS status_color, pr.name AS priority_name, pr.color AS priority_color,
                        pr.position AS priority_position, t.name AS type_name, t.color AS type_color
                      FROM work_packages wp JOIN projects p ON p.id = wp.project_id JOIN statuses s ON s.id = wp.status_id
                      JOIN priorities pr ON pr.id = wp.priority_id JOIN types t ON t.id = wp.type_id
                      WHERE wp.assignee_id = ? AND s.is_closed = 0 AND p.archived = 0
                      ORDER BY wp.due_date IS NULL, wp.due_date, pr.position DESC LIMIT 100`, me);
  const accountable = all(`SELECT wp.id, wp.subject, wp.due_date, p.identifier || '-' || wp.number AS key, p.color AS project_color, s.name AS status_name, s.color AS status_color,
                             a.name AS assignee_name
                           FROM work_packages wp JOIN projects p ON p.id = wp.project_id JOIN statuses s ON s.id = wp.status_id LEFT JOIN users a ON a.id = wp.assignee_id
                           WHERE wp.responsible_id = ? AND s.is_closed = 0 AND p.archived = 0 ORDER BY wp.due_date IS NULL, wp.due_date LIMIT 30`, me);
  const meetings = all(`SELECT m.id, m.title, m.kind, m.starts_at, m.duration_minutes, m.status, m.location, p.name AS project_name, p.color AS project_color
                        FROM meetings m LEFT JOIN projects p ON p.id = m.project_id
                        WHERE m.id IN (SELECT meeting_id FROM meeting_participants WHERE user_id = ?)
                          AND m.starts_at >= date('now','localtime') AND m.starts_at < date('now','localtime','+7 day')
                        ORDER BY m.starts_at LIMIT 20`, me);
  const ws = weekStart();
  const hours = all(`SELECT spent_on, ROUND(SUM(hours), 2) AS hours FROM time_entries WHERE user_id = ? AND spent_on >= ? GROUP BY spent_on ORDER BY spent_on`, me, ws);
  const activity = ids.length ? all(`SELECT j.id, j.created_at, j.notes, j.changes, u.name AS user_name, wp.id AS wp_id, wp.subject,
                              p.identifier || '-' || wp.number AS key, p.color AS project_color
                            FROM journals j JOIN work_packages wp ON wp.id = j.wp_id JOIN projects p ON p.id = wp.project_id LEFT JOIN users u ON u.id = j.user_id
                            WHERE wp.project_id IN (${ph}) ORDER BY j.created_at DESC, j.id DESC LIMIT 25`, ...ids) : [];
  res.json({
    today, weekStart: ws, myWork, accountable, meetings, hours, activity,
    counts: {
      open: myWork.length,
      overdue: myWork.filter(w => w.due_date && w.due_date < today).length,
      dueToday: myWork.filter(w => w.due_date === today).length,
      dueWeek: myWork.filter(w => w.due_date && w.due_date >= today && w.due_date <= addDays(today, 7)).length,
    },
  });
});

function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}

// ---------- manager reports ----------
r.get('/reports/portfolio', (req, res) => {
  const ids = visibleProjectIds(req, 'project.view');
  if (!ids.length) return res.json({ projects: [], totals: {} });
  const ph = ids.map(() => '?').join(',');
  const projects = all(`SELECT p.*, u.name AS manager_name FROM projects p LEFT JOIN users u ON u.id = p.manager_id WHERE p.id IN (${ph}) ORDER BY p.name`, ...ids);
  const stats = projectStats(ids);
  const monthStart = todayISO().slice(0, 8) + '01';
  const hours = all(`SELECT project_id, ROUND(SUM(hours), 1) AS hours FROM time_entries WHERE project_id IN (${ph}) AND spent_on >= ? GROUP BY project_id`, ...ids, monthStart);
  const nextVersion = all(`SELECT v.project_id, v.name, v.due_date FROM versions v WHERE v.project_id IN (${ph}) AND v.status <> 'closed' AND v.due_date IS NOT NULL
                           AND v.due_date = (SELECT MIN(v2.due_date) FROM versions v2 WHERE v2.project_id = v.project_id AND v2.status <> 'closed' AND v2.due_date IS NOT NULL)`, ...ids);
  const rows = projects.map(p => ({
    ...p, stats: stats.get(p.id),
    hours_month: hours.find(h => h.project_id === p.id)?.hours || 0,
    next_version: nextVersion.find(v => v.project_id === p.id) || null,
  }));
  const totals = rows.reduce((t, p) => ({
    projects: t.projects + 1, open: t.open + p.stats.open, overdue: t.overdue + p.stats.overdue,
    at_risk: t.at_risk + (p.status === 'at_risk' ? 1 : 0), off_track: t.off_track + (p.status === 'off_track' ? 1 : 0),
    hours_month: t.hours_month + p.hours_month,
  }), { projects: 0, open: 0, overdue: 0, at_risk: 0, off_track: 0, hours_month: 0 });
  res.json({ projects: rows, totals });
});

r.get('/reports/workload', (req, res) => {
  let ids;
  if (req.query.project_id) {
    const p = resolveProject(req.query.project_id);
    need(req, 'wp.view', p.id);
    ids = [p.id];
  } else {
    if (!can(req, 'reports.view')) {
      ids = visibleProjectIds(req, 'project.view').filter(id => can(req, 'project.members', id) || can(req, 'time.view_all', id));
    } else ids = visibleProjectIds(req, 'project.view');
  }
  if (!ids.length) return res.json([]);
  const ph = ids.map(() => '?').join(',');
  const today = todayISO();
  const ws = weekStart();
  const teamFilter = req.query.team_id ? `AND u.id IN (SELECT user_id FROM team_members WHERE team_id = ${Number(req.query.team_id)})` : '';
  const rows = all(`
    SELECT u.id, u.name, u.job_title,
      COUNT(wp.id) AS open_count,
      SUM(CASE WHEN wp.due_date < ? THEN 1 ELSE 0 END) AS overdue,
      SUM(CASE WHEN wp.due_date >= ? AND wp.due_date <= date(?, '+7 day') THEN 1 ELSE 0 END) AS due_week,
      ROUND(SUM(COALESCE(wp.estimated_hours, 0) * (100 - wp.done_ratio) / 100.0), 1) AS remaining_hours,
      SUM(CASE WHEN st.name = 'In progress' THEN 1 ELSE 0 END) AS in_progress,
      SUM(CASE WHEN pr.position >= 2 THEN 1 ELSE 0 END) AS high_priority,
      COUNT(DISTINCT wp.project_id) AS projects
    FROM users u
    LEFT JOIN work_packages wp ON wp.assignee_id = u.id AND wp.project_id IN (${ph})
      AND wp.status_id IN (SELECT id FROM statuses WHERE is_closed = 0)
    LEFT JOIN statuses st ON st.id = wp.status_id
    LEFT JOIN priorities pr ON pr.id = wp.priority_id
    WHERE u.status = 'active' AND (u.id IN (SELECT user_id FROM project_members WHERE project_id IN (${ph})) OR wp.id IS NOT NULL) ${teamFilter}
    GROUP BY u.id ORDER BY open_count DESC, u.name`, today, today, today, ...ids, ...ids);
  const hours = all(`SELECT user_id, ROUND(SUM(hours), 1) AS hours FROM time_entries WHERE spent_on >= ? AND project_id IN (${ph}) GROUP BY user_id`, ws, ...ids);
  res.json(rows.map(r1 => ({ ...r1, hours_week: hours.find(h => h.user_id === r1.id)?.hours || 0 })));
});

// ---------- activity ----------
r.get('/activity', (req, res) => {
  let ids = visibleProjectIds(req, 'wp.view');
  if (req.query.project_id) { const p = resolveProject(req.query.project_id); need(req, 'wp.view', p.id); ids = [p.id]; }
  if (!ids.length) return res.json([]);
  const userFilter = req.query.user_id ? 'AND j.user_id = ?' : '';
  const params = [...ids];
  if (req.query.user_id) params.push(Number(req.query.user_id));
  res.json(all(`SELECT j.id, j.created_at, j.notes, j.changes, j.user_id, u.name AS user_name, wp.id AS wp_id, wp.subject,
                  p.identifier || '-' || wp.number AS key, p.name AS project_name, p.color AS project_color
                FROM journals j JOIN work_packages wp ON wp.id = j.wp_id JOIN projects p ON p.id = wp.project_id LEFT JOIN users u ON u.id = j.user_id
                WHERE wp.project_id IN (${ids.map(() => '?').join(',')}) ${userFilter}
                ORDER BY j.created_at DESC, j.id DESC LIMIT ${Math.min(Number(req.query.limit) || 100, 500)}`, ...params));
});

// ---------- global search ----------
r.get('/search', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ projects: [], workPackages: [], wiki: [], meetings: [] });
  const like = `%${q}%`;
  const pIds = visibleProjectIds(req, 'project.view');
  const ph = pIds.map(() => '?').join(',') || 'NULL';
  const keyMatch = q.match(/^([A-Za-z][A-Za-z0-9]*)-(\d+)$/);
  const wpIds = pIds.filter(id => can(req, 'wp.view', id));
  const wph = wpIds.map(() => '?').join(',') || 'NULL';
  const workPackages = wpIds.length ? all(`SELECT wp.id, wp.subject, p.identifier || '-' || wp.number AS key, s.name AS status_name, s.color AS status_color, p.color AS project_color
                         FROM work_packages wp JOIN projects p ON p.id = wp.project_id JOIN statuses s ON s.id = wp.status_id
                         WHERE wp.project_id IN (${wph}) AND (${keyMatch ? '(p.identifier = ? COLLATE NOCASE AND wp.number = ?)' : 'wp.subject LIKE ? OR wp.description LIKE ?'})
                         ORDER BY s.is_closed, wp.updated_at DESC LIMIT 15`, ...wpIds, ...(keyMatch ? [keyMatch[1], Number(keyMatch[2])] : [like, like])) : [];
  const wikiIds = pIds.filter(id => can(req, 'wiki.view', id));
  const mIds = pIds.filter(id => can(req, 'meetings.view', id));
  const mph = mIds.map(() => '?').join(',') || 'NULL';
  res.json({
    projects: pIds.length ? all(`SELECT id, name, identifier, color FROM projects WHERE id IN (${ph}) AND (name LIKE ? OR identifier LIKE ?) LIMIT 8`, ...pIds, like, like) : [],
    workPackages,
    wiki: wikiIds.length ? all(`SELECT w.id, w.title, p.identifier FROM wiki_pages w JOIN projects p ON p.id = w.project_id
                                WHERE w.project_id IN (${wikiIds.map(() => '?').join(',')}) AND (w.title LIKE ? OR w.content LIKE ?) LIMIT 8`, ...wikiIds, like, like) : [],
    meetings: mIds.length ? all(`SELECT m.id, m.title, m.starts_at FROM meetings m WHERE m.project_id IN (${mph}) AND m.title LIKE ?
                                 ORDER BY m.starts_at DESC LIMIT 8`, ...mIds, like) : [],
  });
});

export default r;
