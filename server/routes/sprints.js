// Sprint Planning: create sprints from the unpicked (upcoming) tasks, start and end them.
// Tasks are added to and taken out of sprints with the task routes (PATCH /work-packages/:id or -bulk, field sprint_id).
import { Router } from 'express';
import { get, all, run, tx } from '../db.js';
import { fail, visibleProjectIds, can } from '../access.js';
import { resolveProject } from './projects.js';
import { todayISO } from '../util.js';
import { sprintState, loadSprint } from '../sprints.js';
import { loadWp, updateWp } from './workpackages.js';

const r = Router();
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const canPlan = (req) => !!req.user.is_admin || visibleProjectIds(req, 'wp.edit').length > 0 || visibleProjectIds(req, 'wp.edit_own').length > 0;
const canPlanIn = (req, pid) => !!req.user.is_admin || can(req, 'wp.edit', pid) || can(req, 'wp.edit_own', pid);
const canManage = (req, s) => !!req.user.is_admin || (s.created_by === req.user.id && sprintState(s) === 'planned');

function withStats(req, s) {
  const ids = visibleProjectIds(req, 'wp.view');
  const ph = ids.length ? ids.map(() => '?').join(',') : 'NULL';
  const st = get(`SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN st.is_closed = 1 THEN 1 ELSE 0 END), 0) AS done,
                    COALESCE(SUM(wp.estimated_hours), 0) AS estimated
                  FROM work_packages wp JOIN statuses st ON st.id = wp.status_id
                  WHERE wp.sprint_id = ? AND wp.project_id IN (${ph})`, s.id, ...ids);
  const state = sprintState(s);
  const p = s.project_id ? get('SELECT name, identifier, color FROM projects WHERE id = ?', s.project_id) : null;
  const v = s.version_id ? get('SELECT name FROM versions WHERE id = ?', s.version_id) : null;
  return { ...s, ...st, state, project_name: p?.name || null, project_identifier: p?.identifier || null, project_color: p?.color || null, version_name: v?.name || null,
    created_by_name: get('SELECT name FROM users WHERE id = ?', s.created_by)?.name || null,
    can_manage: canManage(req, s), can_end: !!req.user.is_admin || s.created_by === req.user.id, can_add: !!req.user.is_admin || state === 'planned' };
}

// Sprints of the projects the person can see, in order of their scheduled dates. Optional filters: project_id, version_id.
r.get('/sprints', (req, res) => {
  const ids = visibleProjectIds(req, 'wp.view');
  const where = [`(project_id IS NULL OR project_id IN (${ids.length ? ids.map(() => '?').join(',') : 'NULL'}))`];
  const params = [...ids];
  if (req.query.project_id) { where.push('project_id = ?'); params.push(resolveProject(req.query.project_id).id); }
  if (req.query.version_id === 'none') where.push('version_id IS NULL');
  else if (/^\d+$/.test(req.query.version_id || '')) { where.push('version_id = ?'); params.push(Number(req.query.version_id)); }
  const list = all(`SELECT * FROM sprints WHERE ${where.join(' AND ')} ORDER BY start_date, end_date, id`, ...params).map(s => withStats(req, s));
  // the current sprint: the running one that started last
  const running = list.filter(s => s.state === 'current');
  const current = running.sort((a, b) => b.start_date.localeCompare(a.start_date) || b.id - a.id)[0] || null;
  list.sort((a, b) => a.start_date.localeCompare(b.start_date) || a.end_date.localeCompare(b.end_date) || a.id - b.id);
  res.json({ sprints: list, current_id: current?.id || null, can_create: canPlan(req), is_admin: !!req.user.is_admin, today: todayISO() });
});

function readSprint(b, prev = {}) {
  const name = b.name !== undefined ? String(b.name || '').trim().slice(0, 80) : prev.name;
  const start = b.start_now ? todayISO() : b.start_date !== undefined ? String(b.start_date || '') : prev.start_date;
  let end = b.end_now ? todayISO() : b.end_date !== undefined ? String(b.end_date || '') : prev.end_date;
  if (b.start_now && DAY.test(end || '') && end < start) end = start;   // Start now keeps the end on or after today
  if (b.end_now && !b.start_now && start > end) return readSprint({ ...b, start_now: true }, prev); // End now on a later sprint: it runs today only
  if (!DAY.test(start || '')) fail(400, 'Choose the day the sprint starts, or Start now.');
  if (!DAY.test(end || '')) fail(400, 'Choose the day the sprint ends, or End now.');
  if (end < start) fail(400, 'The sprint must end on or after the day it starts.');
  const goal = b.goal !== undefined ? (String(b.goal || '').trim().slice(0, 500) || null) : prev.goal ?? null;
  return { name, start_date: start, end_date: end, goal };
}

// New sprint, optionally with the tasks picked on the page (task_ids).
r.post('/sprints', (req, res) => {
  if (!canPlan(req)) fail(403, 'You do not have permission to plan sprints.');
  const b = req.body || {};
  const f = readSprint(b);
  const p = resolveProject(b.project_id || fail(400, 'Choose the project of the sprint.'));
  if (!canPlanIn(req, p.id)) fail(403, `You cannot plan sprints in ${p.name}.`);
  const versionId = b.version_id ? Number(b.version_id) : null;
  if (versionId && !get('SELECT id FROM versions WHERE id = ? AND project_id = ?', versionId, p.id)) fail(400, 'That version belongs to another project.');
  if (!f.name) f.name = `Sprint ${(get('SELECT COUNT(*) AS n FROM sprints WHERE project_id = ?', p.id).n || 0) + 1}`;
  const ids = [...new Set((b.task_ids || []).map(Number).filter(Boolean))];
  const out = tx(() => {
    const { id } = run('INSERT INTO sprints(name, goal, start_date, end_date, created_by, project_id, version_id) VALUES(?,?,?,?,?,?,?)', f.name, f.goal, f.start_date, f.end_date, req.user.id, p.id, versionId);
    req.sprintSetup = id;
    for (const wid of ids) updateWp(req, loadWp(wid), { sprint_id: id });
    return id;
  });
  res.status(201).json(withStats(req, loadSprint(out)));
});

r.patch('/sprints/:id', (req, res) => {
  const s = loadSprint(Number(req.params.id)) || fail(404, 'Sprint not found.');
  if (!canManage(req, s)) fail(403, s.created_by === req.user.id ? 'This sprint has started, so only an administrator can change it.' : 'Only the person who created this sprint, or an administrator, can change it.');
  const f = readSprint(req.body || {}, s);
  if (!f.name) fail(400, 'Name the sprint.');
  let versionId = s.version_id;
  if (req.body.version_id !== undefined) {
    versionId = req.body.version_id ? Number(req.body.version_id) : null;
    if (versionId && !get('SELECT id FROM versions WHERE id = ? AND project_id = ?', versionId, s.project_id)) fail(400, 'That version belongs to another project.');
  }
  tx(() => {
    run('UPDATE sprints SET name = ?, goal = ?, start_date = ?, end_date = ?, version_id = ? WHERE id = ?', f.name, f.goal, f.start_date, f.end_date, versionId, s.id);
    // the sprint's tasks follow it into its new version
    if (versionId && versionId !== s.version_id) run("UPDATE work_packages SET version_id = ?, updated_at = datetime('now') WHERE sprint_id = ?", versionId, s.id);
  });
  res.json(withStats(req, loadSprint(s.id)));
});

// Start now: the sprint starts today.
r.post('/sprints/:id/start', (req, res) => {
  const s = loadSprint(Number(req.params.id)) || fail(404, 'Sprint not found.');
  if (!canManage(req, s)) fail(403, 'Only the person who created this sprint, or an administrator, can start it.');
  if (sprintState(s) !== 'planned') fail(400, 'This sprint has already started.');
  const t = todayISO();
  run('UPDATE sprints SET start_date = ?, end_date = MAX(end_date, ?) WHERE id = ?', t, t, s.id);
  res.json(withStats(req, loadSprint(s.id)));
});

// End now: the sprint ends today. Its unfinished tasks go back to the upcoming tasks, or into another sprint.
r.post('/sprints/:id/end', (req, res) => {
  const s = loadSprint(Number(req.params.id)) || fail(404, 'Sprint not found.');
  if (!req.user.is_admin && s.created_by !== req.user.id) fail(403, 'Only the person who created this sprint, or an administrator, can end it.');
  if (sprintState(s) === 'ended') fail(400, 'This sprint has already ended.');
  const moveTo = req.body?.move_to;
  let target = null;
  if (moveTo !== undefined && moveTo !== null && moveTo !== 'upcoming' && moveTo !== 'keep') {
    target = loadSprint(Number(moveTo)) || fail(400, 'That sprint does not exist.');
    if (target.id === s.id || sprintState(target) === 'ended') fail(400, 'Choose a sprint that has not ended.');
    if (target.project_id !== s.project_id) fail(400, 'Choose a sprint of the same project.');
  }
  const t = todayISO();
  tx(() => {
    run("UPDATE sprints SET ended_at = datetime('now'), end_date = MIN(end_date, ?), start_date = MIN(start_date, ?) WHERE id = ?", t, t, s.id);
    if (moveTo !== 'keep') {
      const open = all('SELECT wp.id FROM work_packages wp JOIN statuses st ON st.id = wp.status_id WHERE wp.sprint_id = ? AND st.is_closed = 0', s.id);
      for (const w of open) {
        run("UPDATE work_packages SET sprint_id = ?, version_id = COALESCE(?, version_id), updated_at = datetime('now') WHERE id = ?", target?.id ?? null, target?.version_id ?? null, w.id);
        run('INSERT INTO journals(wp_id, user_id, notes, changes) VALUES(?,?,?,?)', w.id, req.user.id, null, JSON.stringify({ sprint_id: [s.id, target?.id ?? null] }));
      }
    }
  });
  res.json(withStats(req, loadSprint(s.id)));
});

// Deleting a sprint sends its tasks back to the upcoming tasks.
r.delete('/sprints/:id', (req, res) => {
  const s = loadSprint(Number(req.params.id)) || fail(404, 'Sprint not found.');
  if (!canManage(req, s)) fail(403, 'Only an administrator can delete a sprint that has started; a planned sprint can also be deleted by the person who created it.');
  tx(() => {
    for (const w of all('SELECT id FROM work_packages WHERE sprint_id = ?', s.id)) {
      run('INSERT INTO journals(wp_id, user_id, notes, changes) VALUES(?,?,?,?)', w.id, req.user.id, `Sprint "${s.name}" was deleted.`, JSON.stringify({ sprint_id: [s.id, null] }));
    }
    run('UPDATE work_packages SET sprint_id = NULL WHERE sprint_id = ?', s.id);
    run('DELETE FROM sprints WHERE id = ?', s.id);
  });
  res.json({ ok: true });
});

export default r;
