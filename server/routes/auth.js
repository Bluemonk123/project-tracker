import { Router } from 'express';
import { get, run, all, hashPassword, verifyPassword, getSetting, DATA_DIR } from '../db.js';
import { createSession, SESSION_COOKIE, publicUser, requireAuth, fail, permsForClient, can } from '../access.js';
import { requireText } from '../util.js';

const r = Router();

// secure: sent only over HTTPS when the site is served over HTTPS (behind a proxy, set TRUST_PROXY so this is known)
const cookieOpts = (maxAge, req) => ({ httpOnly: true, sameSite: 'lax', maxAge, path: '/', secure: !!req?.secure });

// Wrong passwords: at most 10 per account per address and 30 per address in 15 minutes.
const failures = new Map();
const WINDOW = 15 * 60e3;
function recent(key) { const now = Date.now(); const l = (failures.get(key) || []).filter(t => now - t < WINDOW); failures.set(key, l); return l; }
function checkLoginLimit(ip, email) {
  if (recent(`ip:${ip}`).length >= 30 || recent(`acc:${ip}:${email}`).length >= 10) fail(429, 'Too many wrong passwords. Wait 15 minutes and try again.');
}
function noteFailure(ip, email) {
  const now = Date.now();
  recent(`ip:${ip}`).push(now); recent(`acc:${ip}:${email}`).push(now);
  if (failures.size > 5000) for (const [k, l] of failures) if (!l.some(t => now - t < WINDOW)) failures.delete(k);
}
export function resetLoginLimits() { failures.clear(); }
const MIN_PW = 8;

function checkPassword(pw) {
  if (String(pw || '').length < MIN_PW) fail(400, `Password must be at least ${MIN_PW} characters.`);
}

r.get('/setup-status', (_req, res) => {
  const count = get('SELECT COUNT(*) AS n FROM users').n;
  // On a new install (no accounts, so nothing to protect) show where the data lives: a wrong DATA_DIR is easy to spot.
  res.json({ needsSetup: count === 0, appName: getSetting('app_name', 'Project Tracker'), ...(count === 0 ? { dataDir: DATA_DIR } : {}) });
});

// First run: create the administrator account.
r.post('/setup', (req, res) => {
  if (get('SELECT COUNT(*) AS n FROM users').n > 0) fail(400, 'Setup is already complete.');
  const name = requireText(req.body.name, 'Name');
  const email = requireText(req.body.email, 'Email').toLowerCase();
  checkPassword(req.body.password);
  const managerRole = get("SELECT id FROM roles WHERE scope='global' AND name='Manager'");
  const { id } = run('INSERT INTO users(name, email, password_hash, is_admin, global_role_id, job_title) VALUES(?,?,?,?,?,?)',
    name, email, hashPassword(req.body.password), 1, managerRole?.id, req.body.job_title || 'Administrator');
  if (req.body.app_name) run("UPDATE settings SET value = ? WHERE key = 'app_name'", String(req.body.app_name).trim());
  const s = createSession(id);
  res.cookie(SESSION_COOKIE, s.token, cookieOpts(s.maxAge, req));
  res.json({ ok: true });
});

r.post('/auth/login', (req, res) => {
  const email = String(req.body.email || '').trim();
  const ip = req.ip || '';
  checkLoginLimit(ip, email.toLowerCase());
  const user = get('SELECT * FROM users WHERE email = ?', email);
  if (!user || !verifyPassword(String(req.body.password || ''), user.password_hash)) { noteFailure(ip, email.toLowerCase()); fail(401, 'Email or password is incorrect.'); }
  if (user.status !== 'active') fail(403, 'This account is locked. Ask an administrator to unlock it.');
  const s = createSession(user.id);
  res.cookie(SESSION_COOKIE, s.token, cookieOpts(s.maxAge, req));
  res.json({ ok: true });
});

r.post('/auth/logout', (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) run('DELETE FROM sessions WHERE token = ?', token);
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ ok: true });
});

r.get('/auth/me', requireAuth, (req, res) => {
  const role = req.user.global_role_id ? get('SELECT id, name FROM roles WHERE id = ?', req.user.global_role_id) : null;
  const unread = get('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', req.user.id).n;
  res.json({
    user: { ...publicUser(req.user), global_role: role },
    permissions: permsForClient(req),
    canSeeReports: can(req, 'reports.view'),
    unread,
    appName: getSetting('app_name', 'Project Tracker'),
  });
});

r.post('/auth/password', requireAuth, (req, res) => {
  if (!verifyPassword(String(req.body.current || ''), req.user.password_hash)) fail(400, 'Current password is incorrect.');
  checkPassword(req.body.password);
  run('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', hashPassword(req.body.password), req.user.id);
  // sign out other devices
  run('DELETE FROM sessions WHERE user_id = ? AND token <> ?', req.user.id, req.cookies[SESSION_COOKIE]);
  res.json({ ok: true });
});

r.patch('/auth/profile', requireAuth, (req, res) => {
  const name = requireText(req.body.name ?? req.user.name, 'Name');
  run('UPDATE users SET name = ?, job_title = ? WHERE id = ?', name, req.body.job_title ?? req.user.job_title, req.user.id);
  res.json({ ok: true });
});

// Light user directory for pickers (assignee, participants, mentions)
r.get('/users', requireAuth, (_req, res) => {
  res.json(all(`SELECT id, name, email, job_title, status FROM users ORDER BY status = 'locked', name`));
});

export default r;
