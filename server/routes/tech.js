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

// Who may do what: managing (add / edit / remove) needs tech.manage or project.edit;
// updating only the version used also works with tech.version.
const canManage = (req, pid) => can(req, 'tech.manage', pid) || can(req, 'project.edit', pid);
const canVersion = (req, pid) => canManage(req, pid) || can(req, 'tech.version', pid);
const ROWS_SQL = `SELECT t.*, vu.name AS version_updated_by_name FROM project_technologies t
                  LEFT JOIN users vu ON vu.id = t.version_updated_by`;

r.get('/projects/:pid/technologies', async (req, res, next) => {
  try {
    const p = resolveProject(req.params.pid);
    need(req, 'project.view', p.id);
    const rows = all(`${ROWS_SQL} WHERE t.project_id = ? ORDER BY t.position, t.category, t.name COLLATE NOCASE`, p.id);
    const manage = canManage(req, p.id);
    res.json({ rows: await withInfo(rows, req.query.refresh === '1'), can_edit: manage, can_manage: manage, can_version: canVersion(req, p.id) });
  } catch (e) { next(e); }
});

r.post('/projects/:pid/technologies', (req, res) => {
  const p = resolveProject(req.params.pid);
  if (!canManage(req, p.id)) fail(403, 'You do not have permission to add technologies to this project.');
  const f = fields(req.body);
  if (!f.name) fail(400, 'Technology name is required.');
  if (get('SELECT id FROM project_technologies WHERE project_id = ? AND name = ? COLLATE NOCASE', p.id, f.name)) fail(400, `${f.name} is already listed for this project.`);
  const pos = get('SELECT COALESCE(MAX(position), 0) + 1 AS n FROM project_technologies WHERE project_id = ?', p.id).n;
  const { id } = run(`INSERT INTO project_technologies(project_id, name, category, version_used, source, package_id, eol_slug, notes, position, created_by,
                      version_updated_at, version_updated_by)
                      VALUES(?,?,?,?,?,?,?,?,?,?,${f.version_used ? "datetime('now')" : 'NULL'},?)`, p.id, f.name, f.category || 'Other', f.version_used ?? null, f.source || 'none',
    f.package_id ?? null, f.eol_slug ?? null, f.notes ?? null, pos, req.user.id, f.version_used ? req.user.id : null);
  res.status(201).json({ id });
});

const loadTech = (id) => get('SELECT * FROM project_technologies WHERE id = ?', id) || fail(404, 'Technology not found.');

r.patch('/technologies/:id', (req, res) => {
  const t = loadTech(req.params.id);
  need(req, 'project.view', t.project_id);
  const f = fields(req.body);
  const keys = Object.keys(f).filter(k => f[k] !== undefined);
  const versionOnly = keys.every(k => k === 'version_used');
  if (versionOnly ? !canVersion(req, t.project_id) : !canManage(req, t.project_id)) {
    fail(403, versionOnly ? 'You do not have permission to update technology versions in this project.' : 'You can only update the version used of this technology.');
  }
  const set = keys.map(k => `${k} = ?`);
  const vals = keys.map(k => f[k]);
  if (keys.includes('version_used') && (f.version_used ?? null) !== (t.version_used ?? null)) {
    set.push("version_updated_at = datetime('now')", 'version_updated_by = ?'); vals.push(req.user.id);
  }
  if (set.length) run(`UPDATE project_technologies SET ${set.join(', ')}, updated_at = datetime('now') WHERE id = ?`, ...vals, t.id);
  res.json({ ok: true });
});

r.delete('/technologies/:id', (req, res) => {
  const t = loadTech(req.params.id);
  if (!canManage(req, t.project_id)) fail(403, 'You do not have permission to remove technologies from this project.');
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
    const rows = all(`SELECT t.*, vu.name AS version_updated_by_name, p.name AS project_name, p.identifier AS project_identifier, p.color AS project_color
                      FROM project_technologies t JOIN projects p ON p.id = t.project_id LEFT JOIN users vu ON vu.id = t.version_updated_by
                      WHERE t.project_id IN (${ids.map(() => '?').join(',')}) ORDER BY t.name COLLATE NOCASE, p.name`, ...ids)
      .map(t => ({ ...t, can_version: canVersion(req, t.project_id) }));
    res.json({ rows: await withInfo(rows, req.query.refresh === '1') });
  } catch (e) { next(e); }
});

export default r;
