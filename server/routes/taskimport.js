// Bulk upload of tasks (Sprint Planning -> Upload tasks). The browser reads the CSV or Excel file and sends its rows;
// names (project, type, priority, assignee, location) are matched here. First a check (dry_run) that reports each
// row's problems, then the import, which creates the rows without problems. New tasks are not in any sprint.
import { Router } from 'express';
import { get, all, tx } from '../db.js';
import { fail, can, visibleProjectIds } from '../access.js';
import { createWp } from './workpackages.js';

const r = Router();
const MAX_ROWS = 1000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const LOCATIONS = { local: ['local', 'on local'], staging: ['staging', 'on staging'], production: ['production', 'prod', 'live', 'on production'], external: ['external', 'on external'] };
const norm = (v) => String(v ?? '').trim();
const low = (v) => norm(v).toLowerCase();

// Dates: YYYY-MM-DD, DD/MM/YYYY or DD-MM-YYYY (Indian order), or a spreadsheet date sent as YYYY-MM-DD.
function readDay(v) {
  const s = norm(v);
  if (!s) return { day: null };
  if (DAY.test(s)) return { day: s };
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    const d = `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    if (!Number.isNaN(Date.parse(d)) && Number(m[2]) <= 12 && Number(m[1]) <= 31) return { day: d };
  }
  return { error: `"${s}" is not a date (use YYYY-MM-DD or DD/MM/YYYY)` };
}

function lookups(req) {
  const ids = visibleProjectIds(req, 'wp.create');
  const projects = ids.length ? all(`SELECT id, name, identifier, archived FROM projects WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids).filter(p => !p.archived) : [];
  return {
    projects,
    types: all('SELECT id, name FROM types ORDER BY position'),
    priorities: all('SELECT id, name, position FROM priorities ORDER BY position'),
    users: all("SELECT id, name, email FROM users WHERE status = 'active'"),
  };
}

function checkRow(req, raw, i, L, defaultProject) {
  const errors = [];
  const out = { row: raw.ref ?? i + 2 };
  // project: from the row, else the one chosen in the upload form
  let project = defaultProject;
  if (norm(raw.project)) {
    const v = low(raw.project);
    project = L.projects.find(p => String(p.id) === v || p.identifier.toLowerCase() === v || p.name.toLowerCase() === v) || null;
    if (!project) errors.push(`project "${norm(raw.project)}" not found, or you cannot add tasks to it`);
  } else if (!project) errors.push('no project: add a Project column or choose one');
  out.project_id = project?.id ?? null;
  out.project = project?.name ?? norm(raw.project);

  const description = norm(raw.description).slice(0, 20000);
  let subject = norm(raw.subject);
  if (!subject && description) subject = description.replace(/\s+/g, ' ').slice(0, 60).trim(); // like the earlier imports: start of the description
  if (!subject) errors.push('subject is empty');
  out.subject = subject.slice(0, 255);
  out.description = description || null;
  out.solution = norm(raw.solution).slice(0, 20000) || null;
  out.module = norm(raw.module).slice(0, 80) || null;
  out.requested_by = norm(raw.requested_by).slice(0, 100) || null;

  if (norm(raw.type)) {
    const t = L.types.find(x => x.name.toLowerCase() === low(raw.type));
    if (t) { out.type_id = t.id; out.type = t.name; } else errors.push(`type "${norm(raw.type)}" not found (${L.types.map(x => x.name).join(', ')})`);
  }
  if (norm(raw.priority)) {
    const v = low(raw.priority);
    // "P2", "P2 - High", "High"
    const code = v.match(/^p\s*(\d)\b/);
    const p = L.priorities.find(x => x.name.toLowerCase() === v)
      || (code && L.priorities.find(x => x.name.toLowerCase().startsWith(`p${code[1]}`)))
      || L.priorities.find(x => x.name.toLowerCase().replace(/^p\d\s*-\s*/, '') === v.replace(/^p\d\s*-\s*/, ''));
    if (p) { out.priority_id = p.id; out.priority = p.name; } else errors.push(`priority "${norm(raw.priority)}" not found`);
  }
  if (norm(raw.location)) {
    const v = low(raw.location);
    const k = Object.keys(LOCATIONS).find(key => key === v || LOCATIONS[key].includes(v));
    if (k) out.location = k; else errors.push(`location "${norm(raw.location)}" not known (Local, Staging, Production, External)`);
  }
  if (norm(raw.assignee)) {
    const v = low(raw.assignee);
    const u = L.users.find(x => x.email?.toLowerCase() === v || x.name.toLowerCase() === v)
      || (L.users.filter(x => x.name.toLowerCase().split(/\s+/)[0] === v.split(/\s+/)[0]).length === 1 ? L.users.find(x => x.name.toLowerCase().split(/\s+/)[0] === v.split(/\s+/)[0]) : null);
    if (!u) errors.push(`assignee "${norm(raw.assignee)}" not found`);
    else {
      out.assignee_id = u.id; out.assignee = u.name;
      if (project && u.id !== req.user.id && !can(req, 'wp.assign', project.id) && !can(req, 'wp.edit', project.id)) errors.push('you can only assign tasks to yourself in this project');
    }
  }
  if (norm(raw.estimated_hours)) {
    const h = Number(String(raw.estimated_hours).replace(/h(rs?|ours?)?$/i, '').trim());
    if (Number.isFinite(h) && h >= 0 && h <= 10000) out.estimated_hours = h; else errors.push(`estimated hours "${norm(raw.estimated_hours)}" is not a number`);
  }
  for (const k of ['start_date', 'due_date']) {
    const d = readDay(raw[k]);
    if (d.error) errors.push(`${k === 'start_date' ? 'start' : 'due'} date: ${d.error}`); else if (d.day) out[k] = d.day;
  }
  if (out.start_date && out.due_date && out.due_date < out.start_date) errors.push('due date is before the start date');
  return { ...out, errors, ok: !errors.length };
}

r.post('/work-packages/import', (req, res) => {
  const b = req.body || {};
  const rows = Array.isArray(b.rows) ? b.rows : [];
  if (!rows.length) fail(400, 'The file has no task rows.');
  if (rows.length > MAX_ROWS) fail(400, `Upload at most ${MAX_ROWS} tasks at a time (this file has ${rows.length}).`);
  const L = lookups(req);
  if (!L.projects.length) fail(403, 'You cannot add tasks to any project.');
  let defaultProject = null;
  if (b.project_id) defaultProject = L.projects.find(p => String(p.id) === String(b.project_id)) || fail(403, 'You cannot add tasks to that project.');
  const checked = rows.map((x, i) => checkRow(req, x || {}, i, L, defaultProject));
  const valid = checked.filter(x => x.ok);
  if (b.dry_run) return res.json({ rows: checked, valid: valid.length, invalid: checked.length - valid.length });
  if (!valid.length) fail(400, 'None of the rows can be imported; fix the problems shown and upload again.');
  const fileNote = norm(b.file_name).slice(0, 120);
  const created = tx(() => valid.map(x => {
    const wp = createWp(req, x.project_id, {
      subject: x.subject, description: x.description, solution: x.solution, module: x.module, requested_by: x.requested_by,
      type_id: x.type_id, priority_id: x.priority_id, location: x.location, assignee_id: x.assignee_id,
      estimated_hours: x.estimated_hours, start_date: x.start_date, due_date: x.due_date, source: 'project',
    }, { journalNote: fileNote ? `Uploaded from ${fileNote} (row ${x.row})` : `Uploaded (row ${x.row})` });
    return { row: x.row, id: wp.id, key: wp.key };
  }));
  res.status(201).json({ created: created.length, skipped: checked.length - valid.length, items: created });
});

export default r;
