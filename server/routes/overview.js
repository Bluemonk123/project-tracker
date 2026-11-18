// Manager overview: projects, tasks by stage, sprints and team members in one call.
// GET /reports/overview?project_id=1,2 (optional: only those projects)
import { Router } from 'express';
import { get, all } from '../db.js';
import { can, fail, visibleProjectIds } from '../access.js';
import { todayISO } from '../util.js';
import { projectStats, resolveProject } from './projects.js';
import { positionsFor } from '../positions.js';
import { BOARD_COLUMNS } from './workpackages.js';
import { sprintState } from '../sprints.js';

const r = Router();
const weekStart = () => { const d = new Date(); const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day); return d.toISOString().slice(0, 10); };

r.get('/reports/overview', (req, res) => {
  if (!can(req, 'reports.view')) fail(403, 'You need a role with "View portfolio and workload reports".');
  let ids = visibleProjectIds(req, 'project.view');
  const want = String(req.query.project_id || '').split(',').map(s => s.trim()).filter(Boolean);
  if (want.length) { const set = new Set(want.map(v => resolveProject(v).id)); ids = ids.filter(id => set.has(id)); }
  const columns = BOARD_COLUMNS.map(({ key, name, color }) => ({ key, name, color }));
  if (!ids.length) return res.json({ columns, totals: {}, stages: {}, types: [], sprints: { current: [], planned: [] }, projects: [], people: [], teams: [] });
  const ph = ids.map(() => '?').join(',');
  const today = todayISO();
  const ws = weekStart();

  // ---------- sprints of these projects ----------
  const sprintRows = all(`SELECT s.* FROM sprints s WHERE EXISTS (SELECT 1 FROM sprint_projects x WHERE x.sprint_id = s.id AND x.project_id IN (${ph}))
                          ORDER BY s.start_date, s.id`, ...ids).map(s => ({ ...s, state: sprintState(s, today) }));
  const currentIds = sprintRows.filter(s => s.state === 'current').map(s => s.id);
  const curPh = currentIds.length ? currentIds.map(() => '?').join(',') : 'NULL';

  // ---------- tasks by stage, per project ----------
  const byProjectStage = all(`SELECT wp.project_id, st.board_column AS col, COUNT(*) AS n,
        SUM(CASE WHEN st.is_closed = 0 AND wp.due_date < ? THEN 1 ELSE 0 END) AS overdue,
        SUM(CASE WHEN st.is_closed = 0 AND wp.sprint_id IS NULL THEN 1 ELSE 0 END) AS unpicked,
        SUM(CASE WHEN wp.sprint_id IN (${curPh}) THEN 1 ELSE 0 END) AS in_sprint,
        SUM(CASE WHEN st.is_closed = 1 AND wp.closed_on >= date(?, '-30 day') THEN 1 ELSE 0 END) AS closed_30
      FROM work_packages wp JOIN statuses st ON st.id = wp.status_id
      WHERE wp.project_id IN (${ph}) GROUP BY wp.project_id, st.board_column`, today, ...currentIds, today, ...ids);
  const stageOf = (pid) => {
    const out = { stages: Object.fromEntries(columns.map(c => [c.key, 0])), unpicked: 0, in_sprint: 0, closed_30: 0, overdue: 0 };
    for (const x of byProjectStage) if (pid == null || x.project_id === pid) {
      out.stages[x.col] = (out.stages[x.col] || 0) + x.n; out.unpicked += x.unpicked || 0; out.in_sprint += x.in_sprint || 0;
      out.closed_30 += x.closed_30 || 0; out.overdue += x.overdue || 0;
    }
    return out;
  };

  // ---------- projects ----------
  const stats = projectStats(ids);
  const positions = positionsFor(ids);
  const projects = all(`SELECT p.id, p.name, p.identifier, p.color, p.status, p.status_explanation, p.manager_id, u.name AS manager_name
                        FROM projects p LEFT JOIN users u ON u.id = p.manager_id WHERE p.id IN (${ph}) ORDER BY p.name COLLATE NOCASE`, ...ids)
    .map(p => {
      const sp = sprintRows.filter(s => s.state === 'current' && get('SELECT 1 FROM sprint_projects WHERE sprint_id = ? AND project_id = ?', s.id, p.id));
      return { ...p, stats: stats.get(p.id), positions: positions.get(p.id), ...stageOf(p.id), current_sprints: sp.map(s => ({ id: s.id, name: s.name })) };
    });

  // ---------- sprint cards ----------
  const sprintTasks = sprintRows.length ? all(`SELECT wp.sprint_id, st.board_column AS col, COUNT(*) AS n,
        SUM(CASE WHEN st.is_closed = 0 AND wp.due_date < ? THEN 1 ELSE 0 END) AS overdue,
        COALESCE(SUM(wp.estimated_hours), 0) AS est
      FROM work_packages wp JOIN statuses st ON st.id = wp.status_id
      WHERE wp.sprint_id IN (${sprintRows.map(() => '?').join(',')}) AND wp.project_id IN (${ph})
      GROUP BY wp.sprint_id, st.board_column`, today, ...sprintRows.map(s => s.id), ...ids) : [];
  const card = (s) => {
    const stages = Object.fromEntries(columns.map(c => [c.key, 0]));
    let overdue = 0; let est = 0;
    for (const x of sprintTasks) if (x.sprint_id === s.id) { stages[x.col] = (stages[x.col] || 0) + x.n; overdue += x.overdue || 0; est += x.est || 0; }
    const total = Object.values(stages).reduce((a, b) => a + b, 0);
    const done = (stages.closed || 0) + (stages.rejected || 0);
    const projs = all(`SELECT p.id, p.name, p.identifier, p.color FROM sprint_projects x JOIN projects p ON p.id = x.project_id WHERE x.sprint_id = ? ORDER BY p.name COLLATE NOCASE`, s.id);
    const days = Math.round((Date.parse(s.end_date) - Date.parse(today)) / 864e5);
    const length = Math.round((Date.parse(s.end_date) - Date.parse(s.start_date)) / 864e5) + 1;
    const elapsed = Math.min(length, Math.max(0, Math.round((Date.parse(today) - Date.parse(s.start_date)) / 864e5) + 1));
    return { id: s.id, code: `SPR-${s.id}`, name: s.name, goal: s.goal, state: s.state, start_date: s.start_date, end_date: s.end_date,
      days_left: days, length, elapsed, projects: projs, stages, total, done, overdue, estimated: Math.round(est * 10) / 10 };
  };
  const sprints = {
    current: sprintRows.filter(s => s.state === 'current').map(card).sort((a, b) => a.end_date.localeCompare(b.end_date)),
    planned: sprintRows.filter(s => s.state === 'planned').slice(0, 6).map(card),
    ended_recent: sprintRows.filter(s => s.state === 'ended').slice(-3).reverse().map(card),
  };

  // ---------- open tasks by type ----------
  const types = all(`SELECT t.id, t.name, t.color, COUNT(*) AS n FROM work_packages wp JOIN statuses st ON st.id = wp.status_id JOIN types t ON t.id = wp.type_id
                     WHERE wp.project_id IN (${ph}) AND st.is_closed = 0 GROUP BY t.id ORDER BY t.position`, ...ids);

  // ---------- team members ----------
  const people = all(`SELECT u.id, u.name, u.job_title,
        SUM(CASE WHEN st.board_column = 'new' THEN 1 ELSE 0 END) AS s_new,
        SUM(CASE WHEN st.board_column = 'design' THEN 1 ELSE 0 END) AS s_design,
        SUM(CASE WHEN st.board_column = 'develop' THEN 1 ELSE 0 END) AS s_develop,
        SUM(CASE WHEN st.board_column = 'testing' THEN 1 ELSE 0 END) AS s_testing,
        SUM(CASE WHEN st.is_closed = 0 THEN 1 ELSE 0 END) AS open_count,
        SUM(CASE WHEN st.is_closed = 0 AND wp.due_date < ? THEN 1 ELSE 0 END) AS overdue,
        SUM(CASE WHEN st.is_closed = 0 AND wp.due_date >= ? AND wp.due_date <= date(?, '+7 day') THEN 1 ELSE 0 END) AS due_week,
        SUM(CASE WHEN st.is_closed = 0 AND wp.sprint_id IN (${curPh}) THEN 1 ELSE 0 END) AS in_sprint,
        SUM(CASE WHEN st.is_closed = 1 AND wp.closed_on >= date(?, '-30 day') THEN 1 ELSE 0 END) AS closed_30,
        ROUND(SUM(CASE WHEN st.is_closed = 0 THEN COALESCE(wp.estimated_hours, 0) * (100 - wp.done_ratio) / 100.0 ELSE 0 END), 1) AS remaining_hours,
        COUNT(DISTINCT CASE WHEN st.is_closed = 0 THEN wp.project_id END) AS projects
      FROM users u
      LEFT JOIN work_packages wp ON wp.assignee_id = u.id AND wp.project_id IN (${ph})
      LEFT JOIN statuses st ON st.id = wp.status_id
      WHERE u.status = 'active' AND (u.id IN (SELECT user_id FROM team_members) OR wp.id IS NOT NULL)
      GROUP BY u.id ORDER BY u.name COLLATE NOCASE`, today, today, today, ...currentIds, today, ...ids);
  const hours = new Map(all(`SELECT user_id, ROUND(SUM(hours), 1) AS h FROM time_entries WHERE spent_on >= ? AND project_id IN (${ph}) GROUP BY user_id`, ws, ...ids).map(x => [x.user_id, x.h]));
  const teams = all(`SELECT t.id, t.name, t.lead_id FROM teams t ORDER BY t.name COLLATE NOCASE`).map(t => ({
    ...t, member_ids: all('SELECT user_id FROM team_members WHERE team_id = ? ORDER BY position IS NULL, position', t.id).map(x => x.user_id),
  }));
  const peopleOut = people.map(p => ({ ...p, hours_week: hours.get(p.id) || 0 }));

  // ---------- totals ----------
  const all30 = stageOf(null);
  const openTotal = ['new', 'design', 'develop', 'testing'].reduce((a, k) => a + (all30.stages[k] || 0), 0);
  const cur = sprints.current;
  const totals = {
    projects: projects.length,
    at_risk: projects.filter(p => p.status === 'at_risk').length,
    off_track: projects.filter(p => p.status === 'off_track').length,
    team_gaps: projects.filter(p => Object.values(p.positions || {}).some(x => x.status !== 'active')).length,
    open: openTotal, overdue: all30.overdue, unpicked: all30.unpicked, closed_30: all30.closed_30,
    sprints_running: cur.length,
    sprint_total: cur.reduce((a, s) => a + s.total, 0), sprint_done: cur.reduce((a, s) => a + s.done, 0),
    hours_month: get(`SELECT ROUND(COALESCE(SUM(hours), 0), 1) AS h FROM time_entries WHERE project_id IN (${ph}) AND spent_on >= ?`, ...ids, today.slice(0, 8) + '01').h,
  };
  res.json({ columns, totals, stages: all30.stages, types, sprints, projects, people: peopleOut, teams, today });
});

export default r;
