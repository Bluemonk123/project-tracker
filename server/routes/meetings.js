import { Router } from 'express';
import crypto from 'node:crypto';
import { get, all, run, tx } from '../db.js';
import { need, can, fail, visibleProjectIds } from '../access.js';
import { requireText, intOrNull, notify, todayISO } from '../util.js';
import { resolveProject } from './projects.js';
import { createWp } from './workpackages.js';

const r = Router();
const KINDS = ['daily', 'weekly', 'review', 'planning', 'other'];

// Meeting times are stored as local wall-clock "YYYY-MM-DD HH:MM" (the office's time zone).
function normTime(v) {
  const s = String(v || '').trim().replace('T', ' ').slice(0, 16);
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s)) fail(400, 'Start must be a date and time.');
  return s;
}

function canViewMeeting(req, m) {
  if (m.project_id) return can(req, 'meetings.view', m.project_id);
  if (req.user.is_admin || can(req, 'reports.view') || m.created_by === req.user.id) return true;
  return !!get('SELECT 1 AS x FROM meeting_participants WHERE meeting_id = ? AND user_id = ?', m.id, req.user.id);
}
function canManageMeeting(req, m) {
  if (m.project_id) return can(req, 'meetings.manage', m.project_id);
  return req.user.is_admin || can(req, 'reports.view') || m.created_by === req.user.id;
}
function loadMeeting(req, id, manage = false) {
  const m = get(`SELECT m.*, p.name AS project_name, p.identifier AS project_identifier, p.color AS project_color, u.name AS created_by_name
                 FROM meetings m LEFT JOIN projects p ON p.id = m.project_id LEFT JOIN users u ON u.id = m.created_by WHERE m.id = ?`, id)
    || fail(404, 'Meeting not found.');
  if (!canViewMeeting(req, m)) fail(403, 'You cannot see this meeting.');
  if (manage && !canManageMeeting(req, m)) fail(403, 'You cannot change this meeting.');
  return m;
}

r.get('/meetings', (req, res) => {
  const q = req.query;
  const ids = visibleProjectIds(req, 'meetings.view');
  const where = [];
  const params = [];
  const vis = [];
  if (ids.length) { vis.push(`m.project_id IN (${ids.map(() => '?').join(',')})`); params.push(...ids); }
  vis.push('(m.project_id IS NULL AND (m.created_by = ? OR EXISTS (SELECT 1 FROM meeting_participants mp WHERE mp.meeting_id = m.id AND mp.user_id = ?) OR ? = 1))');
  params.push(req.user.id, req.user.id, req.user.is_admin || can(req, 'reports.view') ? 1 : 0);
  where.push(`(${vis.join(' OR ')})`);
  if (q.project_id) { const p = resolveProject(q.project_id); where.push('m.project_id = ?'); params.push(p.id); }
  if (q.mine === '1') { where.push('(m.created_by = ? OR EXISTS (SELECT 1 FROM meeting_participants mp WHERE mp.meeting_id = m.id AND mp.user_id = ?))'); params.push(req.user.id, req.user.id); }
  if (q.kind && KINDS.includes(q.kind)) { where.push('m.kind = ?'); params.push(q.kind); }
  if (q.from) { where.push('m.starts_at >= ?'); params.push(q.from.replace('T', ' ')); }
  if (q.to) { where.push('m.starts_at <= ?'); params.push(q.to.replace('T', ' ') + (q.to.length === 10 ? ' 23:59' : '')); }
  if (q.status) { where.push('m.status = ?'); params.push(q.status); }
  const order = q.order === 'desc' ? 'DESC' : 'ASC';
  const rows = all(`SELECT m.*, p.name AS project_name, p.identifier AS project_identifier, p.color AS project_color,
                      (SELECT COUNT(*) FROM meeting_participants mp WHERE mp.meeting_id = m.id) AS participant_count,
                      (SELECT COUNT(*) FROM meeting_agenda_items ai WHERE ai.meeting_id = m.id) AS agenda_count
                    FROM meetings m LEFT JOIN projects p ON p.id = m.project_id
                    WHERE ${where.join(' AND ')} ORDER BY m.starts_at ${order} LIMIT ${Math.min(Number(q.limit) || 500, 2000)}`, ...params);
  res.json(rows);
});

function occurrences(start, recurrence) {
  if (!recurrence || !recurrence.frequency || recurrence.frequency === 'none') return [start];
  const [d, t] = start.split(' ');
  const [y, mo, da] = d.split('-').map(Number);
  const base = new Date(Date.UTC(y, mo - 1, da));
  const until = recurrence.until ? new Date(recurrence.until + 'T00:00:00Z') : null;
  const max = Math.min(Number(recurrence.count) || 200, 200);
  const out = [];
  const step = { daily: 1, weekdays: 1, weekly: 7, biweekly: 14 }[recurrence.frequency];
  if (!step) fail(400, 'Unknown repeat option.');
  for (let cur = new Date(base); out.length < max; cur.setUTCDate(cur.getUTCDate() + step)) {
    if (until && cur > until) break;
    if (!until && !recurrence.count && out.length >= 20) break;
    const dow = cur.getUTCDay();
    if (recurrence.frequency === 'weekdays' && (dow === 0 || dow === 6)) continue;
    out.push(`${cur.toISOString().slice(0, 10)} ${t}`);
  }
  return out;
}

r.post('/meetings', (req, res) => {
  const b = req.body;
  let projectId = null;
  if (b.project_id) { projectId = resolveProject(b.project_id).id; need(req, 'meetings.manage', projectId); }
  else if (!req.user.is_admin && !can(req, 'reports.view')) fail(403, 'Choose a project for this meeting.');
  const title = requireText(b.title, 'Title');
  const kind = KINDS.includes(b.kind) ? b.kind : 'other';
  const start = normTime(b.starts_at);
  const duration = Math.max(5, Math.min(intOrNull(b.duration_minutes) || 30, 600));
  const participants = [...new Set([req.user.id, ...(b.participant_ids || []).map(Number)])];
  if (b.include_members && projectId) participants.push(...all('SELECT user_id FROM project_members WHERE project_id = ?', projectId).map(x => x.user_id));
  const times = occurrences(start, b.recurrence);
  const seriesId = times.length > 1 ? crypto.randomUUID() : null;
  const agenda = Array.isArray(b.agenda) ? b.agenda.filter(a => a && String(a.title || '').trim()) : [];
  const ids = tx(() => times.map(t => {
    const { id } = run(`INSERT INTO meetings(project_id, series_id, title, kind, starts_at, duration_minutes, location, created_by)
                        VALUES(?,?,?,?,?,?,?,?)`, projectId, seriesId, title, kind, t, duration, b.location || null, req.user.id);
    for (const uid of new Set(participants)) run('INSERT OR IGNORE INTO meeting_participants(meeting_id, user_id) VALUES(?,?)', id, uid);
    agenda.forEach((a, i) => run('INSERT INTO meeting_agenda_items(meeting_id, title, notes, duration, presenter_id, position) VALUES(?,?,?,?,?,?)',
      id, String(a.title).trim(), a.notes || null, intOrNull(a.duration) || null, intOrNull(a.presenter_id) || null, i));
    return id;
  }));
  const when = times.length > 1 ? `${times.length} occurrences from ${times[0]}` : times[0];
  notify([...new Set(participants)], { actorId: req.user.id, projectId, meetingId: ids[0], reason: 'meeting_invite', message: `${req.user.name} invited you to “${title}” (${when})` });
  res.status(201).json({ id: ids[0], ids, series_id: seriesId });
});

r.get('/meetings/:id', (req, res) => {
  const m = loadMeeting(req, req.params.id);
  const participants = all(`SELECT u.id, u.name, u.job_title, mp.attended FROM meeting_participants mp JOIN users u ON u.id = mp.user_id
                            WHERE mp.meeting_id = ? ORDER BY u.name`, m.id);
  const agenda = all(`SELECT ai.*, u.name AS presenter_name, wp.subject AS wp_subject, p.identifier || '-' || wp.number AS wp_key,
                        s.name AS wp_status, s.color AS wp_status_color, wa.name AS wp_assignee
                      FROM meeting_agenda_items ai LEFT JOIN users u ON u.id = ai.presenter_id
                      LEFT JOIN work_packages wp ON wp.id = ai.wp_id LEFT JOIN projects p ON p.id = wp.project_id
                      LEFT JOIN statuses s ON s.id = wp.status_id LEFT JOIN users wa ON wa.id = wp.assignee_id
                      WHERE ai.meeting_id = ? ORDER BY ai.position, ai.id`, m.id);
  const actions = all(`SELECT wp.id, wp.subject, wp.due_date, p.identifier || '-' || wp.number AS key, s.name AS status_name, s.color AS status_color,
                         s.is_closed, a.name AS assignee_name
                       FROM meeting_actions ma JOIN work_packages wp ON wp.id = ma.wp_id JOIN projects p ON p.id = wp.project_id
                       JOIN statuses s ON s.id = wp.status_id LEFT JOIN users a ON a.id = wp.assignee_id
                       WHERE ma.meeting_id = ? ORDER BY wp.id`, m.id);
  const standups = all(`SELECT su.*, u.name AS user_name FROM standup_updates su JOIN users u ON u.id = su.user_id
                        WHERE su.meeting_id = ? ORDER BY u.name`, m.id);
  const attachments = all(`SELECT a.*, u.name AS uploaded_by_name FROM attachments a LEFT JOIN users u ON u.id = a.uploaded_by
                           WHERE a.container_type = 'meeting' AND a.container_id = ?`, m.id);
  let series = null;
  if (m.series_id) {
    series = {
      prev: get('SELECT id, starts_at FROM meetings WHERE series_id = ? AND starts_at < ? ORDER BY starts_at DESC LIMIT 1', m.series_id, m.starts_at),
      next: get('SELECT id, starts_at FROM meetings WHERE series_id = ? AND starts_at > ? ORDER BY starts_at LIMIT 1', m.series_id, m.starts_at),
      count: get('SELECT COUNT(*) AS n FROM meetings WHERE series_id = ?', m.series_id).n,
    };
  }
  res.json({
    ...m, participants, agenda, actions, standups, attachments, series,
    can: { manage: canManageMeeting(req, m), create_wp: m.project_id ? can(req, 'wp.create', m.project_id) : false, upload: m.project_id ? can(req, 'files.upload', m.project_id) : false },
    is_participant: participants.some(p => p.id === req.user.id),
  });
});

r.patch('/meetings/:id', (req, res) => {
  const m = loadMeeting(req, req.params.id, true);
  const b = req.body;
  const f = {
    title: b.title !== undefined ? requireText(b.title, 'Title') : undefined,
    kind: b.kind !== undefined ? (KINDS.includes(b.kind) ? b.kind : fail(400, 'Unknown meeting type.')) : undefined,
    starts_at: b.starts_at !== undefined ? normTime(b.starts_at) : undefined,
    duration_minutes: b.duration_minutes !== undefined ? Math.max(5, Math.min(intOrNull(b.duration_minutes) || 30, 600)) : undefined,
    location: b.location,
    status: b.status !== undefined ? (['open', 'in_progress', 'closed'].includes(b.status) ? b.status : fail(400, 'Unknown status.')) : undefined,
    minutes: b.minutes,
  };
  const keys = Object.keys(f).filter(k => f[k] !== undefined);
  const scopeSeries = b.apply_to === 'future' && m.series_id;
  tx(() => {
    if (!keys.length) return;
    if (scopeSeries) {
      // apply title/kind/duration/location (and time-of-day) to this and following occurrences
      const seriesKeys = keys.filter(k => ['title', 'kind', 'duration_minutes', 'location'].includes(k));
      if (seriesKeys.length) run(`UPDATE meetings SET ${seriesKeys.map(k => `${k} = ?`).join(', ')}, updated_at = datetime('now')
                                  WHERE series_id = ? AND starts_at >= ?`, ...seriesKeys.map(k => f[k]), m.series_id, m.starts_at);
      if (f.starts_at && f.starts_at.slice(11) !== m.starts_at.slice(11)) {
        run(`UPDATE meetings SET starts_at = substr(starts_at, 1, 11) || ? WHERE series_id = ? AND starts_at >= ? AND id <> ?`, f.starts_at.slice(11), m.series_id, m.starts_at, m.id);
      }
    }
    run(`UPDATE meetings SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`, ...keys.map(k => f[k]), m.id);
  });
  if (f.status === 'closed' && m.status !== 'closed') {
    const ids = all('SELECT user_id FROM meeting_participants WHERE meeting_id = ?', m.id).map(x => x.user_id);
    notify(ids, { actorId: req.user.id, projectId: m.project_id, meetingId: m.id, reason: 'meeting_minutes', message: `Minutes for “${m.title}” (${m.starts_at.slice(0, 10)}) are ready` });
  }
  if (f.starts_at && f.starts_at !== m.starts_at) {
    const ids = all('SELECT user_id FROM meeting_participants WHERE meeting_id = ?', m.id).map(x => x.user_id);
    notify(ids, { actorId: req.user.id, projectId: m.project_id, meetingId: m.id, reason: 'meeting_moved', message: `“${m.title}” moved to ${f.starts_at}` });
  }
  res.json({ ok: true });
});

r.delete('/meetings/:id', (req, res) => {
  const m = loadMeeting(req, req.params.id, true);
  if (req.query.scope === 'future' && m.series_id) run('DELETE FROM meetings WHERE series_id = ? AND starts_at >= ?', m.series_id, m.starts_at);
  else run('DELETE FROM meetings WHERE id = ?', m.id);
  res.json({ ok: true });
});

// Copy: next occurrence with the same people and every unfinished agenda item
r.post('/meetings/:id/copy', (req, res) => {
  const m = loadMeeting(req, req.params.id, true);
  const start = normTime(req.body.starts_at);
  const id = tx(() => {
    const { id } = run(`INSERT INTO meetings(project_id, series_id, title, kind, starts_at, duration_minutes, location, created_by)
                        VALUES(?,?,?,?,?,?,?,?)`, m.project_id, m.series_id, req.body.title || m.title, m.kind, start, m.duration_minutes, m.location, req.user.id);
    run('INSERT INTO meeting_participants(meeting_id, user_id) SELECT ?, user_id FROM meeting_participants WHERE meeting_id = ?', id, m.id);
    const items = all('SELECT * FROM meeting_agenda_items WHERE meeting_id = ? ORDER BY position, id', m.id);
    items.filter(i => req.body.copy_all_agenda || !i.done).forEach((i, n) =>
      run('INSERT INTO meeting_agenda_items(meeting_id, title, notes, duration, presenter_id, wp_id, position) VALUES(?,?,?,?,?,?,?)',
        id, i.title, i.notes, i.duration, i.presenter_id, i.wp_id, n));
    return id;
  });
  res.status(201).json({ id });
});

// ---------- participants ----------
r.put('/meetings/:id/participants', (req, res) => {
  const m = loadMeeting(req, req.params.id, true);
  const ids = [...new Set((req.body.user_ids || []).map(Number).filter(Boolean))];
  const before = all('SELECT user_id FROM meeting_participants WHERE meeting_id = ?', m.id).map(x => x.user_id);
  tx(() => {
    run(`DELETE FROM meeting_participants WHERE meeting_id = ? AND user_id NOT IN (${ids.map(() => '?').join(',') || 'NULL'})`, m.id, ...ids);
    for (const uid of ids) run('INSERT OR IGNORE INTO meeting_participants(meeting_id, user_id) VALUES(?,?)', m.id, uid);
  });
  notify(ids.filter(id => !before.includes(id)), { actorId: req.user.id, projectId: m.project_id, meetingId: m.id, reason: 'meeting_invite', message: `${req.user.name} invited you to “${m.title}” (${m.starts_at})` });
  res.json({ ok: true });
});

r.patch('/meetings/:id/participants/:uid', (req, res) => {
  const m = loadMeeting(req, req.params.id);
  const uid = Number(req.params.uid);
  if (uid !== req.user.id && !canManageMeeting(req, m)) fail(403, 'Only the organiser can mark attendance for others.');
  const val = req.body.attended === null ? null : req.body.attended ? 1 : 0;
  run('UPDATE meeting_participants SET attended = ? WHERE meeting_id = ? AND user_id = ?', val, m.id, uid);
  res.json({ ok: true });
});

// ---------- agenda ----------
r.post('/meetings/:id/agenda', (req, res) => {
  const m = loadMeeting(req, req.params.id);
  const isParticipant = !!get('SELECT 1 AS x FROM meeting_participants WHERE meeting_id = ? AND user_id = ?', m.id, req.user.id);
  if (!canManageMeeting(req, m) && !isParticipant) fail(403, 'Only participants can add agenda items.');
  let wpId = intOrNull(req.body.wp_id) || null;
  let title = req.body.title ? String(req.body.title).trim() : '';
  if (wpId) {
    const wp = get(`SELECT wp.id, wp.project_id, wp.subject, p.identifier || '-' || wp.number AS key FROM work_packages wp JOIN projects p ON p.id = wp.project_id WHERE wp.id = ?`, wpId) || fail(400, 'Work package not found.');
    need(req, 'wp.view', wp.project_id);
    if (!title) title = `${wp.key} ${wp.subject}`;
  }
  if (!title) fail(400, 'Agenda item needs a title.');
  const pos = get('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM meeting_agenda_items WHERE meeting_id = ?', m.id).p;
  const { id } = run('INSERT INTO meeting_agenda_items(meeting_id, title, notes, duration, presenter_id, wp_id, position) VALUES(?,?,?,?,?,?,?)',
    m.id, title, req.body.notes || null, intOrNull(req.body.duration) || null, intOrNull(req.body.presenter_id) || null, wpId, pos);
  res.status(201).json({ id });
});

r.patch('/meetings/:id/agenda/:itemId', (req, res) => {
  const m = loadMeeting(req, req.params.id);
  const item = get('SELECT * FROM meeting_agenda_items WHERE id = ? AND meeting_id = ?', req.params.itemId, m.id) || fail(404, 'Agenda item not found.');
  const isParticipant = !!get('SELECT 1 AS x FROM meeting_participants WHERE meeting_id = ? AND user_id = ?', m.id, req.user.id);
  if (!canManageMeeting(req, m) && !(isParticipant && (item.presenter_id === req.user.id || req.body.outcome !== undefined))) fail(403, 'Only the organiser can change this item.');
  const b = req.body;
  const f = {
    title: b.title !== undefined ? requireText(b.title, 'Title') : undefined, notes: b.notes, outcome: b.outcome,
    duration: b.duration !== undefined ? intOrNull(b.duration) : undefined,
    presenter_id: b.presenter_id !== undefined ? intOrNull(b.presenter_id) : undefined,
    done: b.done !== undefined ? (b.done ? 1 : 0) : undefined, position: b.position !== undefined ? intOrNull(b.position) : undefined,
  };
  const keys = Object.keys(f).filter(k => f[k] !== undefined);
  if (keys.length) run(`UPDATE meeting_agenda_items SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map(k => f[k]), item.id);
  res.json({ ok: true });
});

r.put('/meetings/:id/agenda-order', (req, res) => {
  const m = loadMeeting(req, req.params.id, true);
  tx(() => (req.body.ids || []).forEach((id, i) => run('UPDATE meeting_agenda_items SET position = ? WHERE id = ? AND meeting_id = ?', i, id, m.id)));
  res.json({ ok: true });
});

r.delete('/meetings/:id/agenda/:itemId', (req, res) => {
  const m = loadMeeting(req, req.params.id, true);
  run('DELETE FROM meeting_agenda_items WHERE id = ? AND meeting_id = ?', req.params.itemId, m.id);
  res.json({ ok: true });
});

// ---------- action items (create a real work package) ----------
r.post('/meetings/:id/actions', (req, res) => {
  const m = loadMeeting(req, req.params.id);
  if (!m.project_id) fail(400, 'Action items need a project meeting.');
  let wpId = intOrNull(req.body.wp_id);
  if (!wpId) {
    const desc = [req.body.description, `Action item from meeting “${m.title}” on ${m.starts_at.slice(0, 10)}.`].filter(Boolean).join('\n\n');
    const wp = createWp(req, m.project_id, { ...req.body, description: desc });
    wpId = wp.id;
  }
  run('INSERT OR IGNORE INTO meeting_actions(meeting_id, wp_id) VALUES(?,?)', m.id, wpId);
  if (req.body.agenda_item_id) run('UPDATE meeting_agenda_items SET wp_id = COALESCE(wp_id, ?) WHERE id = ? AND meeting_id = ?', wpId, req.body.agenda_item_id, m.id);
  res.status(201).json({ wp_id: wpId });
});

r.delete('/meetings/:id/actions/:wpId', (req, res) => {
  const m = loadMeeting(req, req.params.id, true);
  run('DELETE FROM meeting_actions WHERE meeting_id = ? AND wp_id = ?', m.id, req.params.wpId);
  res.json({ ok: true });
});

// ---------- stand-up updates ----------
r.put('/meetings/:id/standup', (req, res) => {
  const m = loadMeeting(req, req.params.id);
  const uid = req.body.user_id && canManageMeeting(req, m) ? Number(req.body.user_id) : req.user.id;
  run(`INSERT INTO standup_updates(meeting_id, user_id, yesterday, today, blockers) VALUES(?,?,?,?,?)
       ON CONFLICT(meeting_id, user_id) DO UPDATE SET yesterday = excluded.yesterday, today = excluded.today, blockers = excluded.blockers, updated_at = datetime('now')`,
    m.id, uid, req.body.yesterday || null, req.body.today || null, req.body.blockers || null);
  if (req.body.blockers && String(req.body.blockers).trim()) {
    const organisers = [m.created_by];
    notify(organisers, { actorId: uid, projectId: m.project_id, meetingId: m.id, reason: 'blocker', message: `${req.user.name} reported a blocker for “${m.title}”` });
  }
  res.json({ ok: true });
});

// Suggestions to pre-fill a stand-up: what I touched since the last working day, and what I have in progress.
r.get('/meetings/:id/standup-suggestions', (req, res) => {
  const m = loadMeeting(req, req.params.id);
  const since = new Date(Date.now() - (new Date().getDay() === 1 ? 3 : 1) * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  const where = m.project_id ? 'AND wp.project_id = ?' : '';
  const params = m.project_id ? [m.project_id] : [];
  const done = all(`SELECT DISTINCT wp.id, p.identifier || '-' || wp.number AS key, wp.subject, s.name AS status_name
                    FROM journals j JOIN work_packages wp ON wp.id = j.wp_id JOIN projects p ON p.id = wp.project_id JOIN statuses s ON s.id = wp.status_id
                    WHERE j.user_id = ? AND j.created_at >= ? ${where} LIMIT 15`, req.user.id, since, ...params);
  const doing = all(`SELECT wp.id, p.identifier || '-' || wp.number AS key, wp.subject, s.name AS status_name, wp.due_date
                     FROM work_packages wp JOIN projects p ON p.id = wp.project_id JOIN statuses s ON s.id = wp.status_id
                     WHERE wp.assignee_id = ? AND s.is_closed = 0 ${where} ORDER BY wp.due_date IS NULL, wp.due_date LIMIT 15`, req.user.id, ...params);
  const time = all(`SELECT ROUND(SUM(hours), 2) AS hours FROM time_entries WHERE user_id = ? AND spent_on >= ?`, req.user.id, since.slice(0, 10));
  res.json({ since, done, doing, hours: time[0]?.hours || 0 });
});

// Review summary: what happened in the project during the period covered by this meeting
r.get('/meetings/:id/summary', (req, res) => {
  const m = loadMeeting(req, req.params.id);
  if (!m.project_id) return res.json(null);
  const days = m.kind === 'daily' ? 1 : m.kind === 'weekly' || m.kind === 'review' ? 7 : 14;
  const meetingDate = m.starts_at.slice(0, 10);
  const fromDate = new Date(Date.parse(meetingDate + 'T00:00:00Z') - days * 86400000).toISOString().slice(0, 10);
  const pid = m.project_id;
  const today = todayISO();
  const closed = all(`SELECT DISTINCT wp.id, p.identifier || '-' || wp.number AS key, wp.subject, a.name AS assignee_name
                      FROM journals j JOIN work_packages wp ON wp.id = j.wp_id JOIN projects p ON p.id = wp.project_id
                      JOIN statuses s ON s.id = wp.status_id LEFT JOIN users a ON a.id = wp.assignee_id
                      WHERE wp.project_id = ? AND s.is_closed = 1 AND j.changes LIKE '%"status_id"%' AND j.created_at >= ? AND j.created_at < date(?, '+1 day')
                      ORDER BY wp.id`, pid, fromDate, meetingDate);
  const created = get(`SELECT COUNT(*) AS n FROM work_packages WHERE project_id = ? AND created_at >= ? AND created_at < date(?, '+1 day')`, pid, fromDate, meetingDate).n;
  const overdue = all(`SELECT wp.id, p.identifier || '-' || wp.number AS key, wp.subject, wp.due_date, a.name AS assignee_name
                       FROM work_packages wp JOIN projects p ON p.id = wp.project_id JOIN statuses s ON s.id = wp.status_id LEFT JOIN users a ON a.id = wp.assignee_id
                       WHERE wp.project_id = ? AND s.is_closed = 0 AND wp.due_date < ? ORDER BY wp.due_date LIMIT 25`, pid, today);
  const dueSoon = all(`SELECT wp.id, p.identifier || '-' || wp.number AS key, wp.subject, wp.due_date, a.name AS assignee_name
                       FROM work_packages wp JOIN projects p ON p.id = wp.project_id JOIN statuses s ON s.id = wp.status_id LEFT JOIN users a ON a.id = wp.assignee_id
                       WHERE wp.project_id = ? AND s.is_closed = 0 AND wp.due_date >= ? AND wp.due_date <= date(?, '+7 day') ORDER BY wp.due_date LIMIT 25`, pid, today, today);
  const hours = all(`SELECT u.name, ROUND(SUM(te.hours), 2) AS hours FROM time_entries te JOIN users u ON u.id = te.user_id
                     WHERE te.project_id = ? AND te.spent_on >= ? AND te.spent_on <= ? GROUP BY u.id ORDER BY hours DESC`, pid, fromDate, meetingDate);
  const blockers = all(`SELECT su.blockers, u.name FROM standup_updates su JOIN users u ON u.id = su.user_id JOIN meetings mm ON mm.id = su.meeting_id
                        WHERE mm.project_id = ? AND mm.starts_at >= ? AND mm.starts_at < date(?, '+1 day') AND TRIM(COALESCE(su.blockers, '')) <> ''
                        ORDER BY mm.starts_at DESC LIMIT 20`, pid, fromDate, meetingDate);
  res.json({ from: fromDate, to: meetingDate, days, closed, created, overdue, dueSoon, hours, blockers });
});

export default r;
