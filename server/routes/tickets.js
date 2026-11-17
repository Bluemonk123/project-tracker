// Ticket Board: a helpdesk for support tickets.
// Life cycle: raised (header button, login page form, agent "New ticket") -> board -> triage / assign ->
// replies and internal notes -> SLA tracking -> solved. The requester follows it on "Tickets Raised".
import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { get, all, run, tx, UPLOAD_DIR, getSetting, setSetting } from '../db.js';
import { can, need, fail, HttpError, parseList } from '../access.js';
import { resolveProject } from './projects.js';
import { createWp } from './workpackages.js';
import { notify } from '../util.js';
import { isEmail, sendMailLater, mailEnabled } from '../mailer.js';

// ---------- allowed values ----------
export const STATUSES = ['open', 'pending', 'hold', 'solved'];
export const STATUS_LABEL = { open: 'Open', pending: 'Pending', hold: 'On hold', solved: 'Solved' };
export const PRIORITIES = ['urgent', 'high', 'normal'];
export const TYPES = ['issue', 'feedback', 'feature', 'task'];
export const CHANNELS = ['web', 'email', 'agent'];
const KIND_LABEL = { staff: 'Staff', partner: 'External partner', guest: 'Not signed in' };
const MAX_DESC = 5000, MAX_SUBJECT = 200, MAX_FILES = 2, MAX_FILE_BYTES = 5 * 1024 * 1024;

const nowIso = () => new Date().toISOString();
const cut = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const stripFrom = (s) => String(s || '').replace(/^\[From [^\]]*\]\s*/, '');
const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || '';

export function displaySubject(t) {
  if (t.subject && t.subject.trim()) return t.subject.trim();
  const line = stripFrom(t.feedback).split(/\r?\n/).find(l => l.trim()) || '';
  return cut(line.trim(), 100) || `Ticket ${t.ticket_no}`;
}

// ---------- groups and settings ----------
export const activeGroups = () => all('SELECT name FROM ticket_groups WHERE active = 1 ORDER BY position, id').map(g => g.name);
function defaultGroup() {
  const groups = activeGroups();
  return groups.includes('Support') ? 'Support' : groups[0] || 'Support';
}
export function slaHours() {
  const n = (k, d) => { const v = Number(getSetting(`ticket_sla_hours_${k}`)); return Number.isFinite(v) && v > 0 ? v : d; };
  return { urgent: n('urgent', 4), high: n('high', 8), normal: n('normal', 24) };
}

// ---------- SLA and age ----------
// Due = raised_on + policy hours for the priority + time spent on hold. Paused while on hold; none once solved.
export function slaInfo(t, now = Date.now(), hours = slaHours()) {
  const due = Date.parse(t.raised_on) + (hours[t.priority] || hours.normal) * 3600e3 + (t.sla_paused_seconds || 0) * 1000;
  if (t.status === 'solved') return { state: 'none', label: '', due_at: null, breached: false };
  if (t.status === 'hold') return { state: 'paused', label: 'Paused', due_at: null, breached: false };
  const left = due - now;
  const due_at = new Date(due).toISOString();
  if (left <= 0) {
    const over = -left;
    return { state: 'breached', label: over < 3600e3 ? `Breached ${Math.max(1, Math.floor(over / 60e3))}m` : `Breached ${Math.floor(over / 3600e3)}h`, due_at, breached: true };
  }
  if (left < 3600e3) return { state: 'warn', label: `${Math.max(1, Math.floor(left / 60e3))}m left`, due_at, breached: false };
  return { state: left < 2 * 3600e3 ? 'warn' : 'ok', label: `${Math.floor(left / 3600e3)}h left`, due_at, breached: false };
}
export function ageText(t, now = Date.now()) {
  const end = t.status === 'solved' && t.solved_at ? Date.parse(t.solved_at) : now;
  const mins = Math.max(0, Math.floor((end - Date.parse(t.raised_on)) / 60e3));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}
function decorate(t, now, hours) {
  return {
    ...t,
    subject_display: displaySubject(t),
    sla: slaInfo(t, now, hours),
    age: ageText(t, now),
    requester_display: t.requester_name || t.raised_by,
    simple_status: t.status === 'solved' ? 'Closed' : 'Open',
  };
}

// ---------- people ----------
function boardUsers() {
  const roleIds = all("SELECT id, permissions FROM roles WHERE scope = 'global'").filter(r => parseList(r.permissions).includes('tickets.view')).map(r => r.id);
  return all(`SELECT id, name, email FROM users WHERE status = 'active' AND (is_admin = 1 ${roleIds.length ? `OR global_role_id IN (${roleIds.join(',')})` : ''}) ORDER BY name`);
}
// Engineers: active members and leads of teams whose name contains "Ticket" or "Support";
// until such a team has members, everyone who can open the Ticket Board.
export function engineers() {
  const teams = all("SELECT id, lead_id FROM teams WHERE lower(name) LIKE '%ticket%' OR lower(name) LIKE '%support%'");
  const ids = new Set();
  for (const t of teams) {
    if (t.lead_id) ids.add(t.lead_id);
    all('SELECT user_id FROM team_members WHERE team_id = ?', t.id).forEach(m => ids.add(m.user_id));
  }
  const list = ids.size ? all(`SELECT id, name, email FROM users WHERE status = 'active' AND id IN (${[...ids].join(',')}) ORDER BY name`) : [];
  return list.length ? list : boardUsers();
}
const agentsToAlert = () => {
  const ids = new Set(all("SELECT id FROM users WHERE status = 'active' AND is_admin = 1").map(u => u.id));
  engineers().forEach(u => ids.add(u.id));
  return [...ids];
};

// ---------- audit, activity lines ----------
function audit(req, action, ticket, details) {
  try {
    run('INSERT INTO audit_log(actor_id, action, entity_type, entity_id, details, ip) VALUES(?,?,?,?,?,?)',
      req.user?.id ?? null, action, 'ticket', ticket.id, JSON.stringify({ ticket_no: ticket.ticket_no, ...details }), req.ip || null);
  } catch (e) { console.error('Audit log failed:', e.message); }
}
const systemLine = (ticketId, text, actorName, at = nowIso()) =>
  run("INSERT INTO ticket_messages(ticket_id, author_type, author_name, body, created_at) VALUES(?, 'system', ?, ?, ?)", ticketId, actorName || 'System', text, at);

// Status change: keeps the SLA clock right (hold pauses it; solved stops it).
function statusFields(t, to, at) {
  const f = { status: to };
  if (t.status === 'hold' && to !== 'hold') {
    const held = t.hold_started_at ? Math.max(0, Math.round((Date.parse(at) - Date.parse(t.hold_started_at)) / 1000)) : 0;
    f.sla_paused_seconds = (t.sla_paused_seconds || 0) + held;
    f.hold_started_at = null;
  }
  if (to === 'hold' && t.status !== 'hold') f.hold_started_at = at;
  if (to === 'solved') f.solved_at = at;
  else if (t.status === 'solved') f.solved_at = null;
  return f;
}
function saveFields(t, fields, at = nowIso()) {
  const merged = { ...t, ...fields };
  const sla = slaInfo(merged);
  const all2 = { ...fields, sla_due_at: sla.due_at, updated_at: at };
  const keys = Object.keys(all2);
  run(`UPDATE tickets SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map(k => all2[k]), t.id);
  return { ...merged, ...all2 };
}

// ---------- notifications (always after the change is saved; never fail the action) ----------
const userById = (id) => (id ? get('SELECT id, name, email, status FROM users WHERE id = ?', id) : null);
function safely(fn) { try { fn(); } catch (e) { console.error('Ticket alert failed:', e.message); } }

// The requester hears about every change someone else makes: bell (staff) and/or email.
function alertRequester(t, actor, title, body) {
  safely(() => {
    const appTitle = `${title}`;
    if (t.requester_kind === 'staff' && t.requester_user_id) {
      if (actor && t.requester_user_id === actor.id) return; // never about their own change
      notify([t.requester_user_id], { actorId: actor?.id ?? null, ticketId: t.id, link: `/tickets-raised?ticket=${t.ticket_no}`, reason: 'ticket_update', message: `${appTitle}: ${body}` });
      const u = userById(t.requester_user_id);
      if (u?.email && u.status === 'active') sendMailLater({ to: u.email, subject: appTitle, text: `${body}\n\nOpen "Tickets Raised" in the app to see the whole conversation.` });
    } else if (t.requester_email) {
      sendMailLater({ to: t.requester_email, subject: appTitle, text: `Hello ${t.raised_by},\n\n${body}\n\nTicket ${t.ticket_no}: ${displaySubject(t)}` });
    }
  });
}
function alertAssignee(t, assigneeId, actor) {
  safely(() => {
    if (!assigneeId || assigneeId === actor?.id) return;
    notify([assigneeId], { actorId: actor?.id ?? null, ticketId: t.id, link: `/ticket-board/${t.ticket_no}`, reason: 'ticket_assigned',
      message: `Ticket ${t.ticket_no} assigned to you — ${actor?.name || 'Someone'} assigned you: ${displaySubject(t)}` });
  });
}
function alertNewTicket(t, actor) {
  safely(() => {
    notify(agentsToAlert(), { actorId: actor?.id ?? null, ticketId: t.id, link: `/ticket-board/${t.ticket_no}`, reason: 'ticket_new',
      message: `New Ticket ${t.ticket_no}: ${cut(stripFrom(t.subject || t.feedback).replace(/\s+/g, ' '), 120)}` });
  });
}
function replyHint(t) {
  if (t.requester_kind === 'staff' && t.requester_user_id) {
    const u = userById(t.requester_user_id);
    return `${u?.name || t.raised_by} gets an alert with your reply${mailEnabled() && u?.email ? `, and an email at ${u.email}` : ''}.`;
  }
  if (t.requester_email) {
    return mailEnabled() ? `Visible on the ticket; an email goes to ${t.requester_email}.`
      : `Visible on the ticket; email isn't set up yet (Administration → Email), so ${t.requester_email} won't be alerted.`;
  }
  return 'Visible on the ticket; this requester has no login and left no email to alert.';
}

// ---------- attachments (checked by extension AND by the file's first bytes) ----------
export const FILE_TYPES = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf',
  doc: 'application/msword', xls: 'application/vnd.ms-excel', ppt: 'application/vnd.ms-powerpoint',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip',
};
const starts = (b, sig) => b.length >= sig.length && sig.every((x, i) => x === null || b[i] === x);
const OLE = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
const ZIP = [0x50, 0x4B, 0x03, 0x04], ZIP_EMPTY = [0x50, 0x4B, 0x05, 0x06];
// Returns null when the file is acceptable, otherwise the reason it was refused.
export function checkFile(name, buf) {
  const ext = (path.extname(String(name || '')).slice(1) || '').toLowerCase();
  if (!FILE_TYPES[ext]) return 'this file type is not allowed (use images, PDF, Office documents or zip)';
  if (buf.length > MAX_FILE_BYTES) return 'it is over 5 MB';
  if (!buf.length) return 'the file is empty';
  const ok = {
    png: () => starts(buf, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    jpg: () => starts(buf, [0xFF, 0xD8, 0xFF]),
    gif: () => starts(buf, [0x47, 0x49, 0x46, 0x38]),
    webp: () => starts(buf, [0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x45, 0x42, 0x50]),
    pdf: () => buf.subarray(0, 5).toString('latin1') === '%PDF-',
    doc: () => starts(buf, OLE), docx: () => starts(buf, ZIP), zip: () => starts(buf, ZIP) || starts(buf, ZIP_EMPTY),
  };
  const test = ok[ext] || ok[{ jpeg: 'jpg', xls: 'doc', ppt: 'doc', xlsx: 'docx', pptx: 'docx' }[ext]];
  if (!test()) return `its contents do not match a .${ext} file`;
  // macros: Office 2007+ keeps them in vbaProject.bin; Office 97-2003 in a _VBA_PROJECT stream
  if (['docx', 'xlsx', 'pptx', 'zip'].includes(ext) && buf.includes('vbaProject.bin')) return 'files with macros are not allowed';
  if (['docx', 'xlsx', 'pptx'].includes(ext) && !buf.includes('[Content_Types].xml')) return `its contents do not match a .${ext} file`;
  if (['doc', 'xls', 'ppt'].includes(ext) && buf.includes(Buffer.from('_VBA_PROJECT', 'utf16le'))) return 'files with macros are not allowed';
  return null;
}
const cleanName = (n) => cut(path.basename(String(n || 'file')).replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, '_'), 150) || 'file';

// Saves up to 2 vetted files under generated names; returns the saved rows and a warning per refused file.
function saveFiles(t, files, messageId, userId) {
  const saved = [], warnings = [];
  for (const f of files || []) {
    const name = cleanName(Buffer.from(f.originalname || '', 'latin1').toString('utf8'));
    if (saved.length >= MAX_FILES) { warnings.push(`${name} was not attached: at most ${MAX_FILES} files.`); continue; }
    const why = checkFile(name, f.buffer);
    if (why) { warnings.push(`${name} was not attached: ${why}.`); continue; }
    const ext = path.extname(name).slice(1).toLowerCase();
    const n = get('SELECT COUNT(*) AS n FROM ticket_attachments WHERE ticket_id = ?', t.id).n + 1;
    const stored = `tkt_${t.ticket_no}_${n}_${Date.now()}${crypto.randomBytes(2).toString('hex')}.${ext}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, stored), f.buffer, { flag: 'wx' });
    const id = run(`INSERT INTO ticket_attachments(ticket_id, message_id, file_name, stored_name, mime_type, size_bytes, uploaded_by, created_at)
                    VALUES(?,?,?,?,?,?,?,?)`, t.id, messageId, name, stored, FILE_TYPES[ext], f.buffer.length, userId, nowIso()).id;
    saved.push({ id, file_name: name, mime_type: FILE_TYPES[ext], size_bytes: f.buffer.length });
  }
  return { saved, warnings };
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024, files: 6, fields: 30, fieldSize: 64 * 1024 } }).array('files', 6);
function readForm(req, res) {
  if (!req.is('multipart/form-data')) return Promise.resolve();
  return new Promise((resolve, reject) => upload(req, res, (err) => {
    if (!err) return resolve();
    if (err.code === 'LIMIT_FILE_SIZE') return reject(new HttpError(400, 'A file is too large. Attach files up to 5 MB each.'));
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') return reject(new HttpError(400, `Attach at most ${MAX_FILES} files.`));
    reject(new HttpError(400, 'The form could not be read. Try again.'));
  }));
}

// ---------- creating tickets ----------
function cleanDescription(v) {
  const s = String(v ?? '').trim();
  if (!s) fail(400, 'Description is required.');
  if (s.length > MAX_DESC) fail(400, `Description can be up to ${MAX_DESC} characters.`);
  return s;
}
function cleanSubject(v, required = false) {
  const s = String(v ?? '').trim().replace(/\s+/g, ' ');
  if (required && !s) fail(400, 'Subject is required.');
  if (s.length > MAX_SUBJECT) fail(400, `Subject can be up to ${MAX_SUBJECT} characters.`);
  return s || null;
}
function cleanTypedName(v) {
  const s = String(v ?? '').trim().replace(/\s+/g, ' ');
  if (!s) fail(400, 'Name is required.');
  if (s.startsWith('[')) fail(400, 'A name cannot start with "[".');
  if (s.length > 100) fail(400, 'Name can be up to 100 characters.');
  return s;
}
function cleanEmail(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (!isEmail(s)) fail(400, 'That email address is not valid.');
  return s.toLowerCase();
}
function oneOf(v, list, field, fallback) {
  if (v === undefined || v === null || v === '') return fallback;
  if (!list.includes(v)) fail(400, `${field} must be one of: ${list.join(', ')}.`);
  return v;
}

function createTicket(req, f, files) {
  const at = nowIso();
  const t = tx(() => {
    // the number is taken and used inside one transaction, so two tickets can never get the same one;
    // a counter means a deleted ticket's number is never handed out again
    const no = Math.max(Number(getSetting('ticket_last_no')) || 10000000, get('SELECT COALESCE(MAX(ticket_no), 10000000) AS n FROM tickets').n) + 1;
    setSetting('ticket_last_no', no);
    const row = {
      ticket_no: no, status: 'open', subject: f.subject || null, feedback: f.feedback, priority: f.priority || 'normal',
      ticket_type: f.ticket_type || 'issue', group_name: f.group_name || defaultGroup(), channel: f.channel || 'web', source: f.source,
      requester_kind: f.requester_kind, requester_user_id: f.requester_user_id || null, raised_by: f.raised_by,
      requester_email: f.requester_email || null, partner_code: f.partner_code || null, assignee_id: null,
      raised_on: at, created_by: req.user?.id ?? null, created_at: at, updated_at: at,
    };
    row.sla_due_at = slaInfo(row).due_at;
    const keys = Object.keys(row);
    row.id = run(`INSERT INTO tickets(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`, ...keys.map(k => row[k])).id;
    if (f.firstLine) systemLine(row.id, f.firstLine, req.user?.name, at);
    return row;
  });
  let result = { saved: [], warnings: [] };
  try { result = saveFiles(t, files, null, req.user?.id ?? null); } catch (e) { console.error('Saving ticket files failed:', e.message); result.warnings.push('The files could not be saved.'); }
  audit(req, 'TICKET_CREATED', t, { source: f.source, channel: t.channel, files: result.saved.length });
  alertNewTicket(t, req.user);
  return { ticket_no: t.ticket_no, id: t.id, warnings: result.warnings };
}

// Login page "Contact admin for access/issues": 5 per hour per computer.
const hits = new Map();
function rateLimit(key, max, windowMs = 3600e3) {
  const now = Date.now();
  const list = (hits.get(key) || []).filter(x => now - x < windowMs);
  if (list.length >= max) fail(429, 'Too many tickets from this computer. Try again in an hour.');
  list.push(now);
  hits.set(key, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some(x => now - x < windowMs)) hits.delete(k);
}
export function resetRateLimits() { hits.clear(); }

// ======================================================================================
export const publicTicketRoutes = Router();

publicTicketRoutes.post('/public/contact', async (req, res) => {
  rateLimit(`login:${req.ip}`, 5);
  await readForm(req, res);
  const name = cleanTypedName(req.body.name);
  const email = cleanEmail(req.body.email);
  const desc = cleanDescription(req.body.description);
  const out = createTicket(req, {
    feedback: `[From login page] ${desc}`.slice(0, MAX_DESC + 20), requester_kind: 'guest', raised_by: name, requester_email: email,
    channel: 'web', source: 'login page',
  }, req.files);
  res.status(201).json({ ticket_no: out.ticket_no, warnings: out.warnings });
});

// ======================================================================================
export const ticketRoutes = Router();
const r = ticketRoutes;

// --- 1. Raise Ticket (header button): any signed-in member of staff
r.post('/tickets/raise', async (req, res) => {
  await readForm(req, res);
  const out = createTicket(req, {
    subject: cleanSubject(req.body.subject), feedback: cleanDescription(req.body.description),
    requester_kind: 'staff', requester_user_id: req.user.id, raised_by: req.user.name, requester_email: req.user.email,
    channel: 'web', source: 'header',
  }, req.files);
  res.status(201).json({ ticket_no: out.ticket_no, warnings: out.warnings });
});

// --- 5. Agent "New ticket" on the board
r.post('/ticket-board/tickets', async (req, res) => {
  need(req, 'tickets.create');
  await readForm(req, res);
  const b = req.body;
  let requester;
  if (b.requester_user_id) {
    const u = get("SELECT id, name, email FROM users WHERE id = ? AND status = 'active'", Number(b.requester_user_id)) || fail(400, 'Choose an active user as the requester.');
    requester = { requester_kind: 'staff', requester_user_id: u.id, raised_by: u.name, requester_email: u.email };
  } else {
    requester = { requester_kind: 'guest', raised_by: cleanTypedName(b.requester_name), requester_email: cleanEmail(b.requester_email) };
  }
  const out = createTicket(req, {
    ...requester, subject: cleanSubject(b.subject, true), feedback: cleanDescription(b.description),
    priority: oneOf(b.priority, PRIORITIES, 'Priority', 'normal'), ticket_type: oneOf(b.ticket_type, TYPES, 'Type', 'issue'),
    group_name: oneOf(b.group_name, activeGroups(), 'Group', defaultGroup()),
    channel: 'agent', source: 'agent', firstLine: `Ticket created by ${req.user.name}`,
  }, req.files);
  res.status(201).json({ ticket_no: out.ticket_no, warnings: out.warnings });
});

// --- Dashboard
const BASE_SELECT = `SELECT t.*, a.name AS assignee_name, ru.name AS requester_name,
  (SELECT m.body FROM ticket_messages m WHERE m.ticket_id = t.id AND m.author_type <> 'system' AND m.body <> ''
   ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_body
  FROM tickets t LEFT JOIN users a ON a.id = t.assignee_id LEFT JOIN users ru ON ru.id = t.requester_user_id`;

export const VIEWS = [
  { key: 'mine', label: 'Your unsolved tickets', test: (t, me) => t.assignee_id === me && t.status !== 'solved' },
  { key: 'unassigned', label: 'Unassigned tickets', test: (t) => !t.assignee_id && t.status !== 'solved' },
  { key: 'unsolved', label: 'All unsolved tickets', test: (t) => t.status !== 'solved' },
  { key: 'urgent_high', label: 'Urgent & high priority', test: (t) => ['urgent', 'high'].includes(t.priority) && t.status !== 'solved' },
  { key: 'email', label: 'Email tickets', test: (t) => t.channel === 'email' && t.status !== 'solved' },
  { key: 'pending', label: 'Pending tickets', test: (t) => t.status === 'pending' },
  { key: 'recent_solved', label: 'Recently solved', test: (t) => t.status === 'solved' && t.solved_at && Date.now() - Date.parse(t.solved_at) < 7 * 86400e3 },
];
const CARDS = {
  total: () => true,
  solved: (t) => t.status === 'solved',
  unsolved: (t) => t.status !== 'solved',
  unassigned: (t) => !t.assignee_id && t.status !== 'solved',
  breached: (t) => t.sla.breached,
};
const list = (v) => String(v || '').split(',').map(s => s.trim()).filter(Boolean);

r.get('/ticket-board', (req, res) => {
  need(req, 'tickets.view');
  const now = Date.now(), hours = slaHours(), me = req.user.id;
  const tickets = all(`${BASE_SELECT} ORDER BY t.updated_at DESC, t.id DESC`).map(t => decorate(t, now, hours));
  const counts = { total: tickets.length };
  for (const k of ['solved', 'unsolved', 'unassigned', 'breached']) counts[k] = tickets.filter(CARDS[k]).length;
  const countBy = (key, keys) => { const o = Object.fromEntries(keys.map(k => [k, 0])); tickets.forEach(t => { o[t[key]] = (o[t[key]] || 0) + 1; }); return o; };
  const groups = all('SELECT name, active FROM ticket_groups ORDER BY position, id');
  const charts = { status: countBy('status', STATUSES), priority: countBy('priority', PRIORITIES), group: countBy('group_name', groups.filter(g => g.active).map(g => g.name)) };
  const views = VIEWS.map(v => ({ key: v.key, label: v.label, count: tickets.filter(t => v.test(t, me)).length }));
  const defaultView = views[0].count ? 'mine' : 'unsolved';

  let card = CARDS[req.query.card] ? req.query.card : null;
  let view = card ? null : VIEWS.find(v => v.key === req.query.view)?.key || defaultView;
  let rows = card ? tickets.filter(CARDS[card]) : tickets.filter(t => VIEWS.find(v => v.key === view).test(t, me));
  const fg = list(req.query.group), fp = list(req.query.priority), fs2 = list(req.query.status);
  if (fg.length) rows = rows.filter(t => fg.includes(t.group_name));
  if (fp.length) rows = rows.filter(t => fp.includes(t.priority));
  if (fs2.length) rows = rows.filter(t => fs2.includes(t.status));
  if (view === 'recent_solved') rows.sort((a, b) => String(b.solved_at).localeCompare(String(a.solved_at)));
  const matching = rows.length;
  rows = rows.slice(0, 2000).map(({ feedback, last_body, notes, ...t }) => ({
    ...t, preview: cut(stripFrom(last_body || feedback).replace(/\s+/g, ' '), 160),
  }));
  res.json({
    counts, charts, views, view, card, default_view: defaultView, rows, matching,
    groups: groups.map(g => g.name), active_groups: groups.filter(g => g.active).map(g => g.name), can: { add: can(req, 'tickets.create'), edit: can(req, 'tickets.edit') },
  });
});

// Unsolved tickets for the Task Board's first column (most urgent first). assignee: 'me' | 'none' | user id | undefined
export function boardTickets(req, assignee) {
  const now = Date.now(), hours = slaHours();
  // a ticket already converted into a task shows as that task, not here
  let rows = all(`${BASE_SELECT} WHERE t.status <> 'solved' AND (t.wp_id IS NULL OR NOT EXISTS (SELECT 1 FROM work_packages w WHERE w.id = t.wp_id))`).map(t => decorate(t, now, hours));
  if (assignee === 'me') rows = rows.filter(t => t.assignee_id === req.user.id);
  else if (assignee === 'none') rows = rows.filter(t => !t.assignee_id);
  else if (/^\d+$/.test(assignee || '')) rows = rows.filter(t => t.assignee_id === Number(assignee));
  const rank = { breached: 0, warn: 1, ok: 2, paused: 3, none: 4 }, prio = { urgent: 0, high: 1, normal: 2 };
  rows.sort((a, b) => rank[a.sla.state] - rank[b.sla.state] || prio[a.priority] - prio[b.priority] || a.raised_on.localeCompare(b.raised_on));
  return rows.slice(0, 200).map(t => ({
    id: t.id, ticket_no: t.ticket_no, subject_display: t.subject_display, status: t.status, priority: t.priority, group_name: t.group_name,
    assignee_id: t.assignee_id, assignee_name: t.assignee_name, requester_display: t.requester_display, sla: t.sla, age: t.age,
    raised_by: t.raised_by, description: stripFrom(t.feedback),
  }));
}

// --- Ticket screen
function findTicket(no) {
  if (!/^\d{8}$/.test(String(no))) fail(404, 'Ticket not found.');
  return get('SELECT * FROM tickets WHERE ticket_no = ?', Number(no)) || fail(404, 'Ticket not found.');
}
function requesterWhere(t) {
  if (t.requester_user_id) return ['requester_user_id = ?', [t.requester_user_id]];
  if (t.requester_email) return ['lower(requester_email) = lower(?) AND requester_user_id IS NULL', [t.requester_email]];
  return ['raised_by = ? AND requester_user_id IS NULL', [t.raised_by]];
}
const attachmentsFor = (ticketId) => all('SELECT id, message_id, file_name, mime_type, size_bytes, created_at FROM ticket_attachments WHERE ticket_id = ? ORDER BY id', ticketId);

r.get('/tickets/:no', (req, res) => {
  need(req, 'tickets.view');
  const raw = findTicket(req.params.no);
  const now = Date.now(), hours = slaHours();
  const t = decorate({ ...raw, assignee_name: userById(raw.assignee_id)?.name || null, requester_name: userById(raw.requester_user_id)?.name || null }, now, hours);
  const files = attachmentsFor(t.id);
  const messages = all('SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at, id', t.id)
    .map(m => ({ ...m, attachments: files.filter(f => f.message_id === m.id) }));
  const [w, p] = requesterWhere(t);
  const rq = t.requester_user_id ? get(`SELECT u.name, u.email, u.job_title, r.name AS role FROM users u LEFT JOIN roles r ON r.id = u.global_role_id WHERE u.id = ?`, t.requester_user_id) : null;
  const stats = get(`SELECT COUNT(*) AS total, SUM(status <> 'solved') AS unsolved FROM tickets WHERE ${w}`, ...p);
  const history = all(`SELECT ticket_no, subject, feedback, status, raised_on FROM tickets WHERE ${w} AND id <> ? ORDER BY raised_on DESC LIMIT 200`, ...p, t.id)
    .map(h => ({ ticket_no: h.ticket_no, subject_display: displaySubject(h), status: h.status, raised_on: h.raised_on }));
  const open = Object.fromEntries(all("SELECT assignee_id, COUNT(*) AS n FROM tickets WHERE status <> 'solved' AND assignee_id IS NOT NULL GROUP BY assignee_id").map(x => [x.assignee_id, x.n]));
  const engs = engineers().map(u => ({ id: u.id, name: u.name, open_count: open[u.id] || 0, is_me: u.id === req.user.id }));
  if (t.assignee_id && !engs.some(e => e.id === t.assignee_id) && t.assignee_name) engs.push({ id: t.assignee_id, name: t.assignee_name, open_count: open[t.assignee_id] || 0, is_me: t.assignee_id === req.user.id, former: true });
  res.json({
    ticket: { ...t, attachments: files.filter(f => !f.message_id) },
    messages,
    requester: {
      name: rq?.name || t.raised_by, kind: t.requester_kind, kind_label: KIND_LABEL[t.requester_kind],
      detail: t.requester_kind === 'partner' ? t.partner_code : rq ? [rq.job_title, rq.role].filter(Boolean).join(' · ') : null,
      email: rq?.email || t.requester_email || null, total: stats.total, unsolved: stats.unsolved || 0,
    },
    history,
    engineers: engs,
    options: { statuses: STATUSES, priorities: PRIORITIES, types: TYPES, groups: activeGroups() },
    macros: all('SELECT id, name, body_template, set_status, set_group, is_internal FROM ticket_macros WHERE active = 1 ORDER BY display_order, id'),
    can: { edit: can(req, 'tickets.edit'), delete: !!req.user.is_admin },
    me: { id: req.user.id, name: req.user.name },
    reply_hint: replyHint(t),
    linked_task: linkedTask(t.wp_id),
  });
});

function linkedTask(wpId) {
  if (!wpId) return null;
  return get(`SELECT w.id, p.identifier || '-' || w.number AS key, w.subject, s.name AS status_name, s.color AS status_color, s.is_closed
              FROM work_packages w JOIN projects p ON p.id = w.project_id JOIN statuses s ON s.id = w.status_id WHERE w.id = ?`, wpId) || null;
}

// Convert a ticket into a task (dragged from the Task Board's Tickets column). Same fields as a new task;
// the task gets the ticket's description and files, and the two stay linked.
r.post('/tickets/:no/convert', (req, res) => {
  need(req, 'tickets.edit');
  const t = findTicket(req.params.no);
  const existing = linkedTask(t.wp_id);
  if (existing) fail(400, `This ticket is already linked to task ${existing.key}.`);
  const p = resolveProject(req.body.project_id);
  if (p.archived) fail(400, 'This project is archived.');
  const body = { ...req.body, subject: req.body.subject || displaySubject(t) };
  if (!body.description) body.description = `${stripFrom(t.feedback)}\n\n_From ticket #${t.ticket_no}, raised by ${t.raised_by}._`;
  const wp = createWp(req, p.id, body, { journalNote: `Created from ticket #${t.ticket_no}` });
  const at = nowIso();
  tx(() => {
    run('UPDATE tickets SET wp_id = ?, updated_at = ? WHERE id = ?', wp.id, at, t.id);
    systemLine(t.id, `Converted to task ${wp.key}`, req.user.name, at);
    // the ticket's own files and those on public replies go with the task (same stored file, no copy)
    for (const a of all(`SELECT a.* FROM ticket_attachments a LEFT JOIN ticket_messages m ON m.id = a.message_id
                         WHERE a.ticket_id = ? AND (a.message_id IS NULL OR m.is_internal = 0)`, t.id)) {
      run(`INSERT INTO attachments(container_type, container_id, project_id, filename, stored_name, content_type, size, uploaded_by)
           VALUES('wp', ?, ?, ?, ?, ?, ?, ?)`, wp.id, p.id, a.file_name, a.stored_name, a.mime_type, a.size_bytes, a.uploaded_by);
    }
  });
  audit(req, 'TICKET_UPDATED', t, { converted_to: wp.key, wp_id: wp.id });
  res.status(201).json(wp);
});

// Called when a task is closed: tickets linked to it are solved and their requesters told.
export function solveLinkedTickets(req, wp) {
  try {
    for (const t of all("SELECT * FROM tickets WHERE wp_id = ? AND status <> 'solved'", wp.id)) {
      const at = nowIso();
      const saved = saveFields(t, statusFields(t, 'solved', at), at);
      systemLine(t.id, `Solved: linked task ${wp.key} was closed`, req.user.name, at);
      audit(req, 'TICKET_UPDATED', saved, { changes: { status: [t.status, 'solved'] }, via_task: wp.key });
      alertRequester(saved, req.user, `Ticket ${saved.ticket_no} is Solved`, `The work for your ticket is done (task ${wp.key} was closed by ${req.user.name}).`);
    }
  } catch (e) { console.error('Solving linked tickets failed:', e.message); }
}

// --- Field changes: each saved on its own; every change writes an activity line and an audit row
const label = (field, v) => (field === 'status' ? STATUS_LABEL[v] || v : v ?? '—');
function applyChanges(req, t, body) {
  const at = nowIso();
  const actor = req.user;
  const fields = {}, lines = [], forRequester = [], changes = {};
  let newAssignee = null;
  if ('assignee_id' in body) {
    const id = body.assignee_id === null || body.assignee_id === '' ? null : Number(body.assignee_id);
    if (id !== null && !engineers().some(e => e.id === id)) fail(400, 'Choose one of the engineers.');
    if (id !== t.assignee_id) {
      const oldName = userById(t.assignee_id)?.name, newName = userById(id)?.name;
      fields.assignee_id = id; changes.assignee_id = [t.assignee_id, id];
      lines.push(!t.assignee_id ? `Assigned to ${newName}` : !id ? `Unassigned (was ${oldName})` : `Assignee changed from ${oldName} to ${newName}`);
      forRequester.push(id ? `Your ticket is now assigned to ${newName}.` : 'Your ticket is waiting to be assigned again.');
      newAssignee = id;
    }
  }
  const simple = [
    ['group_name', 'Group', () => oneOf(body.group_name, activeGroups(), 'Group', undefined)],
    ['ticket_type', 'Type', () => oneOf(body.ticket_type, TYPES, 'Type', undefined)],
    ['priority', 'Priority', () => oneOf(body.priority, PRIORITIES, 'Priority', undefined)],
    ['subject', 'Subject', () => cleanSubject(body.subject, true)],
  ];
  for (const [key, name, read] of simple) {
    if (!(key in body)) continue;
    const v = read();
    if (v === undefined) fail(400, `${name} can't be blank.`);
    if (v === t[key]) continue;
    fields[key] = v; changes[key] = [t[key], v];
    const line = key === 'subject' ? `Subject changed from "${displaySubject(t)}" to "${v}"` : `${name} changed from ${t[key]} to ${v}`;
    lines.push(line); forRequester.push(`${line}.`);
  }
  for (const [key, max] of [['tags', 500], ['linked_record', 100]]) {
    if (!(key in body)) continue;
    const v = String(body[key] ?? '').trim().slice(0, max) || null;
    if (v === t[key]) continue;
    fields[key] = v; changes[key] = [t[key], v];
    lines.push(key === 'tags' ? `Tags changed to ${v || '(none)'}` : `Linked record changed to ${v || '(none)'}`);
  }
  if ('status' in body) {
    const to = oneOf(body.status, STATUSES, 'Status', undefined);
    if (!to) fail(400, "Status can't be blank.");
    if (to !== t.status) {
      Object.assign(fields, statusFields(t, to, at)); changes.status = [t.status, to];
      lines.push(`Status changed from ${label('status', t.status)} to ${label('status', to)}`);
    }
  }
  return { fields, lines, forRequester, changes, newAssignee, at, actor };
}
function commit(req, t, c, { requesterTitle } = {}) {
  if (!Object.keys(c.fields).length) return t;
  const saved = tx(() => {
    const s = saveFields(t, c.fields, c.at);
    c.lines.forEach(l => systemLine(t.id, l, c.actor.name, c.at));
    return s;
  });
  audit(req, 'TICKET_UPDATED', saved, { changes: c.changes });
  if (c.newAssignee) alertAssignee(saved, c.newAssignee, c.actor);
  if (requesterTitle !== false) {
    if (c.changes.status && c.forRequester.length === 0) alertRequester(saved, c.actor, `Ticket ${saved.ticket_no} is ${STATUS_LABEL[saved.status]}`, `${c.actor.name} changed the status to ${STATUS_LABEL[saved.status]}.`);
    else if (c.forRequester.length || c.changes.status) {
      const extra = c.changes.status ? ` Status is now ${STATUS_LABEL[saved.status]}.` : '';
      alertRequester(saved, c.actor, `Ticket ${saved.ticket_no} updated`, `${c.forRequester.join(' ')}${extra}`.trim());
    }
  }
  return saved;
}

r.patch('/tickets/:no', (req, res) => {
  need(req, 'tickets.edit');
  const t = findTicket(req.params.no);
  const c = applyChanges(req, t, req.body || {});
  const saved = commit(req, t, c);
  res.json({ ok: true, changed: Object.keys(c.changes), status: saved.status });
});

r.post('/tickets/:no/take', (req, res) => {
  need(req, 'tickets.edit');
  const t = findTicket(req.params.no);
  if (t.assignee_id === req.user.id) return res.json({ ok: true });
  if (!engineers().some(e => e.id === req.user.id)) fail(400, 'You are not one of the engineers who can be assigned tickets.');
  commit(req, t, applyChanges(req, t, { assignee_id: req.user.id }));
  res.json({ ok: true });
});

// --- Reply / internal note, with "Submit as [status]"
r.post('/tickets/:no/reply', async (req, res) => {
  need(req, 'tickets.edit');
  await readForm(req, res);
  const t = findTicket(req.params.no);
  const body = String(req.body.body ?? '').trim();
  if (body.length > MAX_DESC) fail(400, `A reply can be up to ${MAX_DESC} characters.`);
  const internal = ['1', 'true', 'on', true].includes(req.body.internal);
  const files = req.files || [];
  const to = req.body.status ? oneOf(req.body.status, STATUSES, 'Status', t.status) : t.status;
  if (!body && !files.length && to === t.status) fail(400, 'Write a reply or change the status.');
  const at = nowIso();
  const actor = req.user;
  let msgId = null, warnings = [], assignedNow = false;
  const changes = {};
  const saved = tx(() => {
    let cur = t;
    const fields = {};
    if (body || files.length) {
      msgId = run(`INSERT INTO ticket_messages(ticket_id, author_type, author_user_id, author_name, body, is_internal, created_at)
                   VALUES(?, 'user', ?, ?, ?, ?, ?)`, t.id, actor.id, actor.name, body, internal ? 1 : 0, at).id;
      if (!internal && !t.assignee_id && engineers().some(e => e.id === actor.id)) {
        fields.assignee_id = actor.id; changes.assignee_id = [null, actor.id]; assignedNow = true;
        systemLine(t.id, `Assigned to ${actor.name} (replied)`, actor.name, at);
      }
    }
    if (to !== t.status) {
      Object.assign(fields, statusFields(t, to, at)); changes.status = [t.status, to];
      systemLine(t.id, `Status changed from ${STATUS_LABEL[t.status]} to ${STATUS_LABEL[to]}`, actor.name, at);
    }
    cur = saveFields(t, fields, at);
    return cur;
  });
  if (msgId && files.length) {
    try { warnings = saveFiles(saved, files, msgId, actor.id).warnings; } catch (e) { console.error(e); warnings = ['The files could not be saved.']; }
  }
  audit(req, 'TICKET_UPDATED', saved, { reply: !!msgId && !internal, note: !!msgId && internal, changes });
  if (assignedNow) { /* replier assigned themselves: nobody else to tell */ }
  // requester: public reply (+ status) or a status change alone; an internal note itself alerts no one
  if (msgId && !internal) {
    alertRequester(saved, actor, `Reply on ticket ${saved.ticket_no}`,
      `${actor.name} replied: ${cut(body || '(attachment)', 500)}${changes.status ? ` Status is now ${STATUS_LABEL[saved.status]}.` : ''}`);
  } else if (changes.status) {
    alertRequester(saved, actor, `Ticket ${saved.ticket_no} is ${STATUS_LABEL[saved.status]}`, `${actor.name} changed the status to ${STATUS_LABEL[saved.status]}.`);
  }
  res.status(201).json({ ok: true, status: saved.status, warnings });
});

// --- Attachments (agents: any; requester/admin: not on internal notes)
r.get('/ticket-attachments/:id', (req, res) => {
  const a = get('SELECT * FROM ticket_attachments WHERE id = ?', Number(req.params.id)) || fail(404, 'File not found.');
  const t = get('SELECT * FROM tickets WHERE id = ?', a.ticket_id) || fail(404, 'File not found.');
  const m = a.message_id ? get('SELECT is_internal FROM ticket_messages WHERE id = ?', a.message_id) : null;
  const allowed = can(req, 'tickets.view') || ((t.requester_user_id === req.user.id || req.user.is_admin) && !m?.is_internal);
  if (!allowed) fail(404, 'File not found.');
  const file = path.join(UPLOAD_DIR, path.basename(a.stored_name));
  if (!fs.existsSync(file)) fail(404, 'The file is missing from the server.');
  const ext = path.extname(a.stored_name).slice(1).toLowerCase();
  const type = FILE_TYPES[ext] || 'application/octet-stream';
  const inline = req.query.inline === '1' && /^(image\/|application\/pdf)/.test(type);
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.file_name)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  fs.createReadStream(file).pipe(res);
});

// Delete (administrators only): e.g. spam from the login page form. Removes the files too.
r.delete('/tickets/:no', (req, res) => {
  if (!req.user.is_admin) fail(403, 'Only administrators can delete tickets.');
  const t = findTicket(req.params.no);
  const files = all('SELECT stored_name FROM ticket_attachments WHERE ticket_id = ?', t.id);
  run('DELETE FROM tickets WHERE id = ?', t.id);
  for (const f of files) {
    if (!get('SELECT 1 AS x FROM attachments WHERE stored_name = ?', f.stored_name)) fs.rmSync(path.join(UPLOAD_DIR, path.basename(f.stored_name)), { force: true });
  }
  audit(req, 'TICKET_DELETED', t, { subject: displaySubject(t), raised_by: t.raised_by });
  res.json({ ok: true });
});

// ======================================================================================
// Requester side: "Tickets Raised" (admins see all; everyone else their own)
r.get('/tickets-raised', (req, res) => {
  const admin = !!req.user.is_admin;
  const rows = all(`SELECT t.*, ru.name AS requester_name, a.name AS assignee_name FROM tickets t
                    LEFT JOIN users ru ON ru.id = t.requester_user_id LEFT JOIN users a ON a.id = t.assignee_id
                    ${admin ? '' : 'WHERE t.requester_user_id = ?'} ORDER BY t.raised_on DESC LIMIT 2000`, ...(admin ? [] : [req.user.id]));
  const files = rows.length ? all(`SELECT id, ticket_id, file_name, mime_type FROM ticket_attachments WHERE message_id IS NULL AND ticket_id IN (${rows.map(x => x.id).join(',')})`) : [];
  const now = Date.now();
  const out = rows.map(t => ({
    ticket_no: t.ticket_no, raised_on: t.raised_on, raised_by: t.requester_name || t.raised_by, requester_kind: t.requester_kind,
    subject_display: displaySubject(t), description: stripFrom(t.feedback), status: t.status, simple_status: t.status === 'solved' ? 'Closed' : 'Open',
    priority: t.priority, age: ageText(t, now), age_days: Math.floor(((t.status === 'solved' && t.solved_at ? Date.parse(t.solved_at) : now) - Date.parse(t.raised_on)) / 86400e3),
    attachments: files.filter(f => f.ticket_id === t.id).map(({ ticket_id, ...f }) => f), mine: t.requester_user_id === req.user.id,
  }));
  const open = out.filter(t => t.status !== 'solved');
  res.json({
    is_admin: admin, rows: out,
    tiles: { total: out.length, open: open.length, closed: out.length - open.length, avg_ageing: open.length ? Math.round(open.reduce((s, t) => s + t.age_days, 0) / open.length * 10) / 10 : 0 },
  });
});

// The raiser or an admin; anyone else gets 404 (no hint that the ticket exists).
function requesterTicket(req) {
  let t;
  try { t = findTicket(req.params.no); } catch { fail(404, 'Ticket not found.'); }
  if (!(t.requester_user_id === req.user.id || req.user.is_admin)) fail(404, 'Ticket not found.');
  return t;
}
r.get('/tickets/:no/thread', (req, res) => {
  const t = requesterTicket(req);
  const files = attachmentsFor(t.id);
  const messages = all('SELECT id, author_type, author_name, body, created_at FROM ticket_messages WHERE ticket_id = ? AND is_internal = 0 ORDER BY created_at, id', t.id)
    .map(m => ({ ...m, attachments: files.filter(f => f.message_id === m.id) }));
  res.json({
    ticket: {
      ticket_no: t.ticket_no, subject_display: displaySubject(t), description: t.feedback, status: t.status, simple_status: t.status === 'solved' ? 'Closed' : 'Open',
      priority: t.priority, group_name: t.group_name, handled_by: userById(t.assignee_id)?.name || null, raised_on: t.raised_on,
      raised_by: userById(t.requester_user_id)?.name || t.raised_by, attachments: files.filter(f => !f.message_id),
    },
    messages,
    can: { reply: t.requester_user_id === req.user.id, close: !!req.user.is_admin && t.status !== 'solved' },
  });
});

// Extra 1: the requester replies; reopens a pending or solved ticket; alerts the assignee (or the agents).
r.post('/tickets/:no/thread/reply', async (req, res) => {
  await readForm(req, res);
  const t = requesterTicket(req);
  if (t.requester_user_id !== req.user.id) fail(403, 'Only the person who raised the ticket can reply here.');
  const body = String(req.body.body ?? '').trim();
  if (!body) fail(400, 'Write a reply.');
  if (body.length > MAX_DESC) fail(400, `A reply can be up to ${MAX_DESC} characters.`);
  const at = nowIso();
  let msgId;
  const saved = tx(() => {
    msgId = run(`INSERT INTO ticket_messages(ticket_id, author_type, author_user_id, author_name, body, is_internal, created_at)
                 VALUES(?, 'requester', ?, ?, ?, 0, ?)`, t.id, req.user.id, req.user.name, body, at).id;
    const fields = {};
    if (['pending', 'solved'].includes(t.status)) {
      Object.assign(fields, statusFields(t, 'open', at));
      systemLine(t.id, `Status changed from ${STATUS_LABEL[t.status]} to Open (requester replied)`, req.user.name, at);
    }
    return saveFields(t, fields, at);
  });
  let warnings = [];
  if (req.files?.length) { try { warnings = saveFiles(saved, req.files, msgId, req.user.id).warnings; } catch { warnings = ['The files could not be saved.']; } }
  audit(req, 'TICKET_UPDATED', saved, { requester_reply: true, reopened: saved.status !== t.status });
  safely(() => notify(t.assignee_id ? [t.assignee_id] : agentsToAlert(), {
    actorId: req.user.id, ticketId: t.id, link: `/ticket-board/${t.ticket_no}`, reason: 'ticket_reply',
    message: `Reply on ticket ${t.ticket_no} — ${req.user.name} replied: ${cut(body, 200)}`,
  }));
  res.status(201).json({ ok: true, status: saved.status, warnings });
});

// Close from Tickets Raised: administrators only. Notes are appended, shown in the thread, and sent to the requester.
r.post('/tickets/:no/close', (req, res) => {
  if (!req.user.is_admin) fail(403, 'Only administrators can close tickets here.');
  const t = findTicket(req.params.no);
  if (t.status === 'solved') fail(400, 'This ticket is already closed.');
  const notes = String(req.body.notes ?? '').trim().slice(0, 2000);
  const at = nowIso();
  const saved = tx(() => {
    const fields = statusFields(t, 'solved', at);
    if (notes) fields.notes = `${t.notes ? `${t.notes}\n` : ''}[${at.slice(0, 16).replace('T', ' ')} UTC, ${req.user.name}] ${notes}`;
    if (notes) run(`INSERT INTO ticket_messages(ticket_id, author_type, author_user_id, author_name, body, is_internal, created_at)
                    VALUES(?, 'user', ?, ?, ?, 0, ?)`, t.id, req.user.id, req.user.name, `Closing note: ${notes}`, at);
    systemLine(t.id, `Closed from Tickets Raised${notes ? ` — ${notes}` : ''}`, req.user.name, at);
    return saveFields(t, fields, at);
  });
  audit(req, 'TICKET_UPDATED', saved, { changes: { status: [t.status, 'solved'] }, closed_from: 'tickets raised', notes });
  alertRequester(saved, req.user, `Ticket ${saved.ticket_no} is Solved`, `${req.user.name} closed your ticket.${notes ? ` Closing notes: ${notes}` : ''}`);
  res.json({ ok: true });
});

// ======================================================================================
// Administration: SLA hours, groups, macros
r.get('/admin/ticket-settings', (req, res) => {
  need(req, 'admin.settings');
  res.json({
    sla: slaHours(),
    groups: all('SELECT g.*, (SELECT COUNT(*) FROM tickets t WHERE t.group_name = g.name) AS ticket_count FROM ticket_groups g ORDER BY position, id'),
    macros: all('SELECT * FROM ticket_macros ORDER BY display_order, id'),
    statuses: STATUSES,
  });
});
r.put('/admin/ticket-settings/sla', (req, res) => {
  need(req, 'admin.settings');
  for (const k of PRIORITIES) {
    const v = Number(req.body[k]);
    if (!Number.isFinite(v) || v <= 0 || v > 24 * 90) fail(400, `Enter the ${k} SLA in hours (more than 0).`);
  }
  for (const k of PRIORITIES) setSetting(`ticket_sla_hours_${k}`, Number(req.body[k]));
  res.json({ ok: true });
});
r.post('/admin/ticket-groups', (req, res) => {
  need(req, 'admin.settings');
  const name = String(req.body.name || '').trim().slice(0, 60);
  if (!name) fail(400, 'Name is required.');
  if (get('SELECT id FROM ticket_groups WHERE lower(name) = lower(?)', name)) fail(400, 'That group already exists.');
  const pos = get('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM ticket_groups').p;
  res.status(201).json({ id: run('INSERT INTO ticket_groups(name, active, position) VALUES(?, 1, ?)', name, pos).id });
});
r.patch('/admin/ticket-groups/:id', (req, res) => {
  need(req, 'admin.settings');
  const g = get('SELECT * FROM ticket_groups WHERE id = ?', Number(req.params.id)) || fail(404, 'Group not found.');
  tx(() => {
    if (req.body.name !== undefined) {
      const name = String(req.body.name || '').trim().slice(0, 60);
      if (!name) fail(400, 'Name is required.');
      if (get('SELECT id FROM ticket_groups WHERE lower(name) = lower(?) AND id <> ?', name, g.id)) fail(400, 'That group already exists.');
      run('UPDATE ticket_groups SET name = ? WHERE id = ?', name, g.id);
      run('UPDATE tickets SET group_name = ? WHERE group_name = ?', name, g.name);
    }
    if (req.body.active !== undefined) {
      if (!req.body.active && get('SELECT COUNT(*) AS n FROM ticket_groups WHERE active = 1 AND id <> ?', g.id).n === 0) fail(400, 'Keep at least one group active.');
      run('UPDATE ticket_groups SET active = ? WHERE id = ?', req.body.active ? 1 : 0, g.id);
    }
  });
  res.json({ ok: true });
});
function macroFields(b) {
  const name = String(b.name || '').trim().slice(0, 80);
  const body = String(b.body_template || '').trim().slice(0, MAX_DESC);
  if (!name) fail(400, 'Name is required.');
  if (!body) fail(400, 'The reply text is required.');
  return {
    name, body_template: body, set_status: oneOf(b.set_status || null, STATUSES, 'Status', null),
    set_group: b.set_group ? oneOf(b.set_group, activeGroups(), 'Group', null) : null,
    is_internal: b.is_internal ? 1 : 0, active: b.active === undefined ? 1 : b.active ? 1 : 0,
  };
}
r.post('/admin/ticket-macros', (req, res) => {
  need(req, 'admin.settings');
  const f = macroFields(req.body);
  const pos = get('SELECT COALESCE(MAX(display_order), 0) + 1 AS p FROM ticket_macros').p;
  res.status(201).json({ id: run('INSERT INTO ticket_macros(name, body_template, set_status, set_group, is_internal, active, display_order) VALUES(?,?,?,?,?,?,?)',
    f.name, f.body_template, f.set_status, f.set_group, f.is_internal, f.active, pos).id });
});
r.put('/admin/ticket-macros/:id', (req, res) => {
  need(req, 'admin.settings');
  const m = get('SELECT id FROM ticket_macros WHERE id = ?', Number(req.params.id)) || fail(404, 'Macro not found.');
  const f = macroFields(req.body);
  run('UPDATE ticket_macros SET name = ?, body_template = ?, set_status = ?, set_group = ?, is_internal = ?, active = ? WHERE id = ?',
    f.name, f.body_template, f.set_status, f.set_group, f.is_internal, f.active, m.id);
  res.json({ ok: true });
});
r.delete('/admin/ticket-macros/:id', (req, res) => {
  need(req, 'admin.settings');
  run('DELETE FROM ticket_macros WHERE id = ?', Number(req.params.id));
  res.json({ ok: true });
});
