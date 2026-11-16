// Administration -> Email: company mailbox (and backup mailbox) used for ticket alerts.
import { Router } from 'express';
import { fail } from '../access.js';
import { mailConfig, saveMailConfig, sendMail, isEmail } from '../mailer.js';

const r = Router();
const adminOnly = (req) => { if (!req.user.is_admin) fail(403, 'Only administrators can change the email settings.'); };

// Passwords are never sent back to the browser; has_pass says whether one is saved.
const forClient = (m) => (m ? { host: m.host || '', port: m.port || 587, secure: !!m.secure, user: m.user || '', from: m.from || '', from_name: m.from_name || '', has_pass: !!m.pass } : null);

function clean(input, previous) {
  if (!input || !String(input.host || '').trim()) return null;
  const host = String(input.host).trim();
  if (!/^[a-z0-9.-]+$/i.test(host)) fail(400, 'The mail server name is not valid.');
  const port = Number(input.port) || 587;
  if (port < 1 || port > 65535) fail(400, 'The port must be between 1 and 65535.');
  const from = String(input.from || '').trim();
  if (!isEmail(from)) fail(400, 'Enter the address the emails are sent from.');
  const pass = input.pass ? String(input.pass) : (input.keep_pass !== false ? previous?.pass || '' : '');
  return { host, port, secure: !!input.secure, user: String(input.user || '').trim(), pass, from, from_name: String(input.from_name || '').trim().slice(0, 80) };
}

r.get('/admin/email', (req, res) => {
  adminOnly(req);
  const c = mailConfig();
  res.json({ main: forClient(c.main), backup: forClient(c.backup) });
});

r.put('/admin/email', (req, res) => {
  adminOnly(req);
  const prev = mailConfig();
  const main = clean(req.body.main, prev.main);
  const backup = clean(req.body.backup, prev.backup);
  if (backup && !main) fail(400, 'Set up the main mailbox before a backup one.');
  saveMailConfig({ main, backup });
  res.json({ ok: true });
});

r.post('/admin/email/test', async (req, res) => {
  adminOnly(req);
  const out = await sendMail({ to: req.user.email, subject: 'Test email', text: 'This test email shows that ticket alerts can be sent from Project Tracker.' });
  if (!out.ok) fail(400, `The test email could not be sent: ${out.error}`);
  res.json({ ok: true, via: out.via, to: req.user.email });
});

export default r;
