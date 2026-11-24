// Settings that survive the hosting panel losing its environment variables (it happened once on Hostinger
// when the repository branch was changed: DATA_DIR was gone and the app started with an empty database).
//  1. No DATA_DIR on a Linux host: use /home/<user>/tracker-data when it already holds tracker.db.
//  2. The settings below are copied into <data folder>/app-settings.env whenever they are set on the server,
//     and read back from there when the server no longer has them.
//  3. On hosting, TRUST_PROXY defaults to 1, and DISABLE_TIMERS to 1 when a CRON_KEY exists (cron calls /api/cron).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const KEYS = ['CRON_KEY', 'DISABLE_TIMERS', 'TRUST_PROXY', 'MAX_UPLOAD_MB'];
const FILE = 'app-settings.env';

function readFile(file) {
  const out = {};
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
      if (m && KEYS.includes(m[1])) out[m[1]] = m[2];
    }
  } catch { /* no file */ }
  return out;
}

export function applyHostEnv(root, env = process.env) {
  const notes = [];
  const onHostPath = /[\\/](hbuilds|public_html|domains)[\\/]/.test(root);
  if (!env.DATA_DIR && process.platform !== 'win32') {
    const homeOfRoot = (root.match(/^\/home\/[^/]+/) || [])[0];
    const found = [path.join(os.homedir(), 'tracker-data'), homeOfRoot && path.join(homeOfRoot, 'tracker-data')]
      .filter(Boolean).find(d => fs.existsSync(path.join(d, 'tracker.db')));
    if (found) { env.DATA_DIR = found; notes.push(`DATA_DIR was not set; using ${found}`); }
  }
  const hosted = onHostPath || !!env.DATA_DIR && !path.resolve(env.DATA_DIR).startsWith(root + path.sep) && process.platform !== 'win32';
  if (!env.DATA_DIR) return { hosted: onHostPath, notes };

  const file = path.join(env.DATA_DIR, FILE);
  const saved = readFile(file);
  const fromServer = Object.fromEntries(KEYS.filter(k => env[k]).map(k => [k, env[k]]));
  for (const k of KEYS) if (!env[k] && saved[k]) { env[k] = saved[k]; notes.push(`${k} taken from ${FILE}`); }
  if (hosted) {
    if (!env.TRUST_PROXY) env.TRUST_PROXY = '1';
    if (!env.DISABLE_TIMERS && env.CRON_KEY) env.DISABLE_TIMERS = '1';
  }
  // keep a copy of what the server sets, for the next time the panel loses it
  const merged = { ...saved, ...fromServer };
  if (Object.keys(fromServer).length && KEYS.some(k => merged[k] !== saved[k]) && fs.existsSync(env.DATA_DIR)) {
    try {
      fs.writeFileSync(file, `# Copied by Project Tracker from the server settings; used when the server loses them.\n${KEYS.filter(k => merged[k]).map(k => `${k}=${merged[k]}`).join('\n')}\n`, { mode: 0o600 });
    } catch (e) { notes.push(`could not save ${FILE}: ${e.message}`); }
  }
  return { hosted, notes };
}
