// "Check now" on Project → Data Security. Two automatic scans; results are proposals the person reviews and applies.
//  Website (8 checks: C1 D3 E1 C9 A11 C3 C4 E2): reads the project's live address like a visitor. Only GET requests,
//    no sign-in. Addresses inside private networks are refused (SSRF protection), also after redirects.
//  Code (8 checks: A1 A4 A7 A9 A10 A12 C7 B8): downloads the GitHub repository (zip) and looks for known red flags;
//    package versions are checked against public security advisories (npm, OSV).
import dns from 'node:dns/promises';
import net from 'node:net';
import { unzipBuffer } from './archive.js';

const UA = 'ProjectTracker-SecurityCheck/1.0';
const TIMEOUT = 12_000;
const today = () => new Date().toISOString().slice(0, 10);
const tag = (s) => `Auto-check ${today()}: ${s}`;

// ---------- network safety ----------
function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const x = ip.toLowerCase();
  if (x.startsWith('::ffff:')) return privateIp(x.slice(7));
  return x === '::1' || x === '::' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe80');
}
async function assertPublic(u) {
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error(`Only http and https addresses can be checked (${u.href}).`);
  if (u.username || u.password) throw new Error('Addresses with a user name or password are not checked.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const ips = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true }).catch(() => { throw new Error(`The address ${host} could not be found.`); })).map(a => a.address);
  if (!ips.length || ips.some(privateIp)) throw new Error(`${host} points to a private or local network address, which is not checked.`);
}
// GET without following redirects automatically, so every hop is checked
async function get(url, { headers = {}, follow = true, maxBytes = 300_000 } = {}) {
  let u = new URL(url); const hops = [];
  for (let i = 0; i < 6; i++) {
    await assertPublic(u);
    const r = await fetch(u, { redirect: 'manual', headers: { 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(TIMEOUT) });
    hops.push({ url: u.href, status: r.status, location: r.headers.get('location') });
    if (follow && r.status >= 300 && r.status < 400 && r.headers.get('location')) { await r.body?.cancel(); u = new URL(r.headers.get('location'), u); continue; }
    let body = '';
    if (r.body) {
      const reader = r.body.getReader(); const chunks = []; let n = 0;
      while (n < maxBytes) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); n += value.length; }
      reader.cancel().catch(() => {});
      body = Buffer.concat(chunks).toString('utf8');
    }
    return { url: u.href, status: r.status, headers: r.headers, cookies: r.headers.getSetCookie?.() || [], body, hops };
  }
  throw new Error('Too many redirects.');
}

// ---------- website ----------
export async function scanWebsite(address) {
  let base = String(address || '').trim();
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
  const start = new URL(base);
  const origin = `https://${start.host}`;
  const out = [];
  const add = (code, status, evidence, next_step = '') => out.push({ code, status, evidence: tag(evidence), next_step });

  let home;
  try { home = await get(`${origin}/`); } catch (e) {
    if (/private|local|only http|user name/i.test(e.message)) throw e;
    home = null; add('C1', 'missing', `https://${start.host} did not answer (${e.message}).`, 'Serve the site over HTTPS with a valid certificate.');
    add('D3', 'missing', `https://${start.host} did not answer.`, 'Serve the site over HTTPS.');
    return { target: origin, results: out };
  }
  const h = home.headers;
  const plain = await get(`http://${start.host}/`, { follow: false }).catch(() => null);
  const redirects = plain && plain.status >= 300 && plain.status < 400 && /^https:/i.test(new URL(plain.headers.get('location') || '/', `http://${start.host}`).href);
  const closed = !plain; // http port closed is fine too
  const hsts = h.get('strict-transport-security');
  const httpsOk = home.status < 500 && /^https:/.test(home.url);

  // C1 / D3
  const c1 = [];
  if (!httpsOk) c1.push('HTTPS does not work');
  if (!redirects && !closed) c1.push(`http:// answers with ${plain?.status} instead of redirecting to https`);
  if (!hsts) c1.push('no Strict-Transport-Security (HSTS) header');
  add('C1', !httpsOk ? 'missing' : c1.length ? 'partial' : 'covered',
    c1.length ? `${origin}: ${c1.join('; ')}.` : `${origin}: HTTPS works, http redirects to https, HSTS "${hsts}".`,
    c1.length ? [!redirects && !closed && 'Redirect all http:// requests to https://', !hsts && 'Add the header Strict-Transport-Security: max-age=31536000; includeSubDomains'].filter(Boolean).join('. ') : '');
  add('D3', !httpsOk ? 'missing' : (redirects || closed) ? 'covered' : 'partial',
    httpsOk ? ((redirects || closed) ? `${origin} is served over HTTPS; plain http ${closed ? 'is closed' : 'redirects to https'}.` : `HTTPS works, but http:// still answers (${plain?.status}).`) : 'HTTPS does not work.',
    (redirects || closed) && httpsOk ? '' : 'Redirect http:// to https://.');

  // E1 security headers
  const csp = h.get('content-security-policy');
  const xfo = h.get('x-frame-options') || (/frame-ancestors/i.test(csp || '') ? 'CSP frame-ancestors' : null);
  const xcto = /nosniff/i.test(h.get('x-content-type-options') || '');
  const rp = h.get('referrer-policy');
  const missingH = [!xfo && 'X-Frame-Options', !xcto && 'X-Content-Type-Options: nosniff', !rp && 'Referrer-Policy'].filter(Boolean);
  add('E1', missingH.length === 0 ? 'covered' : missingH.length === 3 ? 'missing' : 'partial',
    missingH.length ? `Missing on ${origin}: ${missingH.join(', ')}.` : `X-Frame-Options/frame-ancestors, X-Content-Type-Options and Referrer-Policy (${rp}) are set.`,
    missingH.length ? `Add the headers: ${missingH.join(', ')}.` : '');

  // C9 CSP
  const cspRo = h.get('content-security-policy-report-only');
  add('C9', csp ? 'covered' : cspRo ? 'partial' : 'missing',
    csp ? `Content-Security-Policy is enforced: ${csp.slice(0, 160)}` : cspRo ? 'Only Content-Security-Policy-Report-Only is set.' : `No Content-Security-Policy header on ${origin}.`,
    csp ? '' : cspRo ? 'Switch the policy from report-only to enforced once reports are clean.' : 'Add a Content-Security-Policy header (start with report-only).');

  // A11 cookies (only what a visitor sees; sign-in cookies appear after login)
  if (home.cookies.length) {
    const bad = [];
    for (const c of home.cookies) {
      const name = c.split('=')[0].trim(); const attrs = c.toLowerCase();
      const auth = /sess|auth|token|sid|jwt|login/i.test(name);
      const miss = [!/;\s*secure/.test(attrs) && 'Secure', !/;\s*samesite=/.test(attrs) && 'SameSite', auth && !/;\s*httponly/.test(attrs) && 'HttpOnly'].filter(Boolean);
      if (miss.length) bad.push(`${name} (no ${miss.join(', ')})`);
    }
    add('A11', bad.length ? 'partial' : 'covered',
      bad.length ? `Cookies without the right flags: ${bad.join('; ')}.` : `All ${home.cookies.length} cookies set to visitors have Secure and SameSite (and HttpOnly where they look like sign-in cookies). Sign-in cookies after login are not visible to this check.`,
      bad.length ? 'Set Secure, SameSite and (for sign-in cookies) HttpOnly on every cookie.' : 'Confirm the sign-in cookie flags after logging in.');
  }

  // C3 API docs
  const docPaths = ['/docs', '/swagger', '/swagger-ui', '/swagger-ui.html', '/api-docs', '/api/docs', '/openapi.json', '/swagger.json', '/redoc', '/api/swagger'];
    // real API docs only: an OpenAPI/Swagger JSON document, or a Swagger UI / ReDoc page (not any page mentioning the word)
  const isDocs = (r) => r.status === 200 && (/^\s*\{[\s\S]*"(openapi|swagger)"\s*:\s*"\d/.test(r.body) || /SwaggerUIBundle|swagger-ui-bundle\.js|id=["']swagger-ui["']|<redoc[\s>]|Redoc\.init\(/i.test(r.body));
  const docRes = await Promise.all(docPaths.map(p => get(`${origin}${p}`, { maxBytes: 120_000 }).then(r => ({ p, docs: isDocs(r) })).catch(() => null)));
  const docHits = docRes.filter(x => x?.docs).map(x => x.p);
  if (docRes.some(Boolean)) add('C3', docHits.length ? 'missing' : 'covered',
    docHits.length ? `API documentation is open to the public at ${docHits.map(p => origin + p).join(', ')}.` : `None of ${docPaths.join(', ')} shows API documentation.`,
    docHits.length ? 'Turn off API docs in production, or put them behind sign-in.' : '');

  // C4 CORS
  const probe = 'https://cors-check.invalid';
  const cors = await get(`${origin}/`, { headers: { Origin: probe } }).catch(() => null);
  if (cors) {
    const acao = cors.headers.get('access-control-allow-origin'); const acac = /true/i.test(cors.headers.get('access-control-allow-credentials') || '');
    const reflects = acao === probe;
    const bad = (reflects && acac) || (acao === '*' && acac);
    add('C4', bad ? 'missing' : reflects ? 'partial' : 'covered',
      bad ? `Any website may read ${origin} with the visitor's cookies (Access-Control-Allow-Origin: ${acao}, Allow-Credentials: true).`
        : reflects ? `The site echoes any Origin in Access-Control-Allow-Origin (without credentials).`
          : `Another website's Origin is not allowed${acao ? ` (Access-Control-Allow-Origin: ${acao})` : ''}.`,
      bad || reflects ? 'Allow only your own sites in CORS; never "*" or echoed origins with credentials.' : '');
  }

  // E2 error pages and version headers
  const rnd = `pt-check-${Math.random().toString(36).slice(2, 8)}`;
  const errs = await Promise.all([`${origin}/${rnd}`, `${origin}/api/${rnd}`, `${origin}/${rnd}.php?x=%27`].map(u => get(u, { maxBytes: 80_000 }).catch(() => null)));
  const leak = /(at [\w$.<>]+ \(.*:\d+:\d+\)|Traceback \(most recent call last\)|Exception in thread|SQLSTATE\[|Whoops!|Stack trace:|node_modules[\\/]|\/var\/www\/|\/home\/[a-z0-9_-]+\/|[A-Z]:\\\\(Users|inetpub)|Microsoft \.NET Framework Version|DEBUG = True)/i;
  const leaks = errs.filter(r => r && leak.test(r.body)).map(r => `${r.url} (${r.status})`);
  const server = h.get('server'); const powered = h.get('x-powered-by');
  const versions = [server && /\d/.test(server) && `Server: ${server}`, powered && `X-Powered-By: ${powered}`].filter(Boolean);
  add('E2', leaks.length ? 'missing' : versions.length ? 'partial' : 'covered',
    leaks.length ? `Error pages show internal details: ${leaks.join(', ')}.` : versions.length ? `No stack traces on error pages, but versions are advertised: ${versions.join('; ')}.` : 'Error pages tested (not found, API, bad input) show no stack traces, paths or versions.',
    leaks.length ? 'Show a plain error page in production; log details on the server only.' : versions.length ? 'Remove version numbers from the Server / X-Powered-By headers.' : '');

  return { target: origin, results: out };
}

// ---------- code (GitHub) ----------
export function parseRepo(link) {
  const m = String(link || '').trim().match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/tree\/([^?#]+))?\/?(?:[?#].*)?$/i);
  return m ? { owner: m[1], repo: m[2], ref: m[3] ? decodeURIComponent(m[3]) : null } : null;
}

async function downloadRepo({ owner, repo, ref }, token) {
  const url = token ? `https://api.github.com/repos/${owner}/${repo}/zipball${ref ? `/${encodeURIComponent(ref)}` : ''}`
    : `https://codeload.github.com/${owner}/${repo}/zip/${ref ? encodeURIComponent(ref) : 'HEAD'}`;
  const r = await fetch(url, { headers: { 'User-Agent': UA, ...(token ? { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } : {}) }, redirect: 'follow', signal: AbortSignal.timeout(60_000) });
  if (r.status === 404 || r.status === 401 || r.status === 403) throw new Error(token ? `GitHub refused ${owner}/${repo}${ref ? ` (${ref})` : ''}: check the link and that the access token can read this repository.` : `${owner}/${repo} is private or not found. An administrator can add a GitHub access token (Data Security → GitHub access).`);
  if (!r.ok) throw new Error(`GitHub answered ${r.status} for ${owner}/${repo}.`);
  const len = Number(r.headers.get('content-length') || 0);
  if (len > 80 * 1024 * 1024) throw new Error('The repository is too large to scan here (over 80 MB).');
  return Buffer.from(await r.arrayBuffer());
}

const SKIP_DIR = /(^|\/)(node_modules|vendor|dist|build|out|\.next|\.nuxt|coverage|\.git|bower_components|venv|\.venv|__pycache__|target|bin|obj|public\/build|storage\/framework)\//;
const CODE_EXT = /\.(js|mjs|cjs|jsx|ts|tsx|vue|svelte|py|php|rb|go|java|kt|cs|html?|twig|blade\.php|erb|ejs|hbs|sql|ya?ml|json|env|ini|cfg|conf|properties|toml|xml)$/i;
const FRONT = /(^|\/)(client|frontend|web|public|static|src\/(components|pages|views|app)|resources\/(js|views)|templates|views)\/|\.(jsx|tsx|vue|svelte|html?|ejs|hbs|twig|blade\.php|erb)$/i;
const TEST = /(^|\/)(tests?|__tests__|spec|e2e|fixtures?|examples?|docs?)\/|\.(test|spec)\.\w+$/i;

const PATTERNS = {
  html: /dangerouslySetInnerHTML|\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML\(|mark_safe\(|\.html_safe\b|document\.write\(/,
  // template-only syntax, looked for in template files only
  htmlTemplate: [[/\.vue$/i, /\sv-html=/], [/\.(html?|jinja2?|j2|twig|njk)$/i, /\{\{[^}]*\|\s*safe\b|\|\s*raw\b/], [/\.blade\.php$/i, /\{!!.*!!\}/], [/\.ejs$/i, /<%-/], [/\.(hbs|handlebars|mustache)$/i, /\{\{\{[^}]+\}\}\}/], [/\.erb$/i, /<%==|\.html_safe/]],
  secret: [
    [/AKIA[0-9A-Z]{16}/, 'AWS access key'], [/-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/, 'private key'], [/sk_live_[0-9a-zA-Z]{20,}/, 'Stripe live key'],
    [/xox[abpr]-[0-9A-Za-z-]{10,}/, 'Slack token'], [/gh[pousr]_[A-Za-z0-9]{36,}/, 'GitHub token'], [/AIza[0-9A-Za-z_-]{35}/, 'Google API key'],
    [/SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/, 'SendGrid key'],
    // a value with a digit or symbol in it (so labels like password: 'Password' are not reported)
    [/\b(password|passwd|pwd|secret|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|client[_-]?secret|jwt[_-]?secret)["']?\s*[:=]\s*["'](?=[^"'\s]*[0-9!@#$%^&*+=_-])[^"'\s$<>{}]{8,}["']/i, 'hard-coded password/secret'],
  ],
  placeholder: /(example|changeme|change[_-]?me|your[_-]|xxx+|placeholder|dummy|sample|test|demo|\*\*\*|<.*>|process\.env|os\.environ|getenv|env\()/i,
  logSecret: /(console\.(log|info|debug|warn|error)|print\(|logger\.\w+\(|log\.\w+\(|System\.out\.print|error_log\(|var_dump\()[^\n]*\b(password|passwd|token|otp|secret|card|cvv|pan|aadhaar|ssn)\b/i,
  sqlConcat: [
    /["'`]\s*(SELECT\b[^"'`\n]*\bFROM\b|INSERT\s+INTO\b|UPDATE\s+[\w"`.]+\s+SET\b|DELETE\s+FROM\b)\b[^"'`\n]*["'`]\s*\+\s*[\w.[\]]+/i,
    /f["'][^"'\n]*\b(SELECT\b[^"'`\n]*\bFROM\b|INSERT\s+INTO\b|UPDATE\s+[\w"`.]+\s+SET\b|DELETE\s+FROM\b)\b[^"'\n]*\{[^}]+\}/i,
    /["'][^"'\n]*\b(SELECT\b[^"'`\n]*\bFROM\b|INSERT\s+INTO\b|UPDATE\s+[\w"`.]+\s+SET\b|DELETE\s+FROM\b)\b[^"'\n]*\$_(GET|POST|REQUEST|COOKIE)/i,
    /\.(query|execute|raw|exec)\(\s*["'][^"'\n]*["']\s*%\s*\(/i,
  ],
  goodHash: /\b(bcrypt|argon2|scrypt|pbkdf2|password_hash\(|PasswordHasher|make_password|hashpw|BCryptPasswordEncoder|has_secure_password)\b/i,
  weakHash: /\b(md5|sha1)\s*\([^)\n]*pass/i,
};

// Template literals with SQL: report only interpolations that may carry user input. Placeholder lists ('?'),
// joins of column names, UPPER_CASE constants and usual helper names (ph, sql, where, cols...) are not reported.
const SQL_SHAPE = /\b(SELECT\b[^`\n]*\bFROM|INSERT\s+INTO|UPDATE\s+[\w"`.${}]+\s+SET|DELETE\s+FROM)\b/i;
const SAFE_PART = /\?|\.join\(|^\s*(Number|parseInt|ph|placeholders)\(|^\s*[A-Z][A-Z0-9_]*\[|^\s*[A-Z][A-Z0-9_]*\s*$|^\s*(ph|phs|sql|arch|table|keys|where|wheres|cols?|columns|fields|order|orderBy|sort|sets?|clause|filters?|placeholders?|limit|offset|dir|joins?)\s*$/;
function sqlTemplateRisk(line) {
  for (const m of line.matchAll(/`([^`]*)`/g)) {
    if (!SQL_SHAPE.test(m[1])) continue;
    const parts = [...m[1].matchAll(/\$\{([^}]*)\}/g)].map(x => x[1]);
    if (parts.some(x => !SAFE_PART.test(x))) return true;
  }
  return false;
}

const where = (hits) => hits.slice(0, 6).map(h => `${h.file}:${h.line}`).join(', ') + (hits.length > 6 ? ` and ${hits.length - 6} more` : '');

async function npmAdvisories(lock) {
  const pk = {};
  const add = (name, v) => { if (name && v && /^\d/.test(v)) (pk[name] ||= new Set()).add(v); };
  if (lock.packages) for (const [p, d] of Object.entries(lock.packages)) { if (p) add(d.name || p.replace(/^.*node_modules\//, ''), d.version); }
  else if (lock.dependencies) { const walk = (deps) => { for (const [n, d] of Object.entries(deps || {})) { add(n, d.version); walk(d.dependencies); } }; walk(lock.dependencies); }
  const body = Object.fromEntries(Object.entries(pk).map(([k, s]) => [k, [...s]]));
  if (!Object.keys(body).length) return null;
  const r = await fetch('https://registry.npmjs.org/-/npm/v1/security/advisories/bulk', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`npm advisories answered ${r.status}`);
  const data = await r.json();
  const list = [];
  for (const [name, advs] of Object.entries(data)) for (const a of advs) list.push({ name, severity: a.severity, title: a.title });
  return { packages: Object.keys(body).length, list };
}
async function osvPython(reqText) {
  const pins = [...reqText.matchAll(/^\s*([A-Za-z0-9_.-]+)\s*==\s*([\w.]+)/gm)].map(m => ({ package: { name: m[1], ecosystem: 'PyPI' }, version: m[2] }));
  if (!pins.length) return null;
  const r = await fetch('https://api.osv.dev/v1/querybatch', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA }, body: JSON.stringify({ queries: pins }), signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`OSV answered ${r.status}`);
  const data = await r.json();
  const list = [];
  (data.results || []).forEach((x, i) => { for (const v of x.vulns || []) list.push({ name: pins[i].package.name, severity: 'unknown', title: v.id }); });
  return { packages: pins.length, list };
}

export async function scanRepo(link, token) {
  const ref = parseRepo(link);
  if (!ref) throw new Error(`"${link}" is not a GitHub repository link.`);
  const target = `github.com/${ref.owner}/${ref.repo}${ref.ref ? ` (${ref.ref})` : ''}`;
  const entries = unzipBuffer(await downloadRepo(ref, token));
  const top = entries[0]?.name.split('/')[0] || '';
  const files = entries.map(e => ({ path: e.name.slice(top.length + 1), data: e.data })).filter(f => f.path);
  const byName = (re) => files.filter(f => re.test(f.path) && !SKIP_DIR.test(`/${f.path}`));
  const hits = { html: [], secretFront: [], secretBack: [], log: [], sql: [], goodHash: [], weakHash: [], envFiles: [] };
  let scanned = 0;
  for (const f of files) {
    const p = f.path;
    if (SKIP_DIR.test(`/${p}`) || f.data.length > 1_000_000) continue;
    if (/(^|\/)\.env(\.[\w-]+)?$/.test(p) && !/\.(example|sample|template|dist)$/i.test(p)) hits.envFiles.push({ file: p, line: 1 });
    if (!CODE_EXT.test(p) || /\.min\.(js|css)$|package-lock\.json$|yarn\.lock$|\.lock$/.test(p)) continue;
    scanned++;
    const front = FRONT.test(p); const test = TEST.test(p);
    const lines = f.data.toString('utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      if (line.length > 2000) return;
      const at = { file: p, line: i + 1 };
      if (!test && (PATTERNS.html.test(line) || PATTERNS.htmlTemplate.some(([ext, re]) => ext.test(p) && re.test(line)))) hits.html.push(at);
      for (const [re, what] of PATTERNS.secret) {
        const m = line.match(re);
        if (m && !PATTERNS.placeholder.test(m[0]) && !test) (front ? hits.secretFront : hits.secretBack).push({ ...at, what });
      }
      if (!test && PATTERNS.logSecret.test(line)) hits.log.push(at);
      if (!test && (PATTERNS.sqlConcat.some(re => re.test(line)) || sqlTemplateRisk(line))) hits.sql.push(at);
      if (PATTERNS.goodHash.test(line)) hits.goodHash.push(at);
      if (PATTERNS.weakHash.test(line)) hits.weakHash.push(at);
    });
  }
  const out = [];
  const add = (code, status, evidence, next_step = '') => out.push({ code, status, evidence: tag(`${evidence} [${target}]`), next_step });
  const confirm = ' Automatic scan: please confirm.';

  add('A1', hits.sql.length ? 'partial' : 'covered', hits.sql.length ? `SQL text built from variables at ${where(hits.sql)}.` : `No SQL built by pasting variables found in ${scanned} files.${confirm}`,
    hits.sql.length ? 'Use query parameters (?, :name) instead of pasting values into SQL.' : '');
  add('A4', hits.html.length ? 'partial' : 'covered', hits.html.length ? `Raw HTML output at ${where(hits.html)}.` : `No raw-HTML output (innerHTML, dangerouslySetInnerHTML, v-html, |safe…) found.${confirm}`,
    hits.html.length ? 'Check each place: escape or sanitise user content (e.g. DOMPurify) before inserting HTML.' : '');
  add('A7', hits.secretFront.length ? 'missing' : 'covered', hits.secretFront.length ? `Possible keys in front-end code: ${hits.secretFront.slice(0, 6).map(h => `${h.what} at ${h.file}:${h.line}`).join(', ')}.` : `No keys or tokens found in front-end files.${confirm}`,
    hits.secretFront.length ? 'Remove the keys from the browser code, rotate them, and call the service from the server.' : '');
  const backSecrets = [...hits.secretBack, ...hits.envFiles.map(h => ({ ...h, what: 'committed .env file' }))];
  add('A10', backSecrets.length ? 'missing' : 'covered', backSecrets.length ? `Possible secrets in the code: ${backSecrets.slice(0, 6).map(h => `${h.what} at ${h.file}:${h.line}`).join(', ')}.` : `No hard-coded secrets or committed .env files found.${confirm}`,
    backSecrets.length ? 'Move secrets to environment variables, remove them from git history, and rotate them.' : '');
  add('A12', hits.log.length ? 'partial' : 'covered', hits.log.length ? `Log lines that mention passwords/tokens/OTP at ${where(hits.log)}.` : `No log lines writing passwords, tokens or OTPs found.${confirm}`,
    hits.log.length ? 'Make sure these lines never print the secret values.' : '');
  if (hits.weakHash.length) add('A9', 'missing', `Passwords hashed with MD5/SHA1 at ${where(hits.weakHash)}.`, 'Use bcrypt, argon2 or scrypt for passwords.');
  else if (hits.goodHash.length) add('A9', 'covered', `Password hashing with a strong method found at ${where(hits.goodHash.slice(0, 3))}.${confirm}`);

  // C7 lock files / pins
  const manifests = []; const missingLock = [];
  for (const pj of byName(/(^|\/)package\.json$/)) {
    const dir = pj.path.replace(/package\.json$/, '');
    let deps = {}; try { const j = JSON.parse(pj.data.toString('utf8')); deps = { ...j.dependencies, ...j.devDependencies }; } catch { /* ignore */ }
    if (!Object.keys(deps).length) continue;
    manifests.push(pj.path);
    if (!files.some(f => [`${dir}package-lock.json`, `${dir}yarn.lock`, `${dir}pnpm-lock.yaml`, `${dir}npm-shrinkwrap.json`, `${dir}bun.lockb`].includes(f.path))) missingLock.push(`${pj.path} has no lock file`);
  }
  for (const rq of byName(/(^|\/)requirements[\w-]*\.txt$/)) {
    manifests.push(rq.path);
    const loose = rq.data.toString('utf8').split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#') && !l.startsWith('-') && !/==/.test(l));
    if (loose.length) missingLock.push(`${rq.path}: ${loose.length} packages without an exact version (${loose.slice(0, 3).join(', ')})`);
  }
  for (const cj of byName(/(^|\/)composer\.json$/)) { manifests.push(cj.path); if (!files.some(f => f.path === cj.path.replace(/json$/, 'lock'))) missingLock.push(`${cj.path} has no composer.lock`); }
  if (manifests.length) add('C7', missingLock.length ? 'missing' : 'covered', missingLock.length ? missingLock.join('; ') + '.' : `Exact versions are locked for ${manifests.join(', ')}.`,
    missingLock.length ? 'Commit the lock file (package-lock.json / composer.lock) or pin exact versions (==).' : '');

  // B8 known vulnerable packages
  try {
    const found = []; let checked = 0; const notes = [];
    for (const lf of byName(/(^|\/)package-lock\.json$/).slice(0, 3)) {
      try { const r = await npmAdvisories(JSON.parse(lf.data.toString('utf8'))); if (r) { checked += r.packages; found.push(...r.list); notes.push(lf.path); } } catch (e) { notes.push(`${lf.path}: ${e.message}`); }
    }
    for (const rq of byName(/(^|\/)requirements[\w-]*\.txt$/).slice(0, 3)) {
      const r = await osvPython(rq.data.toString('utf8')); if (r) { checked += r.packages; found.push(...r.list); notes.push(rq.path); }
    }
    if (checked) {
      const sev = (s) => found.filter(x => x.severity === s).length;
      const hi = sev('critical') + sev('high');
      const names = [...new Set(found.filter(x => ['critical', 'high'].includes(x.severity) || x.severity === 'unknown').map(x => x.name))].slice(0, 8);
      add('B8', hi ? 'missing' : found.length ? 'partial' : 'covered',
        found.length ? `${checked} packages checked: ${sev('critical')} critical, ${sev('high')} high, ${sev('moderate')} moderate, ${sev('low')} low${sev('unknown') ? `, ${sev('unknown')} other` : ''} known issues${names.length ? ` (${names.join(', ')})` : ''}.` : `${checked} packages checked against public advisories: no known issues.`,
        found.length ? 'Update the affected packages (npm audit fix / pip install -U) and add an audit step before every release.' : 'Add npm audit / pip-audit to the release steps so this stays clean.');
    }
  } catch (e) { /* advisory services unreachable: leave B8 */ }

  return { target, scanned, results: out };
}
