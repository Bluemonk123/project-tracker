import { Router } from 'express';
import { imapConfig } from '../inbound.js';
import { get, run, all, hashPassword, verifyPassword, getSetting, DATA_DIR } from '../db.js';
import { createSession, SESSION_COOKIE, publicUser, requireAuth, fail, permsForClient, can, visibleProjectIds, personRoles } from '../access.js';
import { requireText, notify } from '../util.js';

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
  // the support mailbox (Administration → Email Setup → Incoming email), shown on the sign-in page
  const i = imapConfig();
  const supportEmail = i.enabled && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(i.user || '') ? i.user : null;
  res.json({ needsSetup: count === 0, appName: getSetting('app_name', 'Project Tracker'), supportEmail, ...(count === 0 ? { dataDir: DATA_DIR } : {}) });
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

// Two-step sign-in. Step 1: the email decides what comes next.
//  - a NEW account (no password of its own yet: none set, or only the administrator's temporary one) → "set password"
//  - everything else, unknown emails included (so the answer does not reveal who has an account) → "password"
const isNewAccount = (u) => !!u && u.status === 'active' && (!u.password_hash || !!u.must_change_password);
r.post('/auth/lookup', (req, res) => {
  const email = String(req.body.email || '').trim();
  const ip = req.ip || '';
  checkLoginLimit(ip, email.toLowerCase());
  const u = email ? get('SELECT id, status, password_hash, must_change_password FROM users WHERE email = ? COLLATE NOCASE', email) : null;
  res.json({ next: isNewAccount(u) ? 'set_password' : 'password' });
});

// Step 2 for a new account: choose a password and sign in. No other check (the administrators' choice); every use is
// written to the audit log and every administrator is notified, so a wrong person setting it is noticed at once.
r.post('/auth/first-password', (req, res) => {
  const email = String(req.body.email || '').trim();
  const ip = req.ip || '';
  checkLoginLimit(ip, email.toLowerCase());
  const u = get('SELECT * FROM users WHERE email = ? COLLATE NOCASE', email);
  if (!isNewAccount(u)) { noteFailure(ip, email.toLowerCase()); fail(400, 'This account already has a password. Sign in with it, or ask an administrator to reset it.'); }
  checkPassword(req.body.password);
  if (u.password_hash && verifyPassword(String(req.body.password), u.password_hash)) fail(400, 'Choose a new password, not the temporary one.');
  run('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', hashPassword(req.body.password), u.id);
  run('DELETE FROM sessions WHERE user_id = ?', u.id);
  try { run('INSERT INTO audit_log(actor_id, action, entity_type, entity_id, details, ip) VALUES(?,?,?,?,?,?)', u.id, 'PASSWORD_SET_FIRST_SIGNIN', 'user', u.id, JSON.stringify({ email: u.email }), ip); } catch { /* audit table missing: ignore */ }
  const admins = all("SELECT id FROM users WHERE is_admin = 1 AND status = 'active'").map(x => x.id);
  notify(admins, { actorId: u.id, link: '/admin', reason: 'account_activated',
    message: `${u.name} (${u.email}) set a password and signed in for the first time${ip ? ` from ${ip}` : ''}. If this was not them, lock the account in Administration → Users.` });
  const s = createSession(u.id);
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
  const roles = personRoles(req.user).map(r => r.name);
  const unread = get('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', req.user.id).n;
  res.json({
    user: { ...publicUser(req.user), roles },
    permissions: permsForClient(req),
    canSeeReports: can(req, 'reports.view'),
    canSeeBoard: !!req.user.is_admin || visibleProjectIds(req, 'board.view').length > 0,
    canUploadTasks: !!req.user.is_admin || visibleProjectIds(req, 'wp.import').length > 0,
    // sidebar: tasks pages (Sprint Planning, Task Board, All tasks, Teams) need "View tasks" in at least one project
    canSeeTasks: !!req.user.is_admin || visibleProjectIds(req, 'wp.view').length > 0,
    unread,
    appName: getSetting('app_name', 'Project Tracker'),
  });
});

r.post('/auth/password', requireAuth, (req, res) => {
  // First sign-in with the password an administrator set: the person just proved it by signing in, so only the new
  // password is asked (and it must differ from the temporary one). Any later change asks for the current password.
  const first = !!req.user.must_change_password;
  if (!first && !verifyPassword(String(req.body.current || ''), req.user.password_hash)) fail(400, 'Current password is incorrect.');
  checkPassword(req.body.password);
  if (first && verifyPassword(String(req.body.password), req.user.password_hash)) fail(400, 'Choose a new password, not the one the administrator gave you.');
  run('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', hashPassword(req.body.password), req.user.id);
  // sign out other devices
  run('DELETE FROM sessions WHERE user_id = ? AND token <> ?', req.user.id, req.cookies[SESSION_COOKIE]);
  res.json({ ok: true });
});

r.patch('/auth/profile', requireAuth, (req, res) => {
  const name = requireText(req.body.name ?? req.user.name, 'Name');
  run('UPDATE users SET name = ?, job_title = ?, email_notify = ? WHERE id = ?', name, req.body.job_title ?? req.user.job_title,
    'email_notify' in req.body ? (req.body.email_notify ? 1 : 0) : (req.user.email_notify ?? 1), req.user.id);
  res.json({ ok: true });
});

// Light user directory for pickers (assignee, participants, mentions)
r.get('/users', requireAuth, (_req, res) => {
  res.json(all(`SELECT id, name, email, job_title, status FROM users ORDER BY status = 'locked', name`));
});

export default r;
