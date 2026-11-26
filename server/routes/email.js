// Administration -> Email: company mailbox (and backup mailbox) used for ticket alerts.
import { Router } from 'express';
import { fail } from '../access.js';
import { getSetting, setSetting } from '../db.js';
import { mailConfig, saveMailConfig, sendMail, isEmail } from '../mailer.js';
import { imapConfig, saveImapConfig, lastCheck, checkMailbox } from '../inbound.js';

const r = Router();
const adminOnly = (req) => { if (!req.user.is_admin) fail(403, 'Only administrators can change the email settings.'); };

// Passwords are never sent back to the browser; has_pass says whether one is saved.
const forClient = (m) => (m ? { host: m.host || '', port: m.port || 587, secure: !!m.secure, user: m.user || '', from: m.from || '', from_name: m.from_name || '', reply_to: m.reply_to || '', has_pass: !!m.pass } : null);

function clean(input, previous) {
  if (!input || !String(input.host || '').trim()) return null;
  const host = String(input.host).trim();
  if (!/^[a-z0-9.-]+$/i.test(host)) fail(400, 'The mail server name is not valid.');
  const port = Number(input.port) || 587;
  if (port < 1 || port > 65535) fail(400, 'The port must be between 1 and 65535.');
  const from = String(input.from || '').trim();
  if (!isEmail(from)) fail(400, 'Enter the address the emails are sent from.');
  const pass = input.pass ? String(input.pass) : (input.keep_pass !== false ? previous?.pass || '' : '');
  const replyTo = String(input.reply_to || '').trim();
  if (replyTo && !isEmail(replyTo)) fail(400, 'The reply-to address is not a valid email address.');
  return { host, port, secure: !!input.secure, user: String(input.user || '').trim(), pass, from, from_name: String(input.from_name || '').trim().slice(0, 80), reply_to: replyTo };
}

r.get('/admin/email', (req, res) => {
  adminOnly(req);
  const c = mailConfig();
  const i = imapConfig();
  res.json({
    main: forClient(c.main), backup: forClient(c.backup),
    inbound: { enabled: !!i.enabled, host: i.host || '', port: i.port || 993, secure: i.secure !== false, user: i.user || '', has_pass: !!i.pass,
      folder: i.folder || 'INBOX', address: i.address || '', minutes: i.minutes || 2 },
    inbound_last: lastCheck(),
    notify_email: getSetting('notify_email', '1') !== '0',
    timers_off: /^(1|true|yes)$/i.test(String(process.env.DISABLE_TIMERS || '')),
    cron_last_at: getSetting('cron_last_at', '') || null,
  });
});

r.put('/admin/email', (req, res) => {
  adminOnly(req);
  const prev = mailConfig();
  const main = clean(req.body.main, prev.main);
  const backup = clean(req.body.backup, prev.backup);
  if (backup && !main) fail(400, 'Set up the main mailbox before a backup one.');
  saveMailConfig({ main, backup });
  if ('notify_email' in req.body) setSetting('notify_email', req.body.notify_email ? '1' : '0');
  res.json({ ok: true });
});

r.post('/admin/email/test', async (req, res) => {
  adminOnly(req);
  const out = await sendMail({ to: req.user.email, subject: 'Test email', text: 'This test email shows that ticket alerts can be sent from Project Tracker.' });
  if (!out.ok) fail(400, `The test email could not be sent: ${out.error}`);
  // the mail server's own answer (e.g. "250 OK id=1abc") helps trace the email at the receiving side
  res.json({ ok: true, via: out.via, to: req.user.email, server: out.server, message_id: out.message_id });
});

// Incoming mail (IMAP): emails to the support mailbox become tickets.
function cleanInbound(b, prev) {
  const host = String(b.host || '').trim();
  if (host && !/^[a-z0-9.-]+$/i.test(host)) fail(400, 'The incoming mail server name is not valid.');
  const port = Number(b.port) || 993;
  if (port < 1 || port > 65535) fail(400, 'The port must be between 1 and 65535.');
  const address = String(b.address || '').trim();
  if (address && !isEmail(address)) fail(400, 'The support email address is not valid.');
  const folder = String(b.folder || 'INBOX').trim().slice(0, 100) || 'INBOX';
  const minutes = [1, 2, 5, 10, 15].includes(Number(b.minutes)) ? Number(b.minutes) : 2;
  const c = { enabled: !!b.enabled, host, port, secure: b.secure !== false, user: String(b.user || '').trim(), pass: b.pass ? String(b.pass) : prev?.pass || '', folder, address, minutes };
  if (c.enabled && (!c.host || !c.user)) fail(400, 'Enter the incoming mail server and user name before switching email intake on.');
  return c;
}
r.put('/admin/email/inbound', (req, res) => {
  adminOnly(req);
  saveImapConfig(cleanInbound(req.body || {}, imapConfig()));
  res.json({ ok: true });
});
// Check now (also tests the connection). Uses the form's values if given, without saving them.
r.post('/admin/email/inbound/check', async (req, res) => {
  adminOnly(req);
  const cfg = req.body && req.body.host ? cleanInbound({ ...req.body, enabled: false }, imapConfig()) : imapConfig();
  const out = await checkMailbox({ cfg });
  if (!out.ok) fail(400, `Could not read the mailbox: ${out.error}`);
  res.json(out);
});

export default r;
