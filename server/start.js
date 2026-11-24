// Starts the app. Works whether the host runs it directly (node server/start.js) or loads it with require()
// (Hostinger and other hosts do this), so no top-level await here.
// If the app cannot start (Node.js too old, data folder not writable, ...), a small page explains why
// instead of the host showing a bare "503".
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyHostEnv } from './hostenv.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = applyHostEnv(ROOT);
for (const n of host.notes) console.log(`  ${n}`);

function showStartupError(message) {
  console.error(`\n  Project Tracker could not start: ${message}\n`);
  const port = Number(process.env.PORT || 4000);
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Project Tracker could not start</title>
<body style="font-family:system-ui,sans-serif;max-width:640px;margin:60px auto;padding:0 16px;line-height:1.5;color:#222">
<h1 style="font-size:22px">Project Tracker could not start</h1>
<p style="background:#fbebeb;border-radius:8px;padding:12px 14px">${String(message).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</p>
<p>Fix the setting above on the server, then restart the app.</p></body>`;
  http.createServer((_req, res) => { res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(html); })
    .listen(port, process.env.HOST || '0.0.0.0');
}

// On hosting (deploy folder under hbuilds / public_html, or DISABLE_TIMERS set) the data must live outside the
// deploy folder, or every deployment would start over with an empty database.
function unsafeDataDir() {
  const root = ROOT;
  const hosted = host.hosted || /^(1|true|yes)$/i.test(String(process.env.DISABLE_TIMERS || ''));
  if (!hosted) return null;
  if (!process.env.DATA_DIR) return 'The setting DATA_DIR is missing, so the app would start with a new, empty database. Add DATA_DIR (e.g. /home/<user>/tracker-data) in the hosting environment variables and redeploy.';
  const dir = path.resolve(process.env.DATA_DIR);
  if (dir === root || dir.startsWith(root + path.sep)) return `DATA_DIR (${dir}) is inside the deploy folder, which is replaced on every deployment. Point it to a folder outside it, e.g. /home/<user>/tracker-data.`;
  return null;
}

const [maj, min] = process.versions.node.split('.').map(Number);
if (maj < 22 || (maj === 22 && min < 13)) {
  showStartupError(`It needs Node.js 22.13 or newer, but this server runs ${process.version}. Choose Node.js 24 (or the newest 22) in the hosting settings.`);
} else if (unsafeDataDir()) {
  showStartupError(unsafeDataDir());
} else {
  import('./index.js')
    .then(({ startServer }) => startServer())
    .catch((e) => {
      let msg = e?.message || String(e);
      if (e?.code === 'EACCES' || e?.code === 'ENOENT' || e?.code === 'EROFS' || e?.code === 'ENOTDIR') msg = `The data folder cannot be used (${msg}). Check DATA_DIR (now: ${process.env.DATA_DIR || 'not set'}).`;
      showStartupError(msg);
    });
}
