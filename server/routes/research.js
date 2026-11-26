// Research: requirements and research, with solution and reference files, a stage (the task stages), the people
// involved (assignee, requestor, reviewer) and notes that anyone can add.
// Everyone signed in can see the list and add a requirement or a note. Changing a requirement: administrators,
// the person who added it, its assignee, requestor or reviewer. Deleting: administrators or the person who added it.
import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { get, all, run, tx, UPLOAD_DIR, maxUploadMb } from '../db.js';
import { fail } from '../access.js';
import { notify } from '../util.js';

const r = Router();
export const RESEARCH_STAGES = { new: 'New', design: 'In Design', develop: 'In Develop', testing: 'In Testing', closed: 'Closed', rejected: 'Rejected' };
const KINDS = { solution: 'Solution', reference: 'Reference' };
const FILE_TYPES = /\.(jpe?g|png|gif|webp|heic|heif|bmp|svg|pdf|zip|docx?|xlsx?|pptx?|csv|txt|md|eml|msg)$/i;
const MAX_FILES = 20; // per kind

const storage = multer.diskStorage({ destination: UPLOAD_DIR, filename: (_q, _f, cb) => cb(null, `res_${crypto.randomBytes(16).toString('hex')}`) });
const upload = (req, res, cb) => multer({ storage, limits: { fileSize: maxUploadMb() * 1024 * 1024, files: 10 } }).array('files', 10)(req, res, cb);

const SELECT = `SELECT ri.*, a.name AS assignee_name, q.name AS requestor_name, v.name AS reviewer_name, c.name AS created_by_name,
    (SELECT COUNT(*) FROM research_files f WHERE f.item_id = ri.id AND f.kind = 'solution') AS solution_files,
    (SELECT COUNT(*) FROM research_files f WHERE f.item_id = ri.id AND f.kind = 'reference') AS reference_files,
    (SELECT COUNT(*) FROM research_notes n WHERE n.item_id = ri.id) AS notes
  FROM research_items ri LEFT JOIN users a ON a.id = ri.assignee_id LEFT JOIN users q ON q.id = ri.requestor_id
  LEFT JOIN users v ON v.id = ri.reviewer_id LEFT JOIN users c ON c.id = ri.created_by`;

const load = (id) => get(`${SELECT} WHERE ri.id = ?`, Number(id)) || fail(404, 'Requirement not found.');
const canEdit = (req, it) => !!req.user.is_admin || [it.created_by, it.assignee_id, it.requestor_id, it.reviewer_id].includes(req.user.id);
const canDelete = (req, it) => !!req.user.is_admin || it.created_by === req.user.id;
const person = (v, label) => {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const u = get("SELECT id FROM users WHERE id = ? AND status = 'active'", Number(v));
  if (!u) fail(400, `${label}: choose an active person.`);
  return u.id;
};
const text = (v, label, max, required = false) => {
  if (v === undefined) return undefined;
  const s = String(v ?? '').trim();
  if (required && !s) fail(400, `${label} is required.`);
  if (s.length > max) fail(400, `${label} is too long (at most ${max} characters).`);
  return s || null;
};
const stage = (v) => {
  if (v === undefined) return undefined;
  if (!RESEARCH_STAGES[v]) fail(400, 'Choose a stage.');
  return v;
};
const link = (id) => `/research?item=${id}`;
function tell(req, it, ids, message, reason = 'research') {
  notify(ids, { actorId: req.user.id, link: link(it.id), reason, message });
}
const decorate = (req, it) => ({ ...it, code: `R-${it.id}`, stage_name: RESEARCH_STAGES[it.stage] || it.stage, can_edit: canEdit(req, it), can_delete: canDelete(req, it) });

r.get('/research', (req, res) => {
  const q = req.query;
  const where = ['1 = 1']; const params = [];
  if (q.stage && RESEARCH_STAGES[q.stage]) { where.push('ri.stage = ?'); params.push(q.stage); }
  if (q.open === '1') where.push("ri.stage NOT IN ('closed', 'rejected')");
  for (const k of ['assignee_id', 'requestor_id', 'reviewer_id']) {
    if (q[k] === 'me') { where.push(`ri.${k} = ?`); params.push(req.user.id); }
    else if (q[k] === 'none') where.push(`ri.${k} IS NULL`);
    else if (/^\d+$/.test(q[k] || '')) { where.push(`ri.${k} = ?`); params.push(Number(q[k])); }
  }
  if (q.q) {
    const like = `%${String(q.q).trim().toLowerCase()}%`;
    where.push("(lower(ri.title) LIKE ? OR lower(COALESCE(ri.description, '')) LIKE ? OR ('r-' || ri.id) = ?)");
    params.push(like, like, String(q.q).trim().toLowerCase());
  }
  res.json({ stages: RESEARCH_STAGES, items: all(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY ri.updated_at DESC, ri.id DESC LIMIT 1000`, ...params).map(it => decorate(req, it)) });
});

r.get('/research/:id', (req, res) => {
  const it = load(req.params.id);
  res.json({
    ...decorate(req, it),
    files: all(`SELECT f.id, f.kind, f.filename, f.content_type, f.size, f.created_at, f.uploaded_by, u.name AS uploaded_by_name
                FROM research_files f LEFT JOIN users u ON u.id = f.uploaded_by WHERE f.item_id = ? ORDER BY f.id`, it.id)
      .map(f => ({ ...f, can_delete: canEdit(req, it) || f.uploaded_by === req.user.id })),
    notes_list: all(`SELECT n.id, n.body, n.created_at, n.user_id, u.name AS user_name FROM research_notes n LEFT JOIN users u ON u.id = n.user_id
                     WHERE n.item_id = ? ORDER BY n.id`, it.id).map(n => ({ ...n, can_delete: !!req.user.is_admin || n.user_id === req.user.id })),
  });
});

r.post('/research', (req, res) => {
  const b = req.body || {};
  const f = {
    title: text(b.title, 'Requirement title', 200, true), description: text(b.description ?? '', 'Requirement description', 20000),
    stage: stage(b.stage || 'new'), assignee_id: person(b.assignee_id ?? null, 'Assignee'),
    requestor_id: person(b.requestor_id ?? req.user.id, 'Requestor'), reviewer_id: person(b.reviewer_id ?? null, 'Reviewer'),
  };
  const now = new Date().toISOString();
  const { id } = run(`INSERT INTO research_items(title, description, stage, assignee_id, requestor_id, reviewer_id, created_by, created_at, updated_at)
                      VALUES(?,?,?,?,?,?,?,?,?)`, f.title, f.description, f.stage, f.assignee_id, f.requestor_id, f.reviewer_id, req.user.id, now, now);
  const it = load(id);
  tell(req, it, [it.assignee_id], `${req.user.name} assigned you the requirement R-${id}: ${it.title}`);
  tell(req, it, [it.reviewer_id], `${req.user.name} made you the reviewer of R-${id}: ${it.title}`);
  res.status(201).json(decorate(req, it));
});

r.patch('/research/:id', (req, res) => {
  const it = load(req.params.id);
  if (!canEdit(req, it)) fail(403, 'Only the people on this requirement (or an administrator) can change it.');
  const b = req.body || {};
  const f = {
    title: text(b.title, 'Requirement title', 200, true), description: b.description === undefined ? undefined : text(b.description, 'Requirement description', 20000),
    stage: stage(b.stage), assignee_id: person(b.assignee_id, 'Assignee'), requestor_id: person(b.requestor_id, 'Requestor'), reviewer_id: person(b.reviewer_id, 'Reviewer'),
  };
  const keys = Object.keys(f).filter(k => f[k] !== undefined);
  if (!keys.length) return res.json(decorate(req, it));
  run(`UPDATE research_items SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...keys.map(k => f[k]), new Date().toISOString(), it.id);
  const now = load(it.id);
  if (f.assignee_id && f.assignee_id !== it.assignee_id) tell(req, now, [f.assignee_id], `${req.user.name} assigned you the requirement R-${it.id}: ${now.title}`);
  if (f.reviewer_id && f.reviewer_id !== it.reviewer_id) tell(req, now, [f.reviewer_id], `${req.user.name} made you the reviewer of R-${it.id}: ${now.title}`);
  if (f.stage && f.stage !== it.stage) tell(req, now, [now.assignee_id, now.requestor_id, now.reviewer_id, now.created_by], `${req.user.name} moved R-${it.id} to ${RESEARCH_STAGES[f.stage]}: ${now.title}`);
  res.json(decorate(req, now));
});

r.delete('/research/:id', (req, res) => {
  const it = load(req.params.id);
  if (!canDelete(req, it)) fail(403, 'Only the person who added it, or an administrator, can delete this requirement.');
  const files = all('SELECT stored_name FROM research_files WHERE item_id = ?', it.id);
  tx(() => run('DELETE FROM research_items WHERE id = ?', it.id));
  for (const x of files) fs.rmSync(path.join(UPLOAD_DIR, path.basename(x.stored_name)), { force: true });
  res.json({ ok: true });
});

// Files: kind = solution | reference; up to 10 per upload
r.post('/research/:id/files', (req, res, next) => {
  upload(req, res, (err) => {
    const cleanup = () => (req.files || []).forEach(f => fs.rmSync(f.path, { force: true }));
    if (err) { cleanup(); return next(Object.assign(new Error(err.code === 'LIMIT_FILE_SIZE' ? `Files must be ${maxUploadMb()} MB or smaller.` : err.code === 'LIMIT_FILE_COUNT' ? 'Up to 10 files at a time.' : err.message), { status: 400 })); }
    try {
      const it = load(req.params.id);
      const kind = String(req.body?.kind || '');
      if (!KINDS[kind]) fail(400, 'Choose Solution or Reference files.');
      if (!(req.files || []).length) fail(400, 'Choose a file to upload.');
      if (!canEdit(req, it)) fail(403, 'Only the people on this requirement (or an administrator) can add files.');
      const names = req.files.map(f => Buffer.from(f.originalname, 'latin1').toString('utf8'));
      const bad = names.find(n => !FILE_TYPES.test(n));
      if (bad) fail(400, `${bad}: only images, PDF, Office files (Word, Excel, PowerPoint), CSV, text, email and ZIP files can be added.`);
      const have = get('SELECT COUNT(*) AS n FROM research_files WHERE item_id = ? AND kind = ?', it.id, kind).n;
      if (have + names.length > MAX_FILES) fail(400, `A requirement can have at most ${MAX_FILES} ${KINDS[kind].toLowerCase()} files.`);
      const now = new Date().toISOString();
      tx(() => {
        req.files.forEach((f, i) => run(`INSERT INTO research_files(item_id, kind, filename, stored_name, content_type, size, uploaded_by, created_at) VALUES(?,?,?,?,?,?,?,?)`,
          it.id, kind, names[i], f.filename, f.mimetype, f.size, req.user.id, now));
        run('UPDATE research_items SET updated_at = ? WHERE id = ?', now, it.id);
      });
      res.status(201).json({ ok: true, added: names.length });
    } catch (e) { cleanup(); next(e); }
  });
});

r.get('/research-files/:id/download', (req, res) => {
  const f = get('SELECT * FROM research_files WHERE id = ?', Number(req.params.id)) || fail(404, 'File not found.');
  const file = path.join(UPLOAD_DIR, path.basename(f.stored_name));
  if (!fs.existsSync(file)) fail(404, 'The file is missing from the server.');
  const inline = req.query.inline === '1' && /^(image\/(png|jpe?g|gif|webp)|application\/pdf|text\/plain)$/.test(f.content_type || '');
  res.setHeader('Content-Type', inline ? f.content_type : 'application/octet-stream');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.filename)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  fs.createReadStream(file).pipe(res);
});

r.delete('/research-files/:id', (req, res) => {
  const f = get('SELECT * FROM research_files WHERE id = ?', Number(req.params.id)) || fail(404, 'File not found.');
  const it = load(f.item_id);
  if (!(canEdit(req, it) || f.uploaded_by === req.user.id)) fail(403, 'You cannot remove this file.');
  run('DELETE FROM research_files WHERE id = ?', f.id);
  fs.rmSync(path.join(UPLOAD_DIR, path.basename(f.stored_name)), { force: true });
  res.json({ ok: true });
});

// Notes: anyone signed in can add one; the author (or an administrator) can delete it.
r.post('/research/:id/notes', (req, res) => {
  const it = load(req.params.id);
  const body = text(req.body?.body, 'Note', 5000, true);
  const now = new Date().toISOString();
  const { id } = run('INSERT INTO research_notes(item_id, user_id, body, created_at) VALUES(?,?,?,?)', it.id, req.user.id, body, now);
  run('UPDATE research_items SET updated_at = ? WHERE id = ?', now, it.id);
  tell(req, it, [it.assignee_id, it.requestor_id, it.reviewer_id, it.created_by], `${req.user.name} added a note on R-${it.id}: ${it.title}`, 'research_note');
  res.status(201).json({ id });
});
r.delete('/research-notes/:id', (req, res) => {
  const n = get('SELECT * FROM research_notes WHERE id = ?', Number(req.params.id)) || fail(404, 'Note not found.');
  if (!(req.user.is_admin || n.user_id === req.user.id)) fail(403, 'Only the person who wrote the note (or an administrator) can delete it.');
  run('DELETE FROM research_notes WHERE id = ?', n.id);
  res.json({ ok: true });
});

export default r;
