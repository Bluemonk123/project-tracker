// Copy the live data (database and uploaded files) from production into the staging copy on this computer.
// Run with sync-from-production.bat while staging (staging.bat) is running. The code needs no copying: staging
// already runs the newest code from GitHub (main), which is what goes to production next.
//
// First run: asks for the production address and the sync key (Administration → Backups → Copy live data to staging,
// on the live site) and keeps them in data/sync-settings.json on this computer.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const SETTINGS = path.join(DATA, 'sync-settings.json');
const LOCAL = `http://127.0.0.1:${process.env.PORT || 4000}`;
const say = (m) => console.log(m);

async function settings() {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); } catch { /* first run */ }
  if (s.url && s.key && !process.argv.includes('--reset')) return s;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  say('\n First time: two answers are needed (kept on this computer for next time).');
  const url = (await rl.question(` Live site address [${s.url || 'https://devteam.bluemonktech.com'}]: `)).trim() || s.url || 'https://devteam.bluemonktech.com';
  say(' The sync key: on the live site, Administration > Backups > "Copy live data to staging" > Create sync key.');
  const key = (await rl.question(' Paste the sync key: ')).trim();
  rl.close();
  if (!/^ptsync_[a-f0-9]{48}$/.test(key)) throw new Error('That does not look like a sync key (it starts with ptsync_).');
  s = { url: url.replace(/\/+$/, ''), key };
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(SETTINGS, JSON.stringify(s, null, 2), { mode: 0o600 });
  return s;
}

// Node's fetch first; on Windows, PowerShell as a fallback (it uses the office proxy settings).
async function download(s, out) {
  const url = `${s.url}/api/sync/full-backup.zip`;
  try {
    const r = await fetch(url, { headers: { 'X-Sync-Key': s.key } });
    if (!r.ok) {
      let msg = `${r.status}`;
      try { msg = (await r.json()).error || msg; } catch { /* not json */ }
      throw Object.assign(new Error(`The live site said: ${msg}`), { fromServer: true });
    }
    fs.writeFileSync(out, Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    if (e.fromServer || process.platform !== 'win32') throw e;
    say(` Direct download failed (${e.cause?.code || e.message}); trying through Windows (PowerShell)...`);
    const cmd = `$ErrorActionPreference='Stop'; try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; [Net.WebRequest]::DefaultWebProxy.Credentials = [Net.CredentialCache]::DefaultNetworkCredentials } catch {}; `
      + `Invoke-WebRequest -UseBasicParsing -Headers @{'X-Sync-Key'='${s.key}'} -Uri '${url}' -OutFile '${out}'`;
    execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', cmd], { stdio: 'inherit', timeout: 600_000 });
  }
}

async function load(zipFile) {
  let token = '';
  try { token = fs.readFileSync(path.join(DATA, '.sync-local-token'), 'utf8').trim(); } catch { /* none */ }
  if (!token) throw new Error('Staging is not running (or is an older version). Start staging.bat, wait until it says it is running, then run this again.');
  let health;
  try { health = await fetch(`${LOCAL}/api/health`); } catch { throw new Error(`Staging is not running at ${LOCAL}. Start staging.bat first.`); }
  const h = await health.json();
  if (h.env !== 'staging') throw new Error('The app on this computer is not the staging copy, so it will not be overwritten.');
  const csrf = (health.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).find(c => c.startsWith('pt_csrf='))?.slice('pt_csrf='.length);
  const r = await fetch(`${LOCAL}/api/sync/restore`, {
    method: 'POST', body: fs.readFileSync(zipFile),
    headers: { 'Content-Type': 'application/zip', 'X-Local-Token': token, 'X-CSRF-Token': csrf || '', Cookie: csrf ? `pt_csrf=${csrf}` : '' },
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Staging answered ${r.status}.`);
  return d;
}

try {
  say('\n Project Tracker: copy the live data to staging\n');
  const s = await settings();
  const tmp = path.join(os.tmpdir(), `pt-live-${Date.now()}.zip`);
  say(` Downloading the live data from ${s.url} ...`);
  await download(s, tmp);
  say(` Downloaded ${(fs.statSync(tmp).size / 1048576).toFixed(1)} MB. Loading it into staging ...`);
  try {
    const d = await load(tmp);
    say(`\n Done: ${d.people} people and ${d.files} files copied from the live site.`);
    say(` Your previous local data was saved as data/backups/${d.backup}.`);
    say(' Email is switched off in the copy (it will not read the support mailbox or email anyone).');
    say(' Open http://localhost:4000 and sign in with your live password.\n');
  } finally { fs.rmSync(tmp, { force: true }); }
} catch (e) {
  say(`\n Not copied: ${e.message}\n`);
  if (/Wrong sync key|switched off/.test(e.message)) say(' Create a new sync key on the live site, then run: sync-from-production.bat --reset\n');
  process.exitCode = 1;
}
