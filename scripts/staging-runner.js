// Staging runner (office computer): runs Project Tracker and keeps it on the newest version of GitHub's "main" branch.
// Started by staging.bat. Every 30 seconds it asks GitHub for the newest commit; when there is a new one it
// downloads it, backs up the database, stops the app, copies the new files (never data, node_modules or Node.js),
// installs components / rebuilds when needed and starts the app again. Close the window to stop everything.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { unzipBuffer } from '../server/archive.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = process.env.STAGING_REPO || 'Bluemonk123/project-tracker';
const BRANCH = process.env.STAGING_BRANCH || 'main';
const POLL_MS = 30_000;
const DATA = path.join(ROOT, 'data');
const STATE = path.join(DATA, '.staging-commit');
const SKIP = /^(data|node_modules|\.git|node|node-v[^/]*)(\/|$)/;
const RESTART_RUNNER = 3; // staging.bat starts the runner again when it exits with this code
const UA = { 'User-Agent': 'project-tracker-staging' };
const win = process.platform === 'win32';

const log = (m) => console.log(`[${new Date().toLocaleTimeString()}] ${m}`);
const readState = () => { try { return fs.readFileSync(STATE, 'utf8').trim(); } catch { return ''; } };

// ---------- the app ----------
let child = null; let stopping = false;
function startApp(commit) {
  stopping = false;
  child = spawn(process.execPath, ['server/start.js'], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, APP_ENV: 'staging', STAGING_COMMIT: commit || readState() } });
  child.on('exit', (code) => {
    child = null;
    if (!stopping) { log(`The app stopped (code ${code}). Starting it again in 5 seconds...`); setTimeout(() => startApp(), 5000); }
  });
}
function stopApp() {
  return new Promise((resolve) => {
    if (!child) return resolve();
    stopping = true;
    const c = child;
    c.once('exit', () => resolve());
    c.kill();
    setTimeout(() => { try { c.kill('SIGKILL'); } catch { /* gone */ } }, 8000);
  });
}

// ---------- GitHub ----------
// Node's own fetch first; on Windows, PowerShell as a fallback (it uses the office proxy settings, like update.bat).
function powershellGet(url, outFile) {
  const cmd = `$ErrorActionPreference='Stop'; try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; [Net.WebRequest]::DefaultWebProxy.Credentials = [Net.CredentialCache]::DefaultNetworkCredentials } catch {}; `
    + (outFile ? `Invoke-WebRequest -UseBasicParsing -Headers @{'User-Agent'='project-tracker-staging'} -Uri '${url}' -OutFile '${outFile}'`
      : `[Text.Encoding]::ASCII.GetString((Invoke-WebRequest -UseBasicParsing -Headers @{'User-Agent'='project-tracker-staging'} -Uri '${url}').RawContentStream.ToArray())`);
  return execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', cmd], { encoding: outFile ? undefined : 'utf8', timeout: 120_000 });
}

// The newest commit of the branch, from GitHub's git address (no API, no hourly limit).
let lastSha = null; let viaPowershell = false;
const refsUrl = `https://github.com/${REPO}.git/info/refs?service=git-upload-pack`;
const pickSha = (text) => (String(text).match(new RegExp(`([0-9a-f]{40}) refs/heads/${BRANCH}\\b`)) || [])[1] || null;
async function newestCommit() {
  if (!viaPowershell) {
    try {
      const r = await fetch(refsUrl, { headers: UA, signal: AbortSignal.timeout(20_000) });
      if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
      lastSha = pickSha(await r.text());
      if (!lastSha) throw new Error(`branch ${BRANCH} not found`);
      return lastSha;
    } catch (e) {
      if (!win) throw e;
      log(`Direct connection to GitHub failed (${e.message}); using PowerShell from now on.`);
      viaPowershell = true;
    }
  }
  lastSha = pickSha(powershellGet(refsUrl));
  return lastSha;
}

async function download(sha) {
  const url = `https://codeload.github.com/${REPO}/zip/${sha}`;
  if (!viaPowershell) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(120_000) });
      if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) { if (!win) throw e; viaPowershell = true; }
  }
  const tmp = path.join(os.tmpdir(), `pt-staging-${sha.slice(0, 7)}.zip`);
  powershellGet(url, tmp);
  const buf = fs.readFileSync(tmp); fs.rmSync(tmp, { force: true });
  return buf;
}

// ---------- update ----------
const npm = (args, env = {}) => spawnSync(win ? 'npm.cmd' : 'npm', args, { cwd: ROOT, stdio: 'inherit', shell: win, env: { ...process.env, ...env } }).status === 0;
const check = (mode) => spawnSync(process.execPath, ['scripts/check.js', mode], { cwd: ROOT }).status === 0;

function prepare(sha) {
  if (!check('need-install')) {
    log('Installing components...');
    if (!npm(['install', '--no-audit', '--no-fund'])) throw new Error('npm install failed');
    check('stamp-install');
  }
  if (!check('need-build') || !fs.existsSync(path.join(ROOT, 'client', 'dist', 'build.json'))) {
    log('Building the web interface...');
    if (!npm(['run', 'build'], { SOURCE_COMMIT: sha ? sha.slice(0, 7) : '' })) throw new Error('build failed');
    check('stamp-build');
  }
}

async function update(sha) {
  log(`New version ${sha.slice(0, 7)} on GitHub. Downloading...`);
  const entries = unzipBuffer(await download(sha));
  const top = entries[0]?.name.split('/')[0];
  const files = entries.map(e => ({ rel: e.name.slice(top.length + 1), data: e.data }))
    .filter(f => f.rel && !SKIP.test(f.rel));
  if (!files.some(f => f.rel === 'package.json')) throw new Error('the download does not look like Project Tracker');
  const runnerChanged = (() => { const n = files.find(f => f.rel === 'scripts/staging-runner.js'); try { return !n || !n.data.equals(fs.readFileSync(fileURLToPath(import.meta.url))); } catch { return true; } })();

  await stopApp();
  // safety copy of the database (like update.bat)
  const backup = path.join(DATA, 'backups', 'before-update');
  for (const f of ['tracker.db', 'tracker.db-wal', 'tracker.db-shm']) {
    const src = path.join(DATA, f);
    if (fs.existsSync(src)) { fs.mkdirSync(backup, { recursive: true }); fs.copyFileSync(src, path.join(backup, f)); }
  }
  log(`Installing ${files.length} files...`);
  for (const f of files) {
    const dest = path.join(ROOT, f.rel);
    if (!path.resolve(dest).startsWith(ROOT + path.sep)) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, f.data);
  }
  prepare(sha);
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(STATE, sha);
  if (runnerChanged) { log('The staging runner itself was updated; restarting it.'); process.exit(RESTART_RUNNER); }
  log(`Now running ${sha.slice(0, 7)}.`);
  startApp(sha);
}

let busy = false; let lastTick = 0;
async function tick() {
  if (busy) return;
  if (viaPowershell && Date.now() - lastTick < 55_000) return; // PowerShell is slower: once a minute
  busy = true; lastTick = Date.now();
  try {
    const sha = await newestCommit();
    if (sha && sha !== readState()) await update(sha);
  } catch (e) {
    log(`Update check failed: ${e.message}. Trying again later.`);
    if (!child) startApp();
  } finally { busy = false; }
}

console.log(`\n  Project Tracker STAGING: follows GitHub ${REPO} (${BRANCH}) and updates itself.\n  Keep this window open. Close it to stop the app.\n`);
try { prepare(readState()); } catch (e) { log(e.message); }
startApp();
setTimeout(tick, 3000);
setInterval(tick, POLL_MS);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await stopApp(); process.exit(0); });
