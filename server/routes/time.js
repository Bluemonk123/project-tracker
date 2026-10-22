import { Router } from 'express';
import { get, all, run, getSetting } from '../db.js';
import { need, can, fail, visibleProjectIds, parseList } from '../access.js';
import { dateOrNull, numOrNull, todayISO } from '../util.js';
import { resolveProject } from './projects.js';

const r = Router();

// Which entries can this user see? Own entries everywhere, plus everyone's in projects with time.view_all.
function visibility(req) {
  const allIds = visibleProjectIds(req, 'project.view');
  const fullIds = allIds.filter(id => can(req, 'time.view_all', id));
  const parts = [];
  const params = [];
  if (fullIds.length) { parts.push(`te.project_id IN (${fullIds.map(() => '?').join(',')})`); params.push(...fullIds); }
  parts.push('te.user_id = ?'); params.push(req.user.id);
  return { sql: `(${parts.join(' OR ')})`, params };
}

function filters(req, q) {
  const v = visibility(req);
  const where = [v.sql];
  const params = [...v.params];
  if (q.project_id) { const p = resolveProject(q.project_id); where.push('te.project_id = ?'); params.push(p.id); }
  if (q.user_id) { where.push('te.user_id = ?'); params.push(q.user_id === 'me' ? req.user.id : Number(q.user_id)); }
  if (q.wp_id) { where.push('te.wp_id = ?'); params.push(Number(q.wp_id)); }
  if (q.from) { where.push('te.spent_on >= ?'); params.push(q.from); }
  if (q.to) { where.push('te.spent_on <= ?'); params.push(q.to); }
  if (q.activity) { where.push('te.activity = ?'); params.push(q.activity); }
  return { where: where.join(' AND '), params };
}

r.get('/time-entries', (req, res) => {
  const { where, params } = filters(req, req.query);
  const rows = all(`SELECT te.*, u.name AS user_name, p.name AS project_name, p.identifier AS project_identifier, p.color AS project_color,
                      wp.subject AS wp_subject, p2.identifier || '-' || wp.number AS wp_key
                    FROM time_entries te JOIN users u ON u.id = te.user_id JOIN projects p ON p.id = te.project_id
                    LEFT JOIN work_packages wp ON wp.id = te.wp_id LEFT JOIN projects p2 ON p2.id = wp.project_id
                    WHERE ${where} ORDER BY te.spent_on DESC, te.id DESC LIMIT 2000`, ...params);
  const total = rows.reduce((s, x) => s + x.hours, 0);
  res.json({ rows, total });
});

r.get('/time-entries/report', (req, res) => {
  const groups = { user: 'u.name', project: 'p.name', activity: 'te.activity', wp: "COALESCE(p2.identifier || '-' || wp.number || ' ' || wp.subject, '(no work package)')", day: 'te.spent_on', week: "strftime('%Y-W%W', te.spent_on)", month: "strftime('%Y-%m', te.spent_on)" };
  const rowsBy = groups[req.query.rows] || groups.user;
  const colsBy = groups[req.query.cols] || null;
  const { where, params } = filters(req, req.query);
  const data = all(`SELECT ${rowsBy} AS row_label, ${colsBy || "'Total'"} AS col_label, ROUND(SUM(te.hours), 2) AS hours
                    FROM time_entries te JOIN users u ON u.id = te.user_id JOIN projects p ON p.id = te.project_id
                    LEFT JOIN work_packages wp ON wp.id = te.wp_id LEFT JOIN projects p2 ON p2.id = wp.project_id
                    WHERE ${where} GROUP BY row_label, col_label ORDER BY row_label, col_label`, ...params);
  res.json(data);
});

function resolveTarget(req, b) {
  let wp = null;
  if (b.wp_id) {
    wp = get('SELECT id, project_id FROM work_packages WHERE id = ?', b.wp_id) || fail(400, 'Work package not found.');
  }
  const projectId = wp ? wp.project_id : (b.project_id ? resolveProject(b.project_id).id : fail(400, 'Choose a project or work package.'));
  return { wp, projectId };
}

function validate(b) {
  const hours = numOrNull(b.hours);
  if (hours == null || hours <= 0 || hours > 24) fail(400, 'Hours must be between 0 and 24.');
  const activities = parseList(getSetting('time_activities'));
  const activity = b.activity && activities.includes(b.activity) ? b.activity : (activities[0] || 'Other');
  return { hours, activity, spent_on: dateOrNull(b.spent_on, 'Date') || todayISO(), comment: b.comment || null };
}

r.post('/time-entries', (req, res) => {
  const { wp, projectId } = resolveTarget(req, req.body);
  need(req, 'time.log', projectId);
  const userId = req.body.user_id && Number(req.body.user_id) !== req.user.id ? Number(req.body.user_id) : req.user.id;
  if (userId !== req.user.id) need(req, 'time.edit_all', projectId);
  const v = validate(req.body);
  const { id } = run('INSERT INTO time_entries(project_id, wp_id, user_id, spent_on, hours, activity, comment) VALUES(?,?,?,?,?,?,?)',
    projectId, wp?.id || null, userId, v.spent_on, v.hours, v.activity, v.comment);
  res.status(201).json({ id });
});

function loadEntry(req) {
  const te = get('SELECT * FROM time_entries WHERE id = ?', req.params.id) || fail(404, 'Time entry not found.');
  if (te.user_id !== req.user.id) need(req, 'time.edit_all', te.project_id);
  return te;
}

r.patch('/time-entries/:id', (req, res) => {
  const te = loadEntry(req);
  const merged = { ...te, ...req.body };
  const { wp, projectId } = resolveTarget(req, { wp_id: merged.wp_id, project_id: merged.project_id });
  need(req, 'time.log', projectId);
  const v = validate(merged);
  run('UPDATE time_entries SET project_id = ?, wp_id = ?, spent_on = ?, hours = ?, activity = ?, comment = ? WHERE id = ?',
    projectId, wp?.id || null, v.spent_on, v.hours, v.activity, v.comment, te.id);
  res.json({ ok: true });
});

r.delete('/time-entries/:id', (req, res) => {
  const te = loadEntry(req);
  run('DELETE FROM time_entries WHERE id = ?', te.id);
  res.json({ ok: true });
});

export default r;
