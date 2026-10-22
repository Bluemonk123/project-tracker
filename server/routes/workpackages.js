import { Router } from 'express';
import { get, all, run, tx } from '../db.js';
import { need, can, fail, visibleProjectIds } from '../access.js';
import { requireText, dateOrNull, intOrNull, numOrNull, notify, mentionedUserIds, todayISO } from '../util.js';
import { resolveProject } from './projects.js';

const r = Router();

const BASE_SELECT = `
  SELECT wp.*, p.identifier AS project_identifier, p.name AS project_name, p.color AS project_color,
    p.identifier || '-' || wp.number AS key,
    t.name AS type_name, t.color AS type_color, t.is_milestone,
    s.name AS status_name, s.color AS status_color, s.is_closed,
    pr.name AS priority_name, pr.color AS priority_color, pr.position AS priority_position,
    a.name AS assignee_name, rs.name AS responsible_name, au.name AS author_name,
    v.name AS version_name, c.name AS category_name,
    par.subject AS parent_subject, p.identifier || '-' || par.number AS parent_key,
    (SELECT COUNT(*) FROM work_packages ch WHERE ch.parent_id = wp.id) AS children_count,
    (SELECT COALESCE(SUM(te.hours), 0) FROM time_entries te WHERE te.wp_id = wp.id) AS spent_hours
  FROM work_packages wp
  JOIN projects p ON p.id = wp.project_id
  JOIN types t ON t.id = wp.type_id
  JOIN statuses s ON s.id = wp.status_id
  JOIN priorities pr ON pr.id = wp.priority_id
  LEFT JOIN users a ON a.id = wp.assignee_id
  LEFT JOIN users rs ON rs.id = wp.responsible_id
  LEFT JOIN users au ON au.id = wp.author_id
  LEFT JOIN versions v ON v.id = wp.version_id
  LEFT JOIN categories c ON c.id = wp.category_id
  LEFT JOIN work_packages par ON par.id = wp.parent_id`;

const SORTS = {
  id: 'wp.id', key: 'p.identifier, wp.number', subject: 'wp.subject COLLATE NOCASE', type: 't.position', status: 's.position',
  priority: 'pr.position', assignee: 'a.name', due_date: 'wp.due_date', start_date: 'wp.start_date',
  updated_at: 'wp.updated_at', created_at: 'wp.created_at', project: 'p.name', version: 'v.name', position: 'wp.position',
  done_ratio: 'wp.done_ratio', estimated_hours: 'wp.estimated_hours',
};

const listParam = (v) => (v === undefined || v === '' ? [] : String(v).split(',').map(s => s.trim()).filter(Boolean));

// Shared filter builder used by list, CSV export, board, gantt and calendar.
export function buildFilter(req, q) {
  const where = [];
  const params = [];
  let projectIds;
  if (q.project_id) {
    const p = resolveProject(q.project_id);
    need(req, 'wp.view', p.id);
    projectIds = [p.id];
    if (q.include_subprojects === '1') {
      const kids = all('SELECT id FROM projects WHERE parent_id = ? AND archived = 0', p.id).map(x => x.id)
        .filter(id => can(req, 'wp.view', id));
      projectIds.push(...kids);
    }
  } else {
    projectIds = visibleProjectIds(req, 'wp.view');
  }
  if (!projectIds.length) return { where: '0', params: [] };
  where.push(`wp.project_id IN (${projectIds.map(() => '?').join(',')})`);
  params.push(...projectIds);

  const status = q.status ?? 'open';
  if (status === 'open') where.push('s.is_closed = 0');
  else if (status === 'closed') where.push('s.is_closed = 1');
  else if (status !== 'all') {
    const ids = listParam(status).map(Number).filter(Boolean);
    if (ids.length) { where.push(`wp.status_id IN (${ids.map(() => '?').join(',')})`); params.push(...ids); }
  }
  const inFilter = (col, val) => {
    const vals = listParam(val);
    if (!vals.length) return;
    const parts = [];
    const ids = [];
    for (const v of vals) {
      if (v === 'me') ids.push(req.user.id);
      else if (v === 'none') parts.push(`${col} IS NULL`);
      else if (/^\d+$/.test(v)) ids.push(Number(v));
    }
    if (ids.length) { parts.push(`${col} IN (${ids.map(() => '?').join(',')})`); params.push(...ids); }
    if (parts.length) where.push(`(${parts.join(' OR ')})`);
  };
  inFilter('wp.type_id', q.type_id);
  inFilter('wp.priority_id', q.priority_id);
  inFilter('wp.assignee_id', q.assignee_id);
  inFilter('wp.responsible_id', q.responsible_id);
  inFilter('wp.author_id', q.author_id);
  inFilter('wp.version_id', q.version_id);
  inFilter('wp.category_id', q.category_id);
  if (q.parent_id === 'none') where.push('wp.parent_id IS NULL');
  else inFilter('wp.parent_id', q.parent_id);
  if (q.watched === '1') { where.push('wp.id IN (SELECT wp_id FROM wp_watchers WHERE user_id = ?)'); params.push(req.user.id); }
  if (q.involved === '1') {
    where.push('(wp.assignee_id = ? OR wp.responsible_id = ? OR wp.author_id = ?)');
    params.push(req.user.id, req.user.id, req.user.id);
  }
  if (q.overdue === '1') { where.push('wp.due_date < ? AND s.is_closed = 0'); params.push(todayISO()); }
  if (q.due_from) { where.push('wp.due_date >= ?'); params.push(q.due_from); }
  if (q.due_to) { where.push('wp.due_date <= ?'); params.push(q.due_to); }
  // overlapping a date window (calendar / gantt)
  if (q.from && q.to) {
    where.push('COALESCE(wp.start_date, wp.due_date) <= ? AND COALESCE(wp.due_date, wp.start_date) >= ?');
    params.push(q.to, q.from);
  }
  if (q.has_dates === '1') where.push('(wp.start_date IS NOT NULL OR wp.due_date IS NOT NULL)');
  if (q.updated_since) { where.push('wp.updated_at >= ?'); params.push(q.updated_since); }
  if (q.q) {
    const term = String(q.q).trim();
    const keyMatch = term.match(/^([A-Za-z][A-Za-z0-9]*)-(\d+)$/);
    if (keyMatch) {
      where.push('(p.identifier = ? COLLATE NOCASE AND wp.number = ?)');
      params.push(keyMatch[1], Number(keyMatch[2]));
    } else if (/^#?\d+$/.test(term)) {
      where.push('(wp.id = ? OR wp.number = ? OR wp.subject LIKE ?)');
      params.push(Number(term.replace('#', '')), Number(term.replace('#', '')), `%${term}%`);
    } else {
      where.push('(wp.subject LIKE ? OR wp.description LIKE ?)');
      params.push(`%${term}%`, `%${term}%`);
    }
  }
  return { where: where.join(' AND '), params };
}

function orderBy(sort) {
  const parts = listParam(sort || 'id:desc').map(s => {
    const [f, d] = s.split(':');
    const col = SORTS[f];
    if (!col) return null;
    const dir = d === 'asc' ? 'ASC' : 'DESC';
    // nulls last for dates/names
    return col.split(',').map(c => `${c.trim()} IS NULL, ${c.trim()} ${dir}`).join(', ');
  }).filter(Boolean);
  return parts.length ? parts.join(', ') + ', wp.id DESC' : 'wp.id DESC';
}

r.get('/work-packages', (req, res) => {
  const { where, params } = buildFilter(req, req.query);
  const limit = Math.min(Number(req.query.limit) || 200, 2000);
  const offset = Number(req.query.offset) || 0;
  const total = get(`SELECT COUNT(*) AS n FROM work_packages wp JOIN projects p ON p.id = wp.project_id
                     JOIN statuses s ON s.id = wp.status_id WHERE ${where}`, ...params).n;
  const rows = all(`${BASE_SELECT} WHERE ${where} ORDER BY ${orderBy(req.query.sort)} LIMIT ? OFFSET ?`, ...params, limit, offset);
  let relations = [];
  if (req.query.with_relations === '1' && rows.length) {
    const ids = rows.map(x => x.id);
    const ph = ids.map(() => '?').join(',');
    relations = all(`SELECT * FROM wp_relations WHERE from_id IN (${ph}) AND to_id IN (${ph})`, ...ids, ...ids);
  }
  res.json({ total, rows, relations });
});

r.get('/work-packages/export.csv', (req, res) => {
  const { where, params } = buildFilter(req, req.query);
  const rows = all(`${BASE_SELECT} WHERE ${where} ORDER BY ${orderBy(req.query.sort)} LIMIT 10000`, ...params);
  const cols = [['key', 'ID'], ['project_name', 'Project'], ['type_name', 'Type'], ['subject', 'Subject'], ['status_name', 'Status'],
    ['priority_name', 'Priority'], ['assignee_name', 'Assignee'], ['responsible_name', 'Accountable'], ['version_name', 'Version'],
    ['start_date', 'Start date'], ['due_date', 'Due date'], ['estimated_hours', 'Estimated hours'], ['spent_hours', 'Spent hours'],
    ['done_ratio', '% done'], ['parent_key', 'Parent'], ['author_name', 'Author'], ['created_at', 'Created'], ['updated_at', 'Updated']];
  const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [cols.map(c => c[1]).join(','), ...rows.map(r1 => cols.map(c => esc(r1[c[0]])).join(','))].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="work-packages-${todayISO()}.csv"`);
  res.send('﻿' + csv);
});

export function loadWp(id) {
  return get(`${BASE_SELECT} WHERE wp.id = ?`, id) || fail(404, 'Work package not found.');
}

export function canEditWp(req, wp) {
  if (can(req, 'wp.edit', wp.project_id)) return true;
  if (can(req, 'wp.edit_own', wp.project_id)) {
    const me = req.user.id;
    return wp.assignee_id === me || wp.author_id === me || wp.responsible_id === me;
  }
  return false;
}

function checkMemberOrNull(projectId, userId, label) {
  if (userId == null) return null;
  const u = get("SELECT id FROM users WHERE id = ? AND status = 'active'", userId);
  if (!u) fail(400, `${label} must be an active user.`);
  return u.id;
}

function validateRefs(projectId, f, wpId = null) {
  if (f.type_id !== undefined && !get('SELECT id FROM types WHERE id = ?', f.type_id)) fail(400, 'Unknown type.');
  if (f.status_id !== undefined && !get('SELECT id FROM statuses WHERE id = ?', f.status_id)) fail(400, 'Unknown status.');
  if (f.priority_id !== undefined && !get('SELECT id FROM priorities WHERE id = ?', f.priority_id)) fail(400, 'Unknown priority.');
  if (f.version_id && !get('SELECT id FROM versions WHERE id = ? AND project_id = ?', f.version_id, projectId)) fail(400, 'That version belongs to another project.');
  if (f.category_id && !get('SELECT id FROM categories WHERE id = ? AND project_id = ?', f.category_id, projectId)) fail(400, 'That category belongs to another project.');
  if (f.assignee_id !== undefined) f.assignee_id = checkMemberOrNull(projectId, f.assignee_id, 'Assignee');
  if (f.responsible_id !== undefined) f.responsible_id = checkMemberOrNull(projectId, f.responsible_id, 'Accountable');
  if (f.parent_id) {
    const parent = get('SELECT id, project_id FROM work_packages WHERE id = ?', f.parent_id) || fail(400, 'Parent work package not found.');
    if (wpId) {
      // prevent cycles
      let cur = parent.id;
      for (let i = 0; cur && i < 100; i++) {
        if (cur === wpId) fail(400, 'A work package cannot be placed under one of its own children.');
        cur = get('SELECT parent_id FROM work_packages WHERE id = ?', cur)?.parent_id;
      }
    }
  }
  if (f.start_date && f.due_date && f.start_date > f.due_date) fail(400, 'Finish date must be on or after the start date.');
  if (f.done_ratio != null && (f.done_ratio < 0 || f.done_ratio > 100)) fail(400, '% done must be between 0 and 100.');
  if (f.estimated_hours != null && f.estimated_hours < 0) fail(400, 'Estimated hours cannot be negative.');
}

function readFields(b) {
  return {
    type_id: intOrNull(b.type_id) ?? undefined,
    subject: b.subject !== undefined ? requireText(b.subject, 'Subject') : undefined,
    description: b.description,
    status_id: intOrNull(b.status_id) ?? undefined,
    priority_id: intOrNull(b.priority_id) ?? undefined,
    assignee_id: intOrNull(b.assignee_id),
    responsible_id: intOrNull(b.responsible_id),
    parent_id: intOrNull(b.parent_id),
    version_id: intOrNull(b.version_id),
    category_id: intOrNull(b.category_id),
    start_date: dateOrNull(b.start_date, 'Start date'),
    due_date: dateOrNull(b.due_date, 'Finish date'),
    estimated_hours: numOrNull(b.estimated_hours),
    done_ratio: intOrNull(b.done_ratio),
    position: numOrNull(b.position) ?? undefined,
  };
}

// Next per-project number (CRM-1, CRM-2, ...). Robust even if wp_seq was not maintained by an import.
function nextNumber(projectId) {
  const n = get(`SELECT MAX(COALESCE(p.wp_seq, 0), COALESCE((SELECT MAX(number) FROM work_packages WHERE project_id = p.id), 0)) + 1 AS n
                 FROM projects p WHERE p.id = ?`, projectId).n;
  run('UPDATE projects SET wp_seq = ? WHERE id = ?', n, projectId);
  return n;
}

const watch = (wpId, userId) => userId && run('INSERT OR IGNORE INTO wp_watchers(wp_id, user_id) VALUES(?,?)', wpId, userId);

export function createWp(req, projectId, body, { journalNote } = {}) {
  need(req, 'wp.create', projectId);
  const f = readFields(body);
  if (!f.subject) fail(400, 'Subject is required.');
  if ((f.assignee_id && f.assignee_id !== req.user.id) || (f.responsible_id && f.responsible_id !== req.user.id)) {
    if (!can(req, 'wp.assign', projectId) && !can(req, 'wp.edit', projectId)) fail(403, 'You can only assign work to yourself.');
  }
  f.type_id ??= get('SELECT id FROM types ORDER BY position LIMIT 1').id;
  f.status_id ??= (get('SELECT id FROM statuses WHERE is_default = 1') || get('SELECT id FROM statuses ORDER BY position LIMIT 1')).id;
  f.priority_id ??= (get('SELECT id FROM priorities WHERE is_default = 1') || get('SELECT id FROM priorities ORDER BY position LIMIT 1')).id;
  const t = get('SELECT is_milestone FROM types WHERE id = ?', f.type_id);
  if (t?.is_milestone && f.due_date && !f.start_date) f.start_date = f.due_date;
  if (t?.is_milestone && f.start_date && !f.due_date) f.due_date = f.start_date;
  validateRefs(projectId, f);
  const st = get('SELECT done_ratio FROM statuses WHERE id = ?', f.status_id);
  if (st?.done_ratio != null && f.done_ratio == null) f.done_ratio = st.done_ratio;
  return tx(() => {
    const number = nextNumber(projectId);
    const pos = get('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM work_packages WHERE project_id = ?', projectId).p;
    const { id } = run(`INSERT INTO work_packages(project_id, number, type_id, subject, description, status_id, priority_id, assignee_id,
        responsible_id, author_id, parent_id, version_id, category_id, start_date, due_date, estimated_hours, done_ratio, position)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      projectId, number, f.type_id, f.subject, f.description || null, f.status_id, f.priority_id, f.assignee_id || null,
      f.responsible_id || null, req.user.id, f.parent_id || null, f.version_id || null, f.category_id || null,
      f.start_date || null, f.due_date || null, f.estimated_hours ?? null, f.done_ratio ?? 0, f.position ?? pos);
    run('INSERT INTO journals(wp_id, user_id, notes, changes) VALUES(?,?,?,?)', id, req.user.id, journalNote || null, JSON.stringify({ created: [null, true] }));
    watch(id, req.user.id); watch(id, f.assignee_id); watch(id, f.responsible_id);
    const wp = loadWp(id);
    if (f.assignee_id) notify([f.assignee_id], { actorId: req.user.id, projectId, wpId: id, reason: 'assigned', message: `${req.user.name} assigned you ${wp.key}: ${wp.subject}` });
    if (f.responsible_id) notify([f.responsible_id], { actorId: req.user.id, projectId, wpId: id, reason: 'accountable', message: `${req.user.name} made you accountable for ${wp.key}: ${wp.subject}` });
    notify(mentionedUserIds(f.description), { actorId: req.user.id, projectId, wpId: id, reason: 'mentioned', message: `${req.user.name} mentioned you in ${wp.key}: ${wp.subject}` });
    return wp;
  });
}

r.post('/work-packages', (req, res) => {
  const p = resolveProject(req.body.project_id);
  if (p.archived) fail(400, 'This project is archived.');
  res.status(201).json(createWp(req, p.id, req.body));
});

r.get('/work-packages/:id', (req, res) => {
  const wp = loadWp(req.params.id);
  need(req, 'wp.view', wp.project_id);
  const children = all(`${BASE_SELECT} WHERE wp.parent_id = ? ORDER BY wp.position, wp.id`, wp.id);
  const relations = all(`
    SELECT rel.id, rel.type, rel.from_id, rel.to_id,
      CASE WHEN rel.from_id = ? THEN 'out' ELSE 'in' END AS direction,
      o.id AS other_id, op.identifier || '-' || o.number AS other_key, o.subject AS other_subject,
      os.name AS other_status, os.color AS other_status_color, os.is_closed AS other_closed
    FROM wp_relations rel
    JOIN work_packages o ON o.id = CASE WHEN rel.from_id = ? THEN rel.to_id ELSE rel.from_id END
    JOIN projects op ON op.id = o.project_id JOIN statuses os ON os.id = o.status_id
    WHERE rel.from_id = ? OR rel.to_id = ?`, wp.id, wp.id, wp.id, wp.id);
  const journals = all(`SELECT j.*, u.name AS user_name FROM journals j LEFT JOIN users u ON u.id = j.user_id
                        WHERE j.wp_id = ? ORDER BY j.created_at, j.id`, wp.id);
  const watchers = all('SELECT u.id, u.name FROM wp_watchers w JOIN users u ON u.id = w.user_id WHERE w.wp_id = ? ORDER BY u.name', wp.id);
  const attachments = all(`SELECT a.*, u.name AS uploaded_by_name FROM attachments a LEFT JOIN users u ON u.id = a.uploaded_by
                           WHERE a.container_type = 'wp' AND a.container_id = ? ORDER BY a.created_at`, wp.id);
  const time = all(`SELECT te.*, u.name AS user_name FROM time_entries te JOIN users u ON u.id = te.user_id
                    WHERE te.wp_id = ? ORDER BY te.spent_on DESC, te.id DESC`, wp.id);
  const meetings = all(`SELECT m.id, m.title, m.starts_at FROM meetings m WHERE m.id IN (
                          SELECT meeting_id FROM meeting_agenda_items WHERE wp_id = ? UNION SELECT meeting_id FROM meeting_actions WHERE wp_id = ?)
                        ORDER BY m.starts_at DESC`, wp.id, wp.id);
  const ancestors = [];
  let cur = wp.parent_id;
  for (let i = 0; cur && i < 20; i++) {
    const a = get(`SELECT wp.id, wp.parent_id, wp.subject, p.identifier || '-' || wp.number AS key FROM work_packages wp
                   JOIN projects p ON p.id = wp.project_id WHERE wp.id = ?`, cur);
    if (!a) break;
    ancestors.unshift(a);
    cur = a.parent_id;
  }
  res.json({
    ...wp, children, relations, journals, watchers, attachments, time, meetings, ancestors,
    can: {
      edit: canEditWp(req, wp), assign: can(req, 'wp.assign', wp.project_id) || can(req, 'wp.edit', wp.project_id),
      delete: can(req, 'wp.delete', wp.project_id), comment: can(req, 'wp.comment', wp.project_id),
      log_time: can(req, 'time.log', wp.project_id), upload: can(req, 'files.upload', wp.project_id),
      create: can(req, 'wp.create', wp.project_id),
    },
    watching: watchers.some(w => w.id === req.user.id),
  });
});

const TRACKED = ['type_id', 'subject', 'description', 'status_id', 'priority_id', 'assignee_id', 'responsible_id', 'parent_id',
  'version_id', 'category_id', 'start_date', 'due_date', 'estimated_hours', 'done_ratio'];

export function updateWp(req, wp, body) {
  if (!canEditWp(req, wp)) fail(403, 'You do not have permission to edit this work package.');
  const f = readFields(body);
  let projectId = wp.project_id;
  if (body.project_id && Number(body.project_id) !== wp.project_id) {
    // move to another project
    const target = resolveProject(body.project_id);
    need(req, 'wp.create', target.id);
    need(req, 'wp.edit', wp.project_id);
    projectId = target.id;
    f.version_id = null; f.category_id = null;
    if (!body.parent_id) f.parent_id = null;
  }
  const changingPeople = (f.assignee_id !== undefined && f.assignee_id !== wp.assignee_id && f.assignee_id !== req.user.id)
    || (f.responsible_id !== undefined && f.responsible_id !== wp.responsible_id && f.responsible_id !== req.user.id);
  if (changingPeople && !can(req, 'wp.assign', wp.project_id) && !can(req, 'wp.edit', wp.project_id)) fail(403, 'You can only assign work to yourself.');
  validateRefs(projectId, f, wp.id);
  const start = f.start_date !== undefined ? f.start_date : wp.start_date;
  const due = f.due_date !== undefined ? f.due_date : wp.due_date;
  if (start && due && start > due) fail(400, 'Finish date must be on or after the start date.');
  if (f.status_id && f.status_id !== wp.status_id && f.done_ratio === undefined) {
    const st = get('SELECT done_ratio FROM statuses WHERE id = ?', f.status_id);
    if (st?.done_ratio != null) f.done_ratio = st.done_ratio;
  }
  const changes = {};
  for (const k of TRACKED) if (f[k] !== undefined && (f[k] ?? null) !== (wp[k] ?? null)) changes[k] = [wp[k] ?? null, f[k] ?? null];
  const set = { ...f };
  if (projectId !== wp.project_id) { set.project_id = projectId; changes.project_id = [wp.project_id, projectId]; }
  const keys = Object.keys(set).filter(k => set[k] !== undefined);
  return tx(() => {
    if (keys.length) {
      if (projectId !== wp.project_id) {
        set.number = nextNumber(projectId);
        keys.push('number');
      }
      run(`UPDATE work_packages SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`, ...keys.map(k => set[k]), wp.id);
    }
    const note = body.notes ? String(body.notes) : null;
    const meaningful = Object.keys(changes).filter(k => k !== 'position');
    if (meaningful.length || note) {
      run('INSERT INTO journals(wp_id, user_id, notes, changes) VALUES(?,?,?,?)', wp.id, req.user.id, note,
        meaningful.length ? JSON.stringify(Object.fromEntries(meaningful.map(k => [k, changes[k]]))) : null);
    }
    const fresh = loadWp(wp.id);
    if (changes.assignee_id && changes.assignee_id[1]) {
      watch(wp.id, changes.assignee_id[1]);
      notify([changes.assignee_id[1]], { actorId: req.user.id, projectId, wpId: wp.id, reason: 'assigned', message: `${req.user.name} assigned you ${fresh.key}: ${fresh.subject}` });
    }
    if (changes.responsible_id && changes.responsible_id[1]) {
      watch(wp.id, changes.responsible_id[1]);
      notify([changes.responsible_id[1]], { actorId: req.user.id, projectId, wpId: wp.id, reason: 'accountable', message: `${req.user.name} made you accountable for ${fresh.key}: ${fresh.subject}` });
    }
    if (changes.status_id || note) {
      const watchers = all('SELECT user_id FROM wp_watchers WHERE wp_id = ?', wp.id).map(x => x.user_id);
      const msg = changes.status_id ? `${req.user.name} moved ${fresh.key} to ${fresh.status_name}` : `${req.user.name} commented on ${fresh.key}: ${fresh.subject}`;
      notify(watchers, { actorId: req.user.id, projectId, wpId: wp.id, reason: changes.status_id ? 'status' : 'commented', message: msg });
    }
    const mentioned = [...mentionedUserIds(note), ...(changes.description ? mentionedUserIds(f.description) : [])];
    notify(mentioned, { actorId: req.user.id, projectId, wpId: wp.id, reason: 'mentioned', message: `${req.user.name} mentioned you in ${fresh.key}: ${fresh.subject}` });
    return fresh;
  });
}

r.patch('/work-packages/:id', (req, res) => {
  const wp = loadWp(req.params.id);
  res.json(updateWp(req, wp, req.body));
});

r.patch('/work-packages-bulk', (req, res) => {
  const ids = (req.body.ids || []).map(Number).filter(Boolean);
  if (!ids.length) fail(400, 'Select at least one work package.');
  const allowed = ['status_id', 'priority_id', 'assignee_id', 'responsible_id', 'version_id', 'type_id', 'due_date', 'start_date', 'done_ratio'];
  const changes = Object.fromEntries(Object.entries(req.body.changes || {}).filter(([k]) => allowed.includes(k)));
  if (!Object.keys(changes).length) fail(400, 'Choose what to change.');
  let updated = 0;
  tx(() => { for (const id of ids) { updateWp(req, loadWp(id), changes); updated++; } });
  res.json({ updated });
});

r.delete('/work-packages/:id', (req, res) => {
  const wp = loadWp(req.params.id);
  need(req, 'wp.delete', wp.project_id);
  run('DELETE FROM work_packages WHERE id = ?', wp.id);
  res.json({ ok: true });
});

r.post('/work-packages/:id/comments', (req, res) => {
  const wp = loadWp(req.params.id);
  need(req, 'wp.comment', wp.project_id);
  const notes = requireText(req.body.notes, 'Comment');
  tx(() => {
    run('INSERT INTO journals(wp_id, user_id, notes) VALUES(?,?,?)', wp.id, req.user.id, notes);
    run("UPDATE work_packages SET updated_at = datetime('now') WHERE id = ?", wp.id);
    watch(wp.id, req.user.id);
  });
  const watchers = all('SELECT user_id FROM wp_watchers WHERE wp_id = ?', wp.id).map(x => x.user_id);
  const mentioned = mentionedUserIds(notes);
  notify(mentioned, { actorId: req.user.id, projectId: wp.project_id, wpId: wp.id, reason: 'mentioned', message: `${req.user.name} mentioned you in ${wp.key}: ${wp.subject}` });
  notify(watchers.filter(id => !mentioned.includes(id)), { actorId: req.user.id, projectId: wp.project_id, wpId: wp.id, reason: 'commented', message: `${req.user.name} commented on ${wp.key}: ${wp.subject}` });
  res.status(201).json({ ok: true });
});

r.patch('/journals/:id', (req, res) => {
  const j = get('SELECT j.*, wp.project_id FROM journals j JOIN work_packages wp ON wp.id = j.wp_id WHERE j.id = ?', req.params.id) || fail(404, 'Comment not found.');
  if (j.user_id !== req.user.id && !req.user.is_admin) fail(403, 'You can only edit your own comments.');
  run('UPDATE journals SET notes = ? WHERE id = ?', requireText(req.body.notes, 'Comment'), j.id);
  res.json({ ok: true });
});

r.post('/work-packages/:id/relations', (req, res) => {
  const wp = loadWp(req.params.id);
  if (!canEditWp(req, wp)) fail(403, 'You do not have permission to edit this work package.');
  const type = ['relates', 'blocks', 'precedes', 'duplicates', 'blocked_by', 'follows'].includes(req.body.type) ? req.body.type : fail(400, 'Unknown relation type.');
  const other = loadWp(req.body.to_id);
  need(req, 'wp.view', other.project_id);
  if (other.id === wp.id) fail(400, 'A work package cannot relate to itself.');
  // store inverse types in canonical direction
  const [from, to, t] = type === 'blocked_by' ? [other.id, wp.id, 'blocks'] : type === 'follows' ? [other.id, wp.id, 'precedes'] : [wp.id, other.id, type];
  if (get('SELECT id FROM wp_relations WHERE ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?))', from, to, to, from)) fail(400, 'These work packages are already related.');
  const { id } = run('INSERT INTO wp_relations(from_id, to_id, type) VALUES(?,?,?)', from, to, t);
  run('INSERT INTO journals(wp_id, user_id, changes) VALUES(?,?,?)', wp.id, req.user.id, JSON.stringify({ relation_added: [null, `${type} ${other.key}`] }));
  res.status(201).json({ id });
});

r.delete('/relations/:id', (req, res) => {
  const rel = get('SELECT * FROM wp_relations WHERE id = ?', req.params.id) || fail(404, 'Relation not found.');
  const wp = loadWp(rel.from_id);
  if (!canEditWp(req, wp) && !canEditWp(req, loadWp(rel.to_id))) fail(403, 'You do not have permission to change this relation.');
  run('DELETE FROM wp_relations WHERE id = ?', rel.id);
  res.json({ ok: true });
});

r.post('/work-packages/:id/watchers', (req, res) => {
  const wp = loadWp(req.params.id);
  need(req, 'wp.view', wp.project_id);
  const uid = Number(req.body.user_id || req.user.id);
  if (uid !== req.user.id && !canEditWp(req, wp)) fail(403, 'You can only add yourself as a watcher.');
  watch(wp.id, uid);
  res.status(201).json({ ok: true });
});

r.delete('/work-packages/:id/watchers/:uid', (req, res) => {
  const wp = loadWp(req.params.id);
  const uid = Number(req.params.uid);
  if (uid !== req.user.id && !canEditWp(req, wp)) fail(403, 'You can only remove yourself.');
  run('DELETE FROM wp_watchers WHERE wp_id = ? AND user_id = ?', wp.id, uid);
  res.json({ ok: true });
});

export default r;
