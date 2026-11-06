// Project Board: one page per project with its brief, customer, customer user roles, team,
// and the seven standard project documents (each uploaded as new versions, the latest shown).
import { Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { get, all, run, tx, UPLOAD_DIR, maxUploadMb } from '../db.js';
import { need, can, fail } from '../access.js';
import { resolveProject, listMembers } from './projects.js';
import { positionsFor } from '../positions.js';
import { notify } from '../util.js';

export const DOC_SLOTS = [
  { key: '01', name: 'Product Overview' },
  { key: '02', name: 'Business Requirements', detail: 'BRD, with Business Rules & SOPs' },
  { key: '03', name: 'Personas & Journeys' },
  { key: '04', name: 'Permission & Security Rules' },
  { key: '05', name: 'Technical Architecture' },
  { key: '06', name: 'UAT & Disaster Recovery' },
  { key: '07', name: 'Design System' },
];

// Each project gets its own copy of the list the first time it is opened, so it can be renamed, added to and trimmed.
// Files uploaded before that point are moved from the old fixed keys ('01'..'07') to the project's own entries.
function ensureSlots(projectId) {
  if (get('SELECT 1 FROM project_doc_slots WHERE project_id = ? LIMIT 1', projectId)) return;
  if (get("SELECT 1 FROM settings WHERE key = ?", `doc_slots_seeded_${projectId}`)) return; // the list was emptied on purpose
  tx(() => {
    DOC_SLOTS.forEach((d, i) => {
      const { id } = run('INSERT INTO project_doc_slots(project_id, name, detail, position) VALUES(?,?,?,?)', projectId, d.name, d.detail || null, i);
      run("UPDATE attachments SET doc_slot = ? WHERE container_type = 'project' AND container_id = ? AND doc_slot = ?", String(id), projectId, d.key);
    });
    run("INSERT OR REPLACE INTO settings(key, value) VALUES(?, '1')", `doc_slots_seeded_${projectId}`);
  });
}
const slotsOf = (projectId) => all('SELECT id, name, detail FROM project_doc_slots WHERE project_id = ? ORDER BY position, id', projectId);

// ---------- Project Board details kept in projects.board_data ----------
export const DEMO_OPTIONS = ['Yes', 'No', 'Scheduled', 'In Process'];
export const YES_NO_PENDING = ['Yes', 'No', 'Pending'];
export const ENVIRONMENTS = ['localhost', 'staging', 'production'];
const DETAIL_KEYS = ['contact_person', 'designation', 'email', 'phone', 'website', 'address', 'notes'];
const DEFAULT_BOARD = {
  live_version: null, live_phase: null,
  customer_demo: null, customer_approval: null, customer_interaction: null,
  customer_details: {},
  hosting: { staging: '', production: '' },
  repository: { staging: '', production: '' },
  environments: [],
};
function readBoard(p) {
  let d = {};
  try { d = JSON.parse(p.board_data || '{}') || {}; } catch { /* ignore */ }
  return { ...DEFAULT_BOARD, ...d, hosting: { ...DEFAULT_BOARD.hosting, ...d.hosting }, repository: { ...DEFAULT_BOARD.repository, ...d.repository } };
}
const text = (v, max) => { const t = String(v ?? '').trim(); return t ? t.slice(0, max) : null; };
function link(v, label) {
  const t = String(v ?? '').trim();
  if (!t) return '';
  if (!/^https?:\/\/\S+$/i.test(t)) fail(400, `${label} must be a web address starting with http:// or https://`);
  return t.slice(0, 500);
}
function oneOf(v, list, label) {
  if (v === null || v === '' || v === undefined) return null;
  if (!list.includes(v)) fail(400, `${label} must be one of: ${list.join(', ')}.`);
  return v;
}
// Merge a partial update into the stored details, checking every field.
function mergeBoard(cur, b) {
  const next = { ...cur };
  if ('live_version' in b) next.live_version = text(b.live_version, 50);
  if ('live_phase' in b) next.live_phase = text(b.live_phase, 50);
  if ('customer_demo' in b) next.customer_demo = oneOf(b.customer_demo, DEMO_OPTIONS, 'Customer demo');
  if ('customer_approval' in b) next.customer_approval = oneOf(b.customer_approval, YES_NO_PENDING, 'Customer approval');
  if ('customer_interaction' in b) next.customer_interaction = oneOf(b.customer_interaction, YES_NO_PENDING, 'Customer interaction');
  if (b.customer_details && typeof b.customer_details === 'object') {
    next.customer_details = Object.fromEntries(DETAIL_KEYS.map(k => [k, text(b.customer_details[k], k === 'address' || k === 'notes' ? 1000 : 200)]).filter(([, v]) => v));
    if (next.customer_details.website) next.customer_details.website = link(next.customer_details.website, 'Website');
  }
  if (b.hosting) next.hosting = { staging: link(b.hosting.staging, 'Hosting (staging)'), production: link(b.hosting.production, 'Hosting (production)') };
  if (b.repository) next.repository = { staging: link(b.repository.staging, 'Code repository (staging)'), production: link(b.repository.production, 'Code repository (production)') };
  if (Array.isArray(b.environments)) next.environments = ENVIRONMENTS.filter(e => b.environments.includes(e));
  return next;
}

const canBrief = (req, pid) => can(req, 'project.edit', pid) || can(req, 'project.brief', pid);
const canDocs = (req, pid) => can(req, 'project.edit', pid) || can(req, 'project.documents', pid);

const storage = multer.diskStorage({ destination: UPLOAD_DIR, filename: (_q, _f, cb) => cb(null, crypto.randomBytes(16).toString('hex')) });
const upload = { single: (field) => multer({ storage, limits: { fileSize: maxUploadMb() * 1024 * 1024 } }).single(field) };

const r = Router();

r.get('/projects/:pid/board-info', (req, res) => {
  const p = resolveProject(req.params.pid);
  need(req, 'project.view', p.id);
  const roles = all('SELECT id, name, description, pain_points, challenges, touch_points FROM project_customer_roles WHERE project_id = ? ORDER BY position, id', p.id);
  // Delivery figures
  const testingIds = all("SELECT id FROM statuses WHERE board_column = 'testing' AND is_closed = 0").map(x => x.id);
  const counts = get(`SELECT COUNT(*) AS total, SUM(CASE WHEN s.is_closed = 0 THEN 1 ELSE 0 END) AS open,
                        SUM(CASE WHEN s.board_column = 'testing' AND s.is_closed = 0 THEN 1 ELSE 0 END) AS testing
                      FROM work_packages wp JOIN statuses s ON s.id = wp.status_id WHERE wp.project_id = ?`, p.id);
  const release = get(`SELECT id, name, description, status, due_date FROM versions WHERE project_id = ?
                       ORDER BY (status = 'closed') DESC, COALESCE(due_date, created_at) DESC, id DESC LIMIT 1`, p.id);
  const tech = all('SELECT name, category, version_used FROM project_technologies WHERE project_id = ? ORDER BY position, name COLLATE NOCASE', p.id);
  ensureSlots(p.id);
  const files = all(`SELECT a.id, a.doc_slot, a.filename, a.size, a.content_type, a.created_at, a.uploaded_by, u.name AS uploaded_by_name
                     FROM attachments a LEFT JOIN users u ON u.id = a.uploaded_by
                     WHERE a.container_type = 'project' AND a.container_id = ? AND a.doc_slot IS NOT NULL
                     ORDER BY a.created_at DESC, a.id DESC`, p.id);
  const documents = slotsOf(p.id).map((s, i) => {
    const versions = files.filter(f => f.doc_slot === String(s.id));
    return { ...s, key: String(i + 1).padStart(2, '0'), latest: versions[0] || null, versions };
  });
  res.json({
    project: { id: p.id, name: p.name, identifier: p.identifier, color: p.color, status: p.status, description: p.description,
      customer_name: p.customer_name, start_date: p.start_date, end_date: p.end_date },
    customer_roles: roles,
    me: req.user.id,
    approvals: all(`SELECT a.id, a.module, a.first_approver_id, a.second_approver_id, a.created_at,
                       f.name AS first_approver_name, s2.name AS second_approver_name,
                       a.first_done_at, fd.name AS first_done_by_name, a.second_done_at, sd.name AS second_done_by_name
                     FROM project_approvals a LEFT JOIN users f ON f.id = a.first_approver_id LEFT JOIN users s2 ON s2.id = a.second_approver_id
                     LEFT JOIN users fd ON fd.id = a.first_done_by LEFT JOIN users sd ON sd.id = a.second_done_by
                     WHERE a.project_id = ? ORDER BY a.module COLLATE NOCASE, a.id`, p.id),
    board: readBoard(p),
    release_notes: releaseNotes(p.id),
    delivery: { tasks: counts.total || 0, open: counts.open || 0, testing: counts.testing || 0, testing_status_ids: testingIds, release: release || null },
    stack: {
      development: tech.filter(t => !['Database', 'Data', 'Infrastructure', 'DevOps', 'OS'].includes(t.category)),
      database: tech.filter(t => t.category === 'Database' || t.category === 'Data'),
    },
    options: { demo: DEMO_OPTIONS, yes_no_pending: YES_NO_PENDING, environments: ENVIRONMENTS },
    positions: positionsFor([p.id]).get(p.id),
    members: listMembers(p.id).filter(m => m.status !== 'locked'),
    documents,
    max_mb: maxUploadMb(),
    can: { brief: canBrief(req, p.id), documents: canDocs(req, p.id) },
  });
});

// Brief, customer name and customer user roles, saved together.
r.put('/projects/:pid/board-info', (req, res) => {
  const p = resolveProject(req.params.pid);
  if (!canBrief(req, p.id)) fail(403, 'You do not have permission to edit the project brief.');
  const b = req.body || {};
  const roles = Array.isArray(b.customer_roles) ? b.customer_roles : null;
  if (roles) {
    const names = roles.map(x => String(x?.name || '').trim()).filter(Boolean);
    if (names.some(n => n.length > 100)) fail(400, 'Role names must be 100 characters or fewer.');
    if (new Set(names.map(n => n.toLowerCase())).size !== names.length) fail(400, 'Each customer user role must have a different name.');
  }
  const board = b.board && typeof b.board === 'object' ? mergeBoard(readBoard(p), b.board) : null;
  tx(() => {
    if (board) run("UPDATE projects SET board_data = ?, updated_at = datetime('now') WHERE id = ?", JSON.stringify(board), p.id);
    if (b.description !== undefined || b.customer_name !== undefined) {
      run(`UPDATE projects SET description = COALESCE(?, description), customer_name = COALESCE(?, customer_name), updated_at = datetime('now') WHERE id = ?`,
        b.description === undefined ? null : String(b.description ?? ''),
        b.customer_name === undefined ? null : String(b.customer_name ?? '').trim().slice(0, 200), p.id);
    }
    if (roles) {
      run('DELETE FROM project_customer_roles WHERE project_id = ?', p.id);
      roles.forEach((x, i) => {
        const name = String(x?.name || '').trim();
        if (name) run(`INSERT INTO project_customer_roles(project_id, name, description, pain_points, challenges, touch_points, position)
                       VALUES(?,?,?,?,?,?,?)`, p.id, name, text(x.description, 500), text(x.pain_points, 2000), text(x.challenges, 2000), text(x.touch_points, 2000), i);
      });
    }
  });
  res.json({ ok: true });
});

// ---------- Release notes ----------
function releaseNotes(projectId) {
  const notes = all(`SELECT n.id, n.name, n.version, n.created_at, u.name AS created_by_name FROM project_release_notes n
                     LEFT JOIN users u ON u.id = n.created_by WHERE n.project_id = ? ORDER BY n.created_at DESC, n.id DESC`, projectId);
  const files = all(`SELECT a.id, a.doc_slot, a.filename, a.size, a.created_at, u.name AS uploaded_by_name FROM attachments a
                     LEFT JOIN users u ON u.id = a.uploaded_by
                     WHERE a.container_type = 'project' AND a.container_id = ? AND a.doc_slot LIKE 'rn:%' ORDER BY a.created_at DESC, a.id DESC`, projectId);
  return notes.map(n => ({ ...n, files: files.filter(f => f.doc_slot === `rn:${n.id}`) }));
}
function noteFields(b) {
  const name = String(b.name ?? '').trim();
  const version = String(b.version ?? '').trim();
  if (!name) fail(400, 'Enter the document name.');
  if (!version) fail(400, 'Enter the version.');
  if (name.length > 150 || version.length > 50) fail(400, 'The name or version is too long.');
  return { name, version };
}
function loadNote(req) {
  const n = get('SELECT * FROM project_release_notes WHERE id = ?', req.params.id) || fail(404, 'Release note not found.');
  if (!canDocs(req, n.project_id)) fail(403, 'You do not have permission to change release notes.');
  return n;
}

r.post('/projects/:pid/release-notes', (req, res) => {
  const p = resolveProject(req.params.pid);
  if (!canDocs(req, p.id)) fail(403, 'You do not have permission to add release notes.');
  const f = noteFields(req.body || {});
  if (get('SELECT 1 FROM project_release_notes WHERE project_id = ? AND name = ? COLLATE NOCASE AND version = ? COLLATE NOCASE', p.id, f.name, f.version)) {
    fail(400, `${f.name} ${f.version} is already listed.`);
  }
  const { id } = run('INSERT INTO project_release_notes(project_id, name, version, created_by) VALUES(?,?,?,?)', p.id, f.name, f.version, req.user.id);
  res.status(201).json({ id });
});

r.patch('/release-notes/:id', (req, res) => {
  const n = loadNote(req);
  const f = noteFields({ name: n.name, version: n.version, ...req.body });
  run('UPDATE project_release_notes SET name = ?, version = ? WHERE id = ?', f.name, f.version, n.id);
  res.json({ ok: true });
});

function removeFiles(where, ...params) {
  const files = all(`SELECT id, stored_name FROM attachments WHERE ${where}`, ...params);
  run(`DELETE FROM attachments WHERE ${where}`, ...params);
  for (const f of files) fs.rmSync(path.join(UPLOAD_DIR, f.stored_name), { force: true });
  return files.length;
}

r.delete('/release-notes/:id', (req, res) => {
  const n = loadNote(req);
  const removed = removeFiles("container_type = 'project' AND container_id = ? AND doc_slot = ?", n.project_id, `rn:${n.id}`);
  run('DELETE FROM project_release_notes WHERE id = ?', n.id);
  res.json({ ok: true, files_removed: removed });
});

r.post('/release-notes/:id/files', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    try {
      if (err) fail(400, err.code === 'LIMIT_FILE_SIZE' ? `Files must be ${maxUploadMb()} MB or smaller.` : err.message);
      if (!req.file) fail(400, 'Choose a file to upload.');
      try {
        const n = loadNote(req);
        const name = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
        const { id } = run(`INSERT INTO attachments(container_type, container_id, project_id, filename, stored_name, content_type, size, uploaded_by, doc_slot)
                            VALUES('project',?,?,?,?,?,?,?,?)`, n.project_id, n.project_id, name, req.file.filename, req.file.mimetype, req.file.size, req.user.id, `rn:${n.id}`);
        res.status(201).json({ id, filename: name });
      } catch (e) { fs.rmSync(req.file.path, { force: true }); throw e; }
    } catch (e) { next(e); }
  });
});

r.delete('/release-notes/:id/files/:fileId', (req, res) => {
  const n = loadNote(req);
  const removed = removeFiles("id = ? AND container_type = 'project' AND container_id = ? AND doc_slot = ?", Number(req.params.fileId), n.project_id, `rn:${n.id}`);
  if (!removed) fail(404, 'File not found.');
  res.json({ ok: true });
});

// Upload a new version of one of the seven documents.
r.post('/projects/:pid/documents/:slot', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    try {
      if (err) fail(400, err.code === 'LIMIT_FILE_SIZE' ? `Files must be ${maxUploadMb()} MB or smaller.` : err.message);
      if (!req.file) fail(400, 'Choose a file to upload.');
      try {
        const p = resolveProject(req.params.pid);
        ensureSlots(p.id);
        const slot = get('SELECT id FROM project_doc_slots WHERE id = ? AND project_id = ?', Number(req.params.slot), p.id);
        if (!slot) fail(404, 'Unknown document.');
        if (!canDocs(req, p.id)) fail(403, 'You do not have permission to upload project documents.');
        const name = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
        const { id } = run(`INSERT INTO attachments(container_type, container_id, project_id, filename, stored_name, content_type, size, uploaded_by, doc_slot)
                            VALUES('project',?,?,?,?,?,?,?,?)`, p.id, p.id, name, req.file.filename, req.file.mimetype, req.file.size, req.user.id, String(slot.id));
        res.status(201).json({ id, filename: name });
      } catch (e) { fs.rmSync(req.file.path, { force: true }); throw e; }
    } catch (e) { next(e); }
  });
});

// ---------- Approvals: module name with a first and second approver ----------
function approvalFields(b) {
  const module = String(b.module ?? '').trim();
  if (!module) fail(400, 'Enter the module name.');
  if (module.length > 150) fail(400, 'Module names must be 150 characters or fewer.');
  const person = (v, label) => {
    if (v === null || v === undefined || v === '') return null;
    const u = get("SELECT id FROM users WHERE id = ? AND status = 'active'", Number(v));
    if (!u) fail(400, `Choose an active user as ${label}.`);
    return u.id;
  };
  const first = person(b.first_approver_id, 'first approver');
  const second = person(b.second_approver_id, 'second approver');
  if (first && first === second) fail(400, 'The first and second approver must be different people.');
  return { module, first, second };
}
function tellApprovers(req, p, f, before = {}) {
  const msg = (which) => `${req.user.name} made you the ${which} approver for "${f.module}" in ${p.name}`;
  if (f.first && f.first !== before.first_approver_id) notify([f.first], { actorId: req.user.id, projectId: p.id, reason: 'approval', message: msg('first') });
  if (f.second && f.second !== before.second_approver_id) notify([f.second], { actorId: req.user.id, projectId: p.id, reason: 'approval', message: msg('second') });
}

r.post('/projects/:pid/approvals', (req, res) => {
  const p = resolveProject(req.params.pid);
  if (!canBrief(req, p.id)) fail(403, 'You do not have permission to manage approvals in this project.');
  const f = approvalFields(req.body || {});
  if (get('SELECT id FROM project_approvals WHERE project_id = ? AND module = ? COLLATE NOCASE', p.id, f.module)) fail(400, `${f.module} already has approvers. Edit it instead.`);
  const { id } = run('INSERT INTO project_approvals(project_id, module, first_approver_id, second_approver_id, created_by) VALUES(?,?,?,?,?)',
    p.id, f.module, f.first, f.second, req.user.id);
  tellApprovers(req, p, f);
  res.status(201).json({ id });
});

function loadApproval(req) {
  const a = get('SELECT * FROM project_approvals WHERE id = ?', req.params.id) || fail(404, 'Approval not found.');
  if (!canBrief(req, a.project_id)) fail(403, 'You do not have permission to manage approvals in this project.');
  return a;
}

r.patch('/approvals/:id', (req, res) => {
  const a = loadApproval(req);
  const f = approvalFields({ module: a.module, first_approver_id: a.first_approver_id, second_approver_id: a.second_approver_id, ...req.body });
  if (get('SELECT id FROM project_approvals WHERE project_id = ? AND module = ? COLLATE NOCASE AND id <> ?', a.project_id, f.module, a.id)) fail(400, `${f.module} already has approvers.`);
  run("UPDATE project_approvals SET module = ?, first_approver_id = ?, second_approver_id = ?, updated_at = datetime('now') WHERE id = ?", f.module, f.first, f.second, a.id);
  // a new person has not approved yet
  if (f.first !== a.first_approver_id) run('UPDATE project_approvals SET first_done_at = NULL, first_done_by = NULL WHERE id = ?', a.id);
  if (f.second !== a.second_approver_id) run('UPDATE project_approvals SET second_done_at = NULL, second_done_by = NULL WHERE id = ?', a.id);
  tellApprovers(req, get('SELECT * FROM projects WHERE id = ?', a.project_id), f, a);
  res.json({ ok: true });
});

// Mark an approver's approval as done (green tick), or undo it. The approver themselves or a project lead may do this.
r.post('/approvals/:id/done', (req, res) => {
  const a = get('SELECT * FROM project_approvals WHERE id = ?', req.params.id) || fail(404, 'Approval not found.');
  const which = req.body?.which;
  if (!['first', 'second'].includes(which)) fail(400, 'Say which approver: first or second.');
  const approver = a[`${which}_approver_id`];
  if (!approver) fail(400, `Choose the ${which} approver first.`);
  if (req.user.id !== approver && !canBrief(req, a.project_id)) fail(403, `Only ${which === 'first' ? 'the first' : 'the second'} approver or a project lead can mark this done.`);
  const done = req.body?.done !== false;
  if (done) run(`UPDATE project_approvals SET ${which}_done_at = datetime('now'), ${which}_done_by = ? WHERE id = ?`, req.user.id, a.id);
  else run(`UPDATE project_approvals SET ${which}_done_at = NULL, ${which}_done_by = NULL WHERE id = ?`, a.id);
  // when the first approver is done, let the second approver know it is their turn
  if (done && which === 'first' && a.second_approver_id && !a.second_done_at && a.second_approver_id !== req.user.id) {
    const p = get('SELECT id, name FROM projects WHERE id = ?', a.project_id);
    notify([a.second_approver_id], { actorId: req.user.id, projectId: p.id, reason: 'approval', message: `"${a.module}" in ${p.name} is approved by the first approver and waits for you` });
  }
  res.json({ ok: true });
});

r.delete('/approvals/:id', (req, res) => {
  const a = loadApproval(req);
  run('DELETE FROM project_approvals WHERE id = ?', a.id);
  res.json({ ok: true });
});

// ---------- The project's document list: add, rename, remove ----------
function slotFields(b) {
  const name = String(b.name ?? '').trim();
  if (!name) fail(400, 'Enter the document name.');
  if (name.length > 150) fail(400, 'Document names must be 150 characters or fewer.');
  return { name, detail: String(b.detail ?? '').trim().slice(0, 200) || null };
}
function loadSlot(req) {
  const s = get('SELECT * FROM project_doc_slots WHERE id = ?', req.params.id) || fail(404, 'Document not found.');
  if (!canDocs(req, s.project_id)) fail(403, 'You do not have permission to change the project documents.');
  return s;
}
const nameTaken = (pid, name, exceptId = 0) => get('SELECT 1 FROM project_doc_slots WHERE project_id = ? AND name = ? COLLATE NOCASE AND id <> ?', pid, name, exceptId);

r.post('/projects/:pid/document-slots', (req, res) => {
  const p = resolveProject(req.params.pid);
  if (!canDocs(req, p.id)) fail(403, 'You do not have permission to change the project documents.');
  ensureSlots(p.id);
  const f = slotFields(req.body || {});
  if (nameTaken(p.id, f.name)) fail(400, `${f.name} is already in the list.`);
  const pos = (get('SELECT MAX(position) AS m FROM project_doc_slots WHERE project_id = ?', p.id).m ?? -1) + 1;
  const { id } = run('INSERT INTO project_doc_slots(project_id, name, detail, position) VALUES(?,?,?,?)', p.id, f.name, f.detail, pos);
  res.status(201).json({ id });
});

r.patch('/document-slots/:id', (req, res) => {
  const s = loadSlot(req);
  const f = slotFields({ name: s.name, detail: s.detail, ...req.body });
  if (nameTaken(s.project_id, f.name, s.id)) fail(400, `${f.name} is already in the list.`);
  run('UPDATE project_doc_slots SET name = ?, detail = ? WHERE id = ?', f.name, f.detail, s.id);
  res.json({ ok: true });
});

// Removes the document and every version uploaded to it.
r.delete('/document-slots/:id', (req, res) => {
  const s = loadSlot(req);
  const files = all("SELECT id, stored_name FROM attachments WHERE container_type = 'project' AND container_id = ? AND doc_slot = ?", s.project_id, String(s.id));
  tx(() => {
    run("DELETE FROM attachments WHERE container_type = 'project' AND container_id = ? AND doc_slot = ?", s.project_id, String(s.id));
    run('DELETE FROM project_doc_slots WHERE id = ?', s.id);
  });
  for (const f of files) fs.rmSync(path.join(UPLOAD_DIR, f.stored_name), { force: true });
  res.json({ ok: true, files_removed: files.length });
});

export default r;
