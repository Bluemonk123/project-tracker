import express from 'express';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT_DIR, DB_FILE, BACKUP_DIR, backupNow } from './db.js';
import { loadUser, requireAuth, HttpError } from './access.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import projectRoutes from './routes/projects.js';
import wpRoutes from './routes/workpackages.js';
import timeRoutes from './routes/time.js';
import meetingRoutes from './routes/meetings.js';
import miscRoutes from './routes/misc.js';
import techRoutes from './routes/tech.js';
import { backupCopyRoutes, scheduleCopies } from './routes/backupcopy.js';

const PORT = Number(process.env.PORT || 4000);
const HOST = process.env.HOST || '0.0.0.0';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '5mb' }));
  app.use(cookieParser());
  app.use((_, res, next) => { res.setHeader('X-Frame-Options', 'SAMEORIGIN'); next(); });
  app.use(loadUser);

  const api = express.Router();
  // Lightweight check used by the Connected / Disconnected indicator in the top bar
  api.get('/health', (_req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json({ ok: true, time: new Date().toISOString() }); });
  api.use(authRoutes); // setup, login, logout, me (individual routes guard themselves)
  api.use(requireAuth);
  api.use(adminRoutes);
  api.use(backupCopyRoutes);
  api.use(projectRoutes);
  api.use(wpRoutes);
  api.use(timeRoutes);
  api.use(meetingRoutes);
  api.use(miscRoutes);
  api.use(techRoutes);
  api.use((_req, _res, next) => next(new HttpError(404, 'Not found.')));
  app.use('/api', api);

  const dist = path.join(ROOT_DIR, 'client', 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '7d', setHeaders: (res, file) => { if (file.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache'); } }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html'), { headers: { 'Cache-Control': 'no-cache' } }));
  } else {
    app.get('/', (_req, res) => res.type('text').send('The web interface has not been built yet. Run "npm run build" and restart.'));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    let message = status >= 500 ? 'Something went wrong on the server. Check the server window for details.' : err.message;
    if (err.type === 'entity.too.large') message = 'That request is too large.';
    res.status(status).json({ error: message });
  });
  return app;
}

// Keep a daily copy of the database; prune to the newest 14 automatic backups.
function scheduleBackups() {
  const run = () => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const existing = fs.readdirSync(BACKUP_DIR).filter(f => f.includes('-auto.db'));
      if (!existing.some(f => f.startsWith(`tracker-${today}`))) backupNow('auto');
      existing.concat().sort().reverse().slice(14).forEach(f => fs.rmSync(path.join(BACKUP_DIR, f), { force: true }));
    } catch (e) { console.error('Backup failed:', e.message); }
  };
  setTimeout(run, 10_000);
  setInterval(run, 6 * 3600 * 1000).unref();
}

export function startServer() {
  const app = createApp();
  app.listen(PORT, HOST, () => {
    const lan = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
    console.log('\n  Project Tracker is running.\n');
    console.log(`  On this computer:   http://localhost:${PORT}`);
    for (const ip of lan) console.log(`  On the office network: http://${ip}:${PORT}`);
    console.log(`\n  Data file: ${DB_FILE}`);
    console.log('  Keep this window open while people use the app. Press Ctrl+C to stop.\n');
  });
  scheduleBackups();
  scheduleCopies();
}
