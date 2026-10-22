import crypto from 'node:crypto';
import { get, all, run } from './db.js';
import { ALL_GLOBAL_KEYS, ALL_PROJECT_KEYS } from './permissions.js';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const fail = (status, message) => { throw new HttpError(status, message); };

export const SESSION_COOKIE = 'pt_session';
const SESSION_DAYS = 30;

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  run(`INSERT INTO sessions(token, user_id, expires_at) VALUES(?, ?, datetime('now', '+${SESSION_DAYS} days'))`, token, userId);
  run("UPDATE users SET last_login_at = datetime('now') WHERE id = ?", userId);
  return { token, maxAge: SESSION_DAYS * 86400 * 1000 };
}

export function publicUser(u) {
  if (!u) return null;
  const { password_hash, ...rest } = u;
  return rest;
}

const parseList = (s) => { try { return JSON.parse(s || '[]'); } catch { return []; } };

// Attach req.user (or null) from the session cookie.
export function loadUser(req, _res, next) {
  req.user = null;
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) {
    const row = get(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
                     WHERE s.token = ? AND s.expires_at > datetime('now') AND u.status = 'active'`, token);
    if (row) req.user = row;
  }
  req._perm = { global: null, projects: new Map() };
  next();
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Sign in to continue.'));
  next();
}

export function globalPerms(req) {
  if (req._perm.global) return req._perm.global;
  const u = req.user;
  let set;
  if (!u) set = new Set();
  else if (u.is_admin) set = new Set([...ALL_GLOBAL_KEYS, ...ALL_PROJECT_KEYS]);
  else {
    const role = u.global_role_id ? get('SELECT permissions FROM roles WHERE id = ?', u.global_role_id) : null;
    set = new Set(parseList(role?.permissions));
  }
  req._perm.global = set;
  return set;
}

export function projectPerms(req, projectId) {
  projectId = Number(projectId);
  if (req._perm.projects.has(projectId)) return req._perm.projects.get(projectId);
  const set = new Set(globalPerms(req));
  if (req.user && !req.user.is_admin) {
    const m = get(`SELECT r.permissions FROM project_members pm JOIN roles r ON r.id = pm.role_id
                   WHERE pm.project_id = ? AND pm.user_id = ?`, projectId, req.user.id);
    if (m) {
      set.add('project.member');
      parseList(m.permissions).forEach(p => set.add(p));
    }
  } else if (req.user?.is_admin) {
    set.add('project.member');
  }
  // anyone with a project-level permission can at least see the project
  if ([...set].some(p => ALL_PROJECT_KEYS.includes(p))) set.add('project.view');
  req._perm.projects.set(projectId, set);
  return set;
}

export const can = (req, perm, projectId) =>
  projectId == null ? globalPerms(req).has(perm) : projectPerms(req, projectId).has(perm);

export function need(req, perm, projectId) {
  if (!can(req, perm, projectId)) fail(403, 'You do not have permission to do that.');
}

// Project ids the user can see with the given permission.
export function visibleProjectIds(req, perm = 'project.view', { includeArchived = false } = {}) {
  const arch = includeArchived ? '' : 'WHERE archived = 0';
  const g = globalPerms(req);
  if (req.user?.is_admin || g.has(perm) || (perm === 'project.view' && [...g].some(p => ALL_PROJECT_KEYS.includes(p)))) {
    return all(`SELECT id FROM projects ${arch}`).map(r => r.id);
  }
  const rows = all(`SELECT pm.project_id AS id, r.permissions FROM project_members pm
                    JOIN roles r ON r.id = pm.role_id JOIN projects p ON p.id = pm.project_id
                    WHERE pm.user_id = ? ${includeArchived ? '' : 'AND p.archived = 0'}`, req.user.id);
  return rows.filter(r => perm === 'project.view' || parseList(r.permissions).includes(perm)).map(r => r.id);
}

export function permsForClient(req) {
  return [...globalPerms(req)];
}

export { parseList };
