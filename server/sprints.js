// Sprint rules shared by the Sprint Planning routes and the task routes.
// A sprint is planned (starts later), current (running today) or ended (past its end date, or ended with "End now").
import { get } from './db.js';
import { fail } from './access.js';
import { todayISO } from './util.js';

export function sprintState(s, today = todayISO()) {
  if (!s) return null;
  if (s.ended_at || s.end_date < today) return 'ended';
  if (s.start_date <= today) return 'current';
  return 'planned';
}
export const loadSprint = (id) => (id ? get('SELECT * FROM sprints WHERE id = ?', id) : null);

// The running sprint (the latest-starting one if several overlap).
export function currentSprint() {
  const t = todayISO();
  return get('SELECT * FROM sprints WHERE ended_at IS NULL AND start_date <= ? AND end_date >= ? ORDER BY start_date DESC, id DESC LIMIT 1', t, t) || null;
}

// Moving a task into or out of a sprint. Anyone who may edit the task can use planned sprints;
// a current or ended sprint is locked: only an administrator can add tasks to it or take them out.
// A sprint holds tasks of its own project only.
export function checkSprintMove(req, fromId, toId, projectId) {
  fromId = fromId ?? null; toId = toId ?? null;
  if (fromId === toId) return null;
  const to = toId ? loadSprint(toId) : null;
  if (toId && !to) fail(400, 'That sprint does not exist.');
  if (to && projectId && to.project_id && to.project_id !== projectId) {
    const pn = get('SELECT name FROM projects WHERE id = ?', to.project_id)?.name;
    fail(400, `${to.name} is a sprint of ${pn || 'another project'}; only that project's tasks can go into it.`);
  }
  if (req.user.is_admin) return to;
  if (toId && req.sprintSetup === toId && !fromId) return to; // picking tasks while creating the sprint
  const from = fromId ? loadSprint(fromId) : null;
  const locked = (s) => { const st = sprintState(s); return st === 'current' ? 'has already started' : st === 'ended' ? 'has ended' : null; };
  if (from && locked(from)) fail(403, `${from.name} ${locked(from)}, so only an administrator can move its tasks.`);
  if (to && locked(to)) fail(403, `${to.name} ${locked(to)}, so only an administrator can add tasks to it.`);
  return to;
}
