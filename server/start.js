// Starts the app. Works whether the host runs it directly (node server/start.js) or loads it with require()
// (Hostinger and other hosts do this), so no top-level await here.
// If the app cannot start (Node.js too old, data folder not writable, ...), a small page explains why
// instead of the host showing a bare "503".
import http from 'node:http';

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

const [maj, min] = process.versions.node.split('.').map(Number);
if (maj < 22 || (maj === 22 && min < 13)) {
  showStartupError(`It needs Node.js 22.13 or newer, but this server runs ${process.version}. Choose Node.js 24 (or the newest 22) in the hosting settings.`);
} else {
  import('./index.js')
    .then(({ startServer }) => startServer())
    .catch((e) => {
      let msg = e?.message || String(e);
      if (e?.code === 'EACCES' || e?.code === 'ENOENT' || e?.code === 'EROFS' || e?.code === 'ENOTDIR') msg = `The data folder cannot be used (${msg}). Check DATA_DIR (now: ${process.env.DATA_DIR || 'not set'}).`;
      showStartupError(msg);
    });
}
