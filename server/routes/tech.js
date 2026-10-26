import { Router } from 'express';
import { get, all, run } from '../db.js';
import { need, can, fail, visibleProjectIds } from '../access.js';
import { requireText } from '../util.js';
import { resolveProject } from './projects.js';
import { CATALOG, CATEGORIES, SOURCES, lookup, assess } from '../techinfo.js';

const r = Router();

r.get('/tech/catalog', (_req, res) => {
  res.json({ catalog: CATALOG, categories: CATEGORIES, sources: Object.entries(SOURCES).map(([key, s]) => ({ key, label: s.label, hint: s.hint })) });
});

function fields(b) {
  const source = b.source === undefined ? undefined : (SOURCES[b.source] ? b.source : fail(400, 'Unknown version source.'));
  const clean = (v, max = 200) => (v === undefined ? undefined : v === null ? null : String(v).trim().slice(0, max) || null);
  return {
    name: b.name !== undefined ? requireText(b.name, 'Technology name').slice(0, 120) : undefined,
    category: b.category !== undefined ? (CATEGORIES.includes(b.category) ? b.category : 'Other') : undefined,
    version_used: clean(b.version_used, 60), source, package_id: clean(b.package_id), eol_slug: clean(b.eol_slug, 80), notes: clean(b.notes, 1000),
  };
}

const withInfo = async (rows, refresh) => {
  // look up each distinct source once, a few at a time
  const keyOf = (t) => `${t.source}|${t.package_id || ''}|${t.eol_slug || ''}`;
  const unique = [...new Map(rows.map(t => [keyOf(t), t])).values()];
  const results = new Map();
  for (let i = 0; i < unique.length; i += 6) {
    const batch = unique.slice(i, i + 6);
    const infos = await Promise.all(batch.map(t => lookup(t, { refresh }).catch(e => ({ error: e.message }))));
    batch.forEach((t, j) => results.set(keyOf(t), infos[j]));
  }
  return rows.map(t => { const info = results.get(keyOf(t)) || null; return { ...t, info, assessment: assess(t.version_used, info) }; });
};

r.get('/projects/:pid/technologies', async (req, res, next) => {
  try {
    const p = resolveProject(req.params.pid);
    need(req, 'project.view', p.id);
    const rows = all('SELECT * FROM project_technologies WHERE project_id = ? ORDER BY position, category, name COLLATE NOCASE', p.id);
    res.json({ rows: await withInfo(rows, req.query.refresh === '1'), can_edit: can(req, 'project.edit', p.id) });
  } catch (e) { next(e); }
});

r.post('/projects/:pid/technologies', (req, res) => {
  const p = resolveProject(req.params.pid);
  need(req, 'project.edit', p.id);
  const f = fields(req.body);
  if (!f.name) fail(400, 'Technology name is required.');
  if (get('SELECT id FROM project_technologies WHERE project_id = ? AND name = ? COLLATE NOCASE', p.id, f.name)) fail(400, `${f.name} is already listed for this project.`);
  const pos = get('SELECT COALESCE(MAX(position), 0) + 1 AS n FROM project_technologies WHERE project_id = ?', p.id).n;
  const { id } = run(`INSERT INTO project_technologies(project_id, name, category, version_used, source, package_id, eol_slug, notes, position, created_by)
                      VALUES(?,?,?,?,?,?,?,?,?,?)`, p.id, f.name, f.category || 'Other', f.version_used ?? null, f.source || 'none',
    f.package_id ?? null, f.eol_slug ?? null, f.notes ?? null, pos, req.user.id);
  res.status(201).json({ id });
});

function loadTech(req, id) {
  const t = get('SELECT * FROM project_technologies WHERE id = ?', id) || fail(404, 'Technology not found.');
  need(req, 'project.edit', t.project_id);
  return t;
}

r.patch('/technologies/:id', (req, res) => {
  const t = loadTech(req, req.params.id);
  const f = fields(req.body);
  const keys = Object.keys(f).filter(k => f[k] !== undefined);
  if (keys.length) run(`UPDATE project_technologies SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`, ...keys.map(k => f[k]), t.id);
  res.json({ ok: true });
});

r.delete('/technologies/:id', (req, res) => {
  const t = loadTech(req, req.params.id);
  run('DELETE FROM project_technologies WHERE id = ?', t.id);
  res.json({ ok: true });
});

// Preview a lookup before saving (used by the add / edit form)
r.post('/technologies/lookup', async (req, res, next) => {
  try {
    const f = fields({ source: req.body.source || 'none', package_id: req.body.package_id, eol_slug: req.body.eol_slug, version_used: req.body.version_used });
    const info = await lookup(f, { refresh: !!req.body.refresh });
    res.json({ info, assessment: assess(f.version_used, info) });
  } catch (e) { next(e); }
});

// Company-wide view: every technology and which projects use which version
r.get('/technologies', async (req, res, next) => {
  try {
    const ids = visibleProjectIds(req, 'project.view');
    if (!ids.length) return res.json({ rows: [] });
    const rows = all(`SELECT t.*, p.name AS project_name, p.identifier AS project_identifier, p.color AS project_color
                      FROM project_technologies t JOIN projects p ON p.id = t.project_id
                      WHERE t.project_id IN (${ids.map(() => '?').join(',')}) ORDER BY t.name COLLATE NOCASE, p.name`, ...ids);
    res.json({ rows: await withInfo(rows, req.query.refresh === '1') });
  } catch (e) { next(e); }
});

export default r;
