// Sprint Planning: create sprints from the unpicked (upcoming) tasks, start and end them.
// Tasks are added to and taken out of sprints with the task routes (PATCH /work-packages/:id or -bulk, field sprint_id).
import { Router } from 'express';
import { get, all, run, tx } from '../db.js';
import { fail, visibleProjectIds, can } from '../access.js';
import { resolveProject } from './projects.js';
import { todayISO } from '../util.js';
import { sprintState, loadSprint, sprintProjectIds } from '../sprints.js';
import { loadWp, updateWp } from './workpackages.js';
import { calendar, isWorkingDay, holidaySet } from '../calendar.js';
import { personRoles } from '../access.js';

const r = Router();
const DAY = /^\d{4}-\d{2}-\d{2}$/;
// "Plan sprints" (sprint.manage) in a project's role, or in a global role for every project
const canPlan = (req) => !!req.user.is_admin || visibleProjectIds(req, 'sprint.manage').length > 0;
const canPlanIn = (req, pid) => !!req.user.is_admin || can(req, 'sprint.manage', pid);
const listParam = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : String(v).split(',')).map(x => String(x).trim()).filter(Boolean);

// The projects chosen for a sprint (project_ids, or project_id). The person must be able to plan in each.
function readProjects(req, b) {
  const raw = listParam(b.project_ids !== undefined ? b.project_ids : b.project_id);
  if (!raw.length) fail(400, 'Choose at least one project for the sprint.');
  const list = [...new Map(raw.map(v => resolveProject(v)).map(p => [p.id, p])).values()];
  for (const p of list) if (!canPlanIn(req, p.id)) fail(403, `You cannot plan sprints in ${p.name}.`);
  return list;
}
// A version belongs to one project, so only a sprint of a single project can have one.
function checkVersion(versionId, projectIds) {
  if (!versionId) return null;
  if (projectIds.length !== 1) fail(400, 'A version belongs to one project, so a sprint with several projects cannot have a version.');
  if (!get('SELECT id FROM versions WHERE id = ? AND project_id = ?', versionId, projectIds[0])) fail(400, 'That version belongs to another project.');
  return versionId;
}
const canManage = (req, s) => !!req.user.is_admin || (s.created_by === req.user.id && sprintState(s) === 'planned');

function withStats(req, s) {
  const ids = visibleProjectIds(req, 'wp.view');
  const ph = ids.length ? ids.map(() => '?').join(',') : 'NULL';
  const st = get(`SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN st.is_closed = 1 THEN 1 ELSE 0 END), 0) AS done,
                    COALESCE(SUM(wp.estimated_hours), 0) AS estimated
                  FROM work_packages wp JOIN statuses st ON st.id = wp.status_id
                  WHERE wp.sprint_id = ? AND wp.project_id IN (${ph})`, s.id, ...ids);
  const state = sprintState(s);
  const projects = all('SELECT p.id, p.name, p.identifier, p.color FROM sprint_projects sp JOIN projects p ON p.id = sp.project_id WHERE sp.sprint_id = ? ORDER BY p.name COLLATE NOCASE', s.id);
  const v = s.version_id ? get('SELECT name FROM versions WHERE id = ?', s.version_id) : null;
  return { ...s, ...st, state, code: `SPR-${s.id}`, projects, project_ids: projects.map(p => p.id),
    project_name: projects.map(p => p.name).join(', ') || null, project_identifier: projects.map(p => p.identifier).join(', ') || null, version_name: v?.name || null,
    created_by_name: get('SELECT name FROM users WHERE id = ?', s.created_by)?.name || null,
    can_manage: canManage(req, s), can_end: !!req.user.is_admin || s.created_by === req.user.id, can_add: !!req.user.is_admin || state === 'planned' };
}

// Sprints covering a project the person can see, in order of their scheduled dates.
// Optional filters: project_id (one or more, comma separated: sprints covering any of them), version_id.
r.get('/sprints', (req, res) => {
  const ids = visibleProjectIds(req, 'wp.view');
  const ph = (n) => (n ? Array(n).fill('?').join(',') : 'NULL');
  const where = [`EXISTS (SELECT 1 FROM sprint_projects x WHERE x.sprint_id = sprints.id AND x.project_id IN (${ph(ids.length)}))`];
  const params = [...ids];
  const want = listParam(req.query.project_id).map(v => resolveProject(v).id);
  if (want.length) { where.push(`EXISTS (SELECT 1 FROM sprint_projects x WHERE x.sprint_id = sprints.id AND x.project_id IN (${ph(want.length)}))`); params.push(...want); }
  if (req.query.version_id === 'none') where.push('version_id IS NULL');
  else if (/^\d+$/.test(req.query.version_id || '')) { where.push('version_id = ?'); params.push(Number(req.query.version_id)); }
  const list = all(`SELECT * FROM sprints WHERE ${where.join(' AND ')} ORDER BY start_date, end_date, id`, ...params).map(s => withStats(req, s));
  // the current sprint: the running one that started last
  const running = list.filter(s => s.state === 'current');
  const current = running.sort((a, b) => b.start_date.localeCompare(a.start_date) || b.id - a.id)[0] || null;
  list.sort((a, b) => a.start_date.localeCompare(b.start_date) || a.end_date.localeCompare(b.end_date) || a.id - b.id);
  res.json({ sprints: list, current_id: current?.id || null, can_create: canPlan(req), is_admin: !!req.user.is_admin, today: todayISO() });
});

// Sprint Planning → Teams: each person's load in a sprint (sprint_id), or in the running sprints when none is chosen.
// Tasks and estimated hours = open and closed tasks of the sprint(s) assigned to them. Working days and daily hours come
// from Time → Working calendar (weekly off days and holidays are skipped).
r.get('/sprints/capacity', (req, res) => {
  const visible = visibleProjectIds(req, 'wp.view');
  const ph = (n) => (n ? Array(n).fill('?').join(',') : 'NULL');
  const sprintRows = /^\d+$/.test(req.query.sprint_id || '')
    ? [loadSprint(Number(req.query.sprint_id))].filter(Boolean)
    : all('SELECT * FROM sprints WHERE ended_at IS NULL AND start_date <= ? AND end_date >= ?', todayISO(), todayISO());
  const sprintsSeen = sprintRows.filter(s => sprintProjectIds(s.id).some(id => visible.includes(id)));
  const want = listParam(req.query.project_id).map(v => resolveProject(v).id);
  let pids = [...new Set(sprintsSeen.flatMap(s => sprintProjectIds(s.id)))].filter(id => visible.includes(id));
  if (want.length) pids = pids.filter(id => want.includes(id));
  const cal = calendar();
  const start = sprintsSeen.map(s => s.start_date).sort()[0] || null;
  const end = sprintsSeen.map(s => s.end_date).sort().reverse()[0] || null;
  let workingDays = 0; let holidays = 0;
  if (start && end) {
    const hs = holidaySet();
    for (let d = new Date(`${start}T00:00:00Z`); d.toISOString().slice(0, 10) <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const day = d.toISOString().slice(0, 10);
      if (isWorkingDay(day, cal, hs)) workingDays++;
      else if (hs.has(day) && !cal.off_days.includes(d.getUTCDay())) holidays++;
    }
  }
  const sids = sprintsSeen.map(s => s.id);
  const load = new Map((sids.length && pids.length ? all(`SELECT assignee_id, COUNT(*) AS tasks, COALESCE(SUM(estimated_hours), 0) AS hours,
      SUM(CASE WHEN st.is_closed = 1 THEN 0 ELSE 1 END) AS open_tasks
    FROM work_packages wp JOIN statuses st ON st.id = wp.status_id
    WHERE wp.sprint_id IN (${ph(sids.length)}) AND wp.project_id IN (${ph(pids.length)}) AND wp.assignee_id IS NOT NULL GROUP BY assignee_id`, ...sids, ...pids) : [])
    .map(x => [x.assignee_id, x]));
  // people: members of the sprint's projects, and anyone with tasks in it
  const memberIds = pids.length ? all(`SELECT DISTINCT user_id FROM project_members WHERE project_id IN (${ph(pids.length)})`, ...pids).map(x => x.user_id) : [];
  const ids = [...new Set([...memberIds, ...load.keys()])];
  const users = ids.length ? all(`SELECT * FROM users WHERE status = 'active' AND id IN (${ph(ids.length)}) ORDER BY name COLLATE NOCASE`, ...ids) : [];
  const sprintHours = Math.round(workingDays * cal.hours_per_day * 100) / 100;
  // same order as on the Teams page: teams by name, people in each team's order; others after, A–Z
  const rank = new Map();
  all(`SELECT tm.user_id FROM team_members tm JOIN teams t ON t.id = tm.team_id ORDER BY t.name, tm.position IS NULL, tm.position, tm.rowid`)
    .forEach(x => { if (!rank.has(x.user_id)) rank.set(x.user_id, rank.size); });
  users.sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9) || a.name.localeCompare(b.name));
  const rows = users.map(u => {
    const l = load.get(u.id) || { tasks: 0, open_tasks: 0, hours: 0 };
    const projects = pids.length ? all(`SELECT p.id, p.name, p.identifier FROM project_members pm JOIN projects p ON p.id = pm.project_id
      WHERE pm.user_id = ? AND pm.project_id IN (${ph(pids.length)}) ORDER BY p.name COLLATE NOCASE`, u.id, ...pids) : [];
    const hours = Math.round(Number(l.hours) * 100) / 100;
    return {
      id: u.id, name: u.name, roles: personRoles(u).map(r1 => r1.name), projects,
      tasks: l.tasks, open_tasks: l.open_tasks, estimated_hours: hours,
      occupancy: workingDays ? Math.round((hours / workingDays) * 100) / 100 : 0,            // hours per working day
      occupancy_pct: sprintHours ? Math.round((hours / sprintHours) * 100) : 0,
      available: Math.round((sprintHours - hours) * 100) / 100,                                 // negative = over-booked
      daily_hours: cal.hours_per_day, sprint_hours: sprintHours,
    };
  });
  res.json({
    sprints: sprintsSeen.map(s => ({ id: s.id, code: `SPR-${s.id}`, name: s.name, start_date: s.start_date, end_date: s.end_date })),
    start, end, working_days: workingDays, holidays, daily_hours: cal.hours_per_day, sprint_hours: sprintHours, rows,
  });
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
  const projects = readProjects(req, b);
  const pids = projects.map(p => p.id);
  const versionId = checkVersion(b.version_id ? Number(b.version_id) : null, pids);
  if (!f.name) f.name = `Sprint ${(get('SELECT COUNT(*) AS n FROM sprints').n || 0) + 1}`;
  const ids = [...new Set((b.task_ids || []).map(Number).filter(Boolean))];
  const out = tx(() => {
    const { id } = run('INSERT INTO sprints(name, goal, start_date, end_date, created_by, version_id) VALUES(?,?,?,?,?,?)', f.name, f.goal, f.start_date, f.end_date, req.user.id, versionId);
    for (const pid of pids) run('INSERT INTO sprint_projects(sprint_id, project_id) VALUES(?,?)', id, pid);
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
  const before = sprintProjectIds(s.id);
  const b = req.body || {};
  const pids = b.project_ids !== undefined || b.project_id !== undefined ? readProjects(req, b).map(p => p.id) : before;
  let versionId = b.version_id !== undefined ? (b.version_id ? Number(b.version_id) : null) : s.version_id;
  if (pids.length > 1 && b.version_id === undefined) versionId = null; // several projects now: the sprint can no longer have a version
  versionId = checkVersion(versionId, pids);
  const removed = before.filter(id => !pids.includes(id));
  tx(() => {
    run('UPDATE sprints SET name = ?, goal = ?, start_date = ?, end_date = ?, version_id = ? WHERE id = ?', f.name, f.goal, f.start_date, f.end_date, versionId, s.id);
    run('DELETE FROM sprint_projects WHERE sprint_id = ?', s.id);
    for (const pid of pids) run('INSERT INTO sprint_projects(sprint_id, project_id) VALUES(?,?)', s.id, pid);
    // tasks of a project taken off the sprint go back to "Not in a sprint"
    if (removed.length) {
      for (const w of all(`SELECT id FROM work_packages WHERE sprint_id = ? AND project_id IN (${removed.map(() => '?').join(',')})`, s.id, ...removed)) {
        run("UPDATE work_packages SET sprint_id = NULL, updated_at = datetime('now') WHERE id = ?", w.id);
        run('INSERT INTO journals(wp_id, user_id, notes, changes) VALUES(?,?,?,?)', w.id, req.user.id, `Its project was taken off sprint "${s.name}".`, JSON.stringify({ sprint_id: [s.id, null] }));
      }
    }
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
    // the target must cover the projects of the unfinished tasks
    const tp = sprintProjectIds(target.id);
    const need = all('SELECT DISTINCT wp.project_id AS id, p.name FROM work_packages wp JOIN statuses st ON st.id = wp.status_id JOIN projects p ON p.id = wp.project_id WHERE wp.sprint_id = ? AND st.is_closed = 0', s.id);
    const missing = need.filter(x => !tp.includes(x.id));
    if (missing.length) fail(400, `${target.name} does not include ${missing.map(x => x.name).join(', ')}, so those unfinished tasks cannot move into it.`);
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
