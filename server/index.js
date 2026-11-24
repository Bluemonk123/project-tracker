import express from 'express';
import crypto from 'node:crypto';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT_DIR, DB_FILE } from './db.js';
import { loadUser, requireAuth, HttpError } from './access.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import projectRoutes from './routes/projects.js';
import wpRoutes from './routes/workpackages.js';
import taskImportRoutes from './routes/taskimport.js';
import overviewRoutes from './routes/overview.js';
import timeRoutes from './routes/time.js';
import meetingRoutes from './routes/meetings.js';
import miscRoutes from './routes/misc.js';
import techRoutes from './routes/tech.js';
import projectBoardRoutes from './routes/projectboard.js';
import { backupCopyRoutes } from './routes/backupcopy.js';
import { publicTicketRoutes, ticketRoutes } from './routes/tickets.js';
import emailRoutes from './routes/email.js';
import calendarRoutes from './routes/calendar.js';
import sprintRoutes from './routes/sprints.js';
import securityRoutes from './routes/security.js';
import { startTimers, cronHandler } from './cron.js';
import { rememberOrigin } from './notifymail.js';
import { fullBackupRoutes, restoreRoutes } from './routes/transfer.js';

// CSRF protection (double-submit token): every browser gets a random pt_csrf cookie, and every
// request that changes something must echo it in the X-CSRF-Token header. Another site can make
// the browser send the cookie, but it cannot read it, so it cannot send the matching header.
export const CSRF_COOKIE = 'pt_csrf';
function csrf(req, res, next) {
  let token = req.cookies?.[CSRF_COOKIE];
  const had = typeof token === 'string' && /^[a-f0-9]{48}$/.test(token);
  if (!had) {
    token = crypto.randomBytes(24).toString('hex');
    res.cookie(CSRF_COOKIE, token, { sameSite: 'lax', path: '/', maxAge: 365 * 86400e3, secure: req.secure });
  }
  if (req.path.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const sent = String(req.get('x-csrf-token') || '');
    const ok = had && sent.length === token.length && crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(token));
    if (!ok) return res.status(403).json({ error: 'This page was open too long. Reload it and try again.', code: 'csrf' });
  }
  next();
}

const PORT = Number(process.env.PORT || 4000);
const HOST = process.env.HOST || '0.0.0.0';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Behind a hosting proxy (e.g. Hostinger): TRUST_PROXY=1 so the visitor's address and HTTPS are seen correctly.
  const tp = String(process.env.TRUST_PROXY || '').trim();
  if (tp) app.set('trust proxy', /^\d+$/.test(tp) ? Number(tp) : /^(true|yes)$/i.test(tp) ? true : tp);
  app.use(express.json({ limit: '5mb' }));
  app.use(cookieParser());
  app.use(csrf);
  app.use((_, res, next) => { res.setHeader('X-Frame-Options', 'SAMEORIGIN'); next(); });
  app.use(loadUser);
  app.use((req, _res, next) => { if (req.user) rememberOrigin(req); next(); }); // links in notification emails

  const api = express.Router();
  // Lightweight check used by the Connected / Disconnected indicator in the top bar
  // build: when the web interface was built and from which commit (written by npm run build), to check a deployment
  let build = null;
  try { build = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'client', 'dist', 'build.json'), 'utf8')); } catch { /* not built */ }
  api.get('/health', (_req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json({ ok: true, time: new Date().toISOString(), env: process.env.APP_ENV || 'production', build: build && process.env.STAGING_COMMIT && !build.commit ? { ...build, commit: process.env.STAGING_COMMIT.slice(0, 7) } : build }); });
  api.get('/cron', cronHandler); // scheduled jobs for hosts without background timers (needs CRON_KEY)
  api.use(authRoutes); // setup, login, logout, me (individual routes guard themselves)
  api.use(restoreRoutes); // new install only: load a full backup instead of creating the first administrator
  api.use(publicTicketRoutes); // login-page "Contact admin" form (no sign-in)
  api.use(requireAuth);
  api.use(adminRoutes);
  api.use(backupCopyRoutes);
  api.use(fullBackupRoutes);
  api.use(projectRoutes);
  api.use(overviewRoutes);
  api.use(taskImportRoutes); // before wpRoutes: POST /work-packages/import
  api.use(wpRoutes);
  api.use(timeRoutes);
  api.use(meetingRoutes);
  api.use(miscRoutes);
  api.use(techRoutes);
  api.use(projectBoardRoutes);
  api.use(ticketRoutes);
  api.use(emailRoutes);
  api.use(calendarRoutes);
  api.use(sprintRoutes);
  api.use(securityRoutes);
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
  startTimers();
}
