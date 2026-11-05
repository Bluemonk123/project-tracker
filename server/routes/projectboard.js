// Project Board: one page per project with its brief, customer, customer user roles, team,
// and the seven standard project documents (each uploaded as new versions, the latest shown).
import { Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import multer from 'multer';
import { get, all, run, tx, UPLOAD_DIR } from '../db.js';
import { need, can, fail } from '../access.js';
import { resolveProject, listMembers } from './projects.js';
import { positionsFor } from '../positions.js';

export const DOC_SLOTS = [
  { key: '01', name: 'Product Overview' },
  { key: '02', name: 'Business Requirements', detail: 'BRD, with Business Rules & SOPs' },
  { key: '03', name: 'Personas & Journeys' },
  { key: '04', name: 'Permission & Security Rules' },
  { key: '05', name: 'Technical Architecture' },
  { key: '06', name: 'UAT & Disaster Recovery' },
  { key: '07', name: 'Design System' },
];
const SLOT_KEYS = new Set(DOC_SLOTS.map(s => s.key));

const canBrief = (req, pid) => can(req, 'project.edit', pid) || can(req, 'project.brief', pid);
const canDocs = (req, pid) => can(req, 'project.edit', pid) || can(req, 'project.documents', pid);

const MAX_MB = Number(process.env.MAX_UPLOAD_MB || 25);
const upload = multer({
  storage: multer.diskStorage({ destination: UPLOAD_DIR, filename: (_q, _f, cb) => cb(null, crypto.randomBytes(16).toString('hex')) }),
  limits: { fileSize: MAX_MB * 1024 * 1024 },
});

const r = Router();

r.get('/projects/:pid/board-info', (req, res) => {
  const p = resolveProject(req.params.pid);
  need(req, 'project.view', p.id);
  const roles = all('SELECT id, name, description FROM project_customer_roles WHERE project_id = ? ORDER BY position, id', p.id);
  const files = all(`SELECT a.id, a.doc_slot, a.filename, a.size, a.content_type, a.created_at, a.uploaded_by, u.name AS uploaded_by_name
                     FROM attachments a LEFT JOIN users u ON u.id = a.uploaded_by
                     WHERE a.container_type = 'project' AND a.container_id = ? AND a.doc_slot IS NOT NULL
                     ORDER BY a.created_at DESC, a.id DESC`, p.id);
  const documents = DOC_SLOTS.map(s => {
    const versions = files.filter(f => f.doc_slot === s.key);
    return { ...s, latest: versions[0] || null, versions };
  });
  res.json({
    project: { id: p.id, name: p.name, identifier: p.identifier, color: p.color, status: p.status, description: p.description,
      customer_name: p.customer_name, start_date: p.start_date, end_date: p.end_date },
    customer_roles: roles,
    positions: positionsFor([p.id]).get(p.id),
    members: listMembers(p.id).filter(m => m.status !== 'locked'),
    documents,
    max_mb: MAX_MB,
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
  tx(() => {
    if (b.description !== undefined || b.customer_name !== undefined) {
      run(`UPDATE projects SET description = COALESCE(?, description), customer_name = COALESCE(?, customer_name), updated_at = datetime('now') WHERE id = ?`,
        b.description === undefined ? null : String(b.description ?? ''),
        b.customer_name === undefined ? null : String(b.customer_name ?? '').trim().slice(0, 200), p.id);
    }
    if (roles) {
      run('DELETE FROM project_customer_roles WHERE project_id = ?', p.id);
      roles.forEach((x, i) => {
        const name = String(x?.name || '').trim();
        if (name) run('INSERT INTO project_customer_roles(project_id, name, description, position) VALUES(?,?,?,?)',
          p.id, name, String(x.description || '').trim().slice(0, 500) || null, i);
      });
    }
  });
  res.json({ ok: true });
});

// Upload a new version of one of the seven documents.
r.post('/projects/:pid/documents/:slot', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    try {
      if (err) fail(400, err.code === 'LIMIT_FILE_SIZE' ? `Files must be ${MAX_MB} MB or smaller.` : err.message);
      if (!req.file) fail(400, 'Choose a file to upload.');
      try {
        const p = resolveProject(req.params.pid);
        if (!SLOT_KEYS.has(req.params.slot)) fail(404, 'Unknown document.');
        if (!canDocs(req, p.id)) fail(403, 'You do not have permission to upload project documents.');
        const name = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
        const { id } = run(`INSERT INTO attachments(container_type, container_id, project_id, filename, stored_name, content_type, size, uploaded_by, doc_slot)
                            VALUES('project',?,?,?,?,?,?,?,?)`, p.id, p.id, name, req.file.filename, req.file.mimetype, req.file.size, req.user.id, req.params.slot);
        res.status(201).json({ id, filename: name });
      } catch (e) { fs.rmSync(req.file.path, { force: true }); throw e; }
    } catch (e) { next(e); }
  });
});

export default r;
