// Data Security checklist (45 checks, sections A–E). Each project records a status per check
// (covered / partial / missing / na), the evidence and the next step. Codes are stable: saved rows refer to them.
export const SECURITY_SECTIONS = [
  { key: 'A', name: 'Development (code)' },
  { key: 'B', name: 'Testing (before every push)' },
  { key: 'C', name: 'Deployment (server)' },
  { key: 'D', name: 'Optional but best to include' },
  { key: 'E', name: 'VAPT & compliance readiness' },
];

const c = (code, title, detail, server = false) => ({ code, section: code[0], title, detail, server });

export const SECURITY_CHECKS = [
  c('A1', 'SQL injection', 'All DB queries use parameters/ORM; no user input pasted into SQL text (search, filters, sort, raw SQL).'),
  c('A2', 'Server-side permissions', "Every route/action checks the user's role/permission on the server; hiding buttons alone doesn't count."),
  c('A3', 'BOLA / IDOR', 'Every page/API that opens a record by ID checks the user may see that record (owner, entity, partner, tenant).'),
  c('A4', 'XSS', 'No raw HTML of user input (|safe, innerHTML, dangerouslySetInnerHTML, v-html); output escaped.'),
  c('A5', 'CSRF & SSRF', 'Every POST/PUT/PATCH/DELETE checks a CSRF token (or SameSite cookies + token); any server-side fetch of a user-given URL blocks internal addresses (localhost, 10.x, 172.16–31.x, 192.168.x, 169.254.x).'),
  c('A6', 'File uploads', 'Size limit and allowed file types on every upload; clear error message when rejected.'),
  c('A7', 'API keys', 'No secret keys in templates, front-end JS, or responses sent to the browser.'),
  c('A8', 'Webhook signatures', 'Outgoing webhooks are signed; incoming webhooks are verified.'),
  c('A9', 'Password hashing', 'Passwords stored with bcrypt/argon2 (or scrypt); never plain text, never logged.'),
  c('A10', 'Secrets in config', 'JWT secret, DB password, API keys come from env/config, not hard-coded in source.'),
  c('A11', 'Login cookies', 'Auth tokens in httpOnly + Secure + SameSite cookies, not localStorage/sessionStorage.'),
  c('A12', 'Clean logs', 'No debug prints; no passwords, tokens, OTPs or full card/ID numbers written to logs.'),

  c('B1', 'Permission coverage', 'A script/test that proves every data-changing route is permission- and CSRF-checked.'),
  c('B2', 'Wrong-user access', "Tests where a low-rights user tries a higher-rights action and another user's record ID, and is refused."),
  c('B3', 'Bad upload', 'Tests for too-big and wrong-type uploads.'),
  c('B4', 'Missing CSRF token', 'Test that a form without the token is rejected.'),
  c('B5', 'Script in a text field', 'Test that <script> in user input is shown as text, not run.'),
  c('B6', 'Login rate limit', 'Failed-login lockout/throttle on every login (staff, partner, API/device keys) and a test for it.'),
  c('B7', 'Secrets in the browser', 'Check/test that no keys or tokens appear in page source or API responses.'),
  c('B8', 'Dependency scan', 'pip-audit / npm audit (or similar) is run; no open High/Critical issues.'),

  c('C1', 'SSL / HTTPS', 'HTTPS enforced; secure cookies; HSTS header behind a setting.', true),
  c('C2', 'Database login with fewer rights', "The app's DB user can't drop tables or create users.", true),
  c('C3', 'API docs off', '/docs, /swagger, /openapi.json disabled in production.', true),
  c('C4', 'CORS', 'Only our own origins allowed (no "*" with credentials).', true),
  c('C5', 'Default credentials', 'No default/test accounts active; first login forces password change.', true),
  c('C6', 'MFA for admins', 'Two-step login for admin accounts.', true),
  c('C7', 'Pinned dependencies', 'Exact versions pinned (requirements.txt / lock file).', true),
  c('C8', 'Log level', 'Production log level is not debug.', true),
  c('C9', 'Browser security policy', 'Content-Security-Policy header (report-only or enforced).', true),

  c('D1', 'MFA for admins', 'Two-step login for admin accounts.'),
  c('D2', 'Forced password change', 'New or reset accounts must set their own password at first login.'),
  c('D3', 'SSL / HTTPS', 'Site served only over HTTPS.'),
  c('D4', 'DB login with fewer rights', "The app's database user has only the rights it needs."),
  c('D5', 'Row Level Security', 'Database-level per-row access rules.'),

  c('E1', 'Security headers', 'X-Frame-Options, X-Content-Type-Options, Referrer-Policy, secure cookie flags.'),
  c('E2', 'Error pages', 'Users never see stack traces, versions or file paths.'),
  c('E3', 'Session handling', 'Idle timeout, logout really ends the session, new session ID after login.'),
  c('E4', 'Account & password rules', 'Password strength; same message for unknown user and wrong password; safe password reset.'),
  c('E5', 'Business-logic checks', 'Server re-checks prices, quantities, status changes and workflow order; never trusts browser values.'),
  c('E6', 'Network & OS hardening', 'Only 80/443 open; DB not reachable from outside; OS patched; SSH by key.', true),
  c('E7', 'Backups & encryption at rest', 'Automatic, encrypted, off-server backups, restore tested; DB disk encrypted.', true),
  c('E8', 'Audit trail', 'Who created/changed/deleted what and when is recorded.'),
  c('E9', 'Monitoring & alerts', 'Alerts for failed-login spikes, unusual exports/deletes, downtime.'),
  c('E10', 'Incident response plan', 'Written steps for a breach (who decides, block access, inform customers/authorities).'),
  c('E11', 'People & access', 'One login per person; leavers removed; server access for named people only.'),
];

export const SECURITY_STATUSES = ['covered', 'partial', 'missing', 'na'];
export const CHECK_BY_CODE = new Map(SECURITY_CHECKS.map(x => [x.code, x]));
