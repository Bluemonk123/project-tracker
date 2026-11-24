// Project → Data Security: the 45-point checklist with a status, evidence and next step per check.
// View: anyone who can see the project. Change: "Update data security checks" (security.manage) or "Edit project".
import { Router } from 'express';
import { get, all, run, tx, getSetting, setSetting } from '../db.js';
import { scanWebsite, scanRepo, parseRepo } from '../securityScan.js';
import { need, can, fail } from '../access.js';
import { resolveProject } from './projects.js';
import { SECURITY_SECTIONS, SECURITY_CHECKS, SECURITY_STATUSES, CHECK_BY_CODE } from '../securityChecklist.js';

const r = Router();
const canEdit = (req, pid) => can(req, 'security.manage', pid) || can(req, 'project.edit', pid);
const text = (v, max) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };

function statusOf(v) {
  if (v === null || v === undefined || v === '' || v === 'none') return null;
  const s = String(v).toLowerCase();
  if (!SECURITY_STATUSES.includes(s)) fail(400, 'Status must be Covered, Partial, Not covered or Not applicable.');
  return s;
}

function summary(rows) {
  const by = new Map(rows.map(x => [x.code, x]));
  const checks = SECURITY_CHECKS.map(ch => {
    const x = by.get(ch.code);
    return { ...ch, status: x?.status ?? null, evidence: x?.evidence ?? null, next_step: x?.next_step ?? null,
      updated_at: x?.updated_at ?? null, updated_by_name: x?.updated_by_name ?? null };
  });
  const count = (list) => {
    const o = { covered: 0, partial: 0, missing: 0, na: 0, open: 0, total: list.length };
    for (const ch of list) { if (ch.status) o[ch.status]++; else o.open++; }
    return o;
  };
  const sections = SECURITY_SECTIONS.map(s => ({ ...s, counts: count(checks.filter(ch => ch.section === s.key)) }));
  // Top fixes: not covered before partial, then checklist order (code and data risks first)
  const rank = { missing: 0, partial: 1 };
  const top = checks.filter(ch => ch.status === 'missing' || ch.status === 'partial')
    .sort((a, b) => rank[a.status] - rank[b.status]).slice(0, 5).map(ch => ch.code);
  const last = rows.reduce((m, x) => (x.updated_at && (!m || x.updated_at > m.updated_at) ? x : m), null);
  return { checks, sections, totals: count(checks), top, last_updated_at: last?.updated_at ?? null, last_updated_by: last?.updated_by_name ?? null };
}

const loadRows = (pid) => all(`SELECT c.*, u.name AS updated_by_name FROM project_security_checks c LEFT JOIN users u ON u.id = c.updated_by
                               WHERE c.project_id = ?`, pid);

function save(req, pid, code, b, source) {
  const ch = CHECK_BY_CODE.get(String(code || '').toUpperCase()) || fail(404, `There is no check "${code}".`);
  const prev = get('SELECT * FROM project_security_checks WHERE project_id = ? AND code = ?', pid, ch.code);
  const next = {
    status: 'status' in b ? statusOf(b.status) : prev?.status ?? null,
    evidence: 'evidence' in b ? text(b.evidence, 4000) : prev?.evidence ?? null,
    next_step: 'next_step' in b ? text(b.next_step, 4000) : prev?.next_step ?? null,
  };
  if (prev && prev.status === next.status && prev.evidence === next.evidence && prev.next_step === next.next_step) return false;
  if (!prev && !next.status && !next.evidence && !next.next_step) return false;
  run(`INSERT INTO project_security_checks(project_id, code, status, evidence, next_step, updated_by, updated_at)
       VALUES(?,?,?,?,?,?,datetime('now'))
       ON CONFLICT(project_id, code) DO UPDATE SET status = excluded.status, evidence = excluded.evidence, next_step = excluded.next_step,
         updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  pid, ch.code, next.status, next.evidence, next.next_step, req.user.id);
  const changed = ['evidence', 'next_step'].filter(k => (prev?.[k] ?? null) !== next[k]);
  run(`INSERT INTO project_security_log(project_id, code, status_from, status_to, changed, source, user_id) VALUES(?,?,?,?,?,?,?)`,
    pid, ch.code, prev?.status ?? null, next.status, changed.join(',') || null, source || null, req.user.id);
  return true;
}

r.get('/projects/:pid/security', (req, res) => {
  const p = resolveProject(req.params.pid);
  need(req, 'project.view', p.id);
  res.json({ ...summary(loadRows(p.id)), can_edit: canEdit(req, p.id) });
});

r.put('/projects/:pid/security/:code', (req, res) => {
  const p = resolveProject(req.params.pid);
  if (!canEdit(req, p.id)) fail(403, 'You need "Update data security checks" or "Edit project" in this project.');
  save(req, p.id, req.params.code, req.body || {}, 'edit');
  res.json({ ...summary(loadRows(p.id)), can_edit: true });
});

// Several checks at once: an audit report pasted in (Import report) — only the checks it names change.
r.post('/projects/:pid/security/import', (req, res) => {
  const p = resolveProject(req.params.pid);
  if (!canEdit(req, p.id)) fail(403, 'You need "Update data security checks" or "Edit project" in this project.');
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) fail(400, 'No checks found in the report.');
  if (items.length > 200) fail(400, 'Too many rows.');
  const unknown = items.filter(x => !CHECK_BY_CODE.has(String(x?.code || '').toUpperCase())).map(x => x?.code);
  if (unknown.length) fail(400, `Unknown checks: ${unknown.slice(0, 5).join(', ')}.`);
  let changed = 0;
  const source = req.body?.source === 'auto' ? 'auto' : 'import';
  tx(() => { for (const x of items) if (save(req, p.id, x.code, x, source)) changed++; });
  res.json({ ...summary(loadRows(p.id)), can_edit: true, changed });
});

r.get('/projects/:pid/security/:code/history', (req, res) => {
  const p = resolveProject(req.params.pid);
  need(req, 'project.view', p.id);
  const code = String(req.params.code).toUpperCase();
  if (!CHECK_BY_CODE.has(code)) fail(404, 'Check not found.');
  res.json(all(`SELECT l.status_from, l.status_to, l.changed, l.source, l.created_at, u.name AS user_name FROM project_security_log l
                LEFT JOIN users u ON u.id = l.user_id WHERE l.project_id = ? AND l.code = ? ORDER BY l.id DESC LIMIT 50`, p.id, code));
});

// Check now: scan the live website (Hosting link) and the code (Code repository link). Nothing is saved here:
// the person sees the findings next to the current values and applies them (POST .../import with source "auto").
const running = new Set();
r.post('/projects/:pid/security/check', async (req, res) => {
  const p = resolveProject(req.params.pid);
  if (!canEdit(req, p.id)) fail(403, 'You need "Update data security checks" or "Edit project" in this project.');
  if (running.has(p.id)) fail(409, 'A check is already running for this project.');
  let board = {}; try { board = JSON.parse(get('SELECT board_data FROM projects WHERE id = ?', p.id)?.board_data || '{}') || {}; } catch { /* none */ }
  const site = String(req.body?.website ?? board.hosting?.production ?? board.hosting?.staging ?? '').trim() || board.hosting?.staging || '';
  const repo = String(req.body?.repository ?? '').trim() || [board.repository?.production, board.repository?.staging].find(x => parseRepo(x)) || '';
  const want = { website: req.body?.scan_website !== false, code: req.body?.scan_code !== false };
  running.add(p.id);
  try {
    const [website, code] = await Promise.all([
      !want.website ? null : site ? scanWebsite(site).catch(e => ({ target: site, error: e.message })) : { error: 'No live address: add the production link under Hosting in the Technologies card.' },
      !want.code ? null : repo ? scanRepo(repo, getSetting('github_token', '')).catch(e => ({ target: repo, error: e.message })) : { error: 'No GitHub link: add it under Code repository in the Technologies card.' },
    ]);
    const items = [...(website?.results || []), ...(code?.results || [])];
    res.json({ website, code, items, checked_at: new Date().toISOString() });
  } finally { running.delete(p.id); }
});

// GitHub access token for private repositories (administrators; never sent back to the browser)
r.get('/admin/github-token', (req, res) => {
  if (!req.user.is_admin) fail(403, 'Administrators only.');
  res.json({ has_token: !!getSetting('github_token', '') });
});
r.put('/admin/github-token', (req, res) => {
  if (!req.user.is_admin) fail(403, 'Administrators only.');
  const t = String(req.body?.token ?? '').trim();
  if (t && !/^(gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}$/.test(t)) fail(400, 'That does not look like a GitHub token (it starts with github_pat_ or ghp_).');
  setSetting('github_token', t);
  res.json({ has_token: !!t });
});

const LABEL = { covered: 'Covered', partial: 'Partial', missing: 'Not covered', na: 'Not applicable' };
r.get('/projects/:pid/security.csv', (req, res) => {
  const p = resolveProject(req.params.pid);
  need(req, 'project.view', p.id);
  // (cells starting with = + - @ are prefixed so spreadsheets do not run them as formulas)
  const esc = (v) => { let s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const sec = new Map(SECURITY_SECTIONS.map(s => [s.key, s.name]));
  const { checks } = summary(loadRows(p.id));
  const head = ['#', 'Section', 'Check', 'What it means', 'Server', 'Status', 'Evidence', "What's missing / next step", 'Updated', 'Updated by'];
  const lines = checks.map(ch => [ch.code, `${ch.section}. ${sec.get(ch.section)}`, ch.title, ch.detail, ch.server ? 'Yes' : '', LABEL[ch.status] || 'Not checked',
    ch.evidence, ch.next_step, ch.updated_at, ch.updated_by_name].map(esc).join(','));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${p.identifier}-data-security.csv"`);
  res.send('﻿' + [head.join(','), ...lines].join('\r\n'));
});

export default r;
