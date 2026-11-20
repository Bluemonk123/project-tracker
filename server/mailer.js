// Outgoing email through the company mailbox (SMTP), with an optional backup mailbox.
// Set up in Administration -> Email. When it isn't set up, nothing is sent and nothing fails.
import crypto from 'node:crypto';
import { getSetting, setSetting } from './db.js';

const KEY = 'smtp_config';
const EMAIL_RE = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/;
export const isEmail = (s) => EMAIL_RE.test(String(s || '').trim()) && String(s).length <= 254;

export function mailConfig() {
  try { return JSON.parse(getSetting(KEY) || '{}') || {}; } catch { return {}; }
}
export function saveMailConfig(cfg) { setSetting(KEY, JSON.stringify(cfg)); }
const usable = (m) => !!(m && m.host && m.from);
export const mailEnabled = () => usable(mailConfig().main);

let nodemailer = null;
async function transport(m) {
  if (!nodemailer) nodemailer = (await import('nodemailer')).default;
  return nodemailer.createTransport({
    host: m.host, port: Number(m.port) || 587, secure: !!m.secure,
    auth: m.user ? { user: m.user, pass: m.pass || '' } : undefined,
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
  });
}

// Incoming mailbox (IMAP), when set up: replies to alert emails go there so they land back on the ticket.
export function inboundConfig() {
  try { return JSON.parse(getSetting('imap_config') || 'null'); } catch { return null; }
}

// Returns { ok, via } or { ok: false, error }. Never throws.
// ticketNo: the Message-ID carries the ticket number, so an emailed reply is matched back to the ticket.
export async function sendMail({ to, subject, text, ticketNo, autoReply }) {
  const cfg = mailConfig();
  if (!usable(cfg.main) || !isEmail(to)) return { ok: false, error: 'Email is not set up.' };
  const appName = getSetting('app_name', 'Project Tracker');
  let lastError = null;
  for (const [via, m] of [['main', cfg.main], ['backup', cfg.backup]]) {
    if (!usable(m)) continue;
    try {
      const t = await transport(m);
      const inbound = inboundConfig();
      const replyTo = inbound?.enabled && isEmail(inbound.address) ? inbound.address : undefined;
      const domain = String(m.from).split('@')[1] || 'project-tracker.local';
      await t.sendMail({
        from: m.from_name ? `"${String(m.from_name).replace(/"/g, '')}" <${m.from}>` : m.from, to, replyTo,
        subject: `[${appName}] ${subject}`, text,
        messageId: ticketNo ? `<ticket-${ticketNo}-${crypto.randomBytes(6).toString('hex')}@${domain}>` : undefined,
        headers: { 'Auto-Submitted': autoReply ? 'auto-replied' : 'auto-generated', 'X-Auto-Response-Suppress': 'All' },
      });
      return { ok: true, via };
    } catch (e) {
      lastError = explainMailError(e.message, m) + (explainMailError(e.message, m) !== e.message ? ` (Server said: ${String(e.message).slice(0, 160)})` : '');
      console.error(`Email through the ${via} mailbox failed:`, e.message);
    }
  }
  return { ok: false, error: lastError || 'Email is not set up.' };
}

// Mail servers answer with codes; say what they mean and what to change.
export function explainMailError(msg, m = {}) {
  const e = String(msg || '');
  const user = m.user || 'this mailbox';
  if (/SendAsDenied|5\.7\.60|not allowed to send as|send as permission/i.test(e))
    return `${user} is not allowed to send as ${m.from}. Put the same address in "Send from" as in "User name", or ask your email admin to give ${user} "Send As" permission on ${m.from}.`;
  if (/5\.7\.139|SmtpClientAuthentication|basic authentication is disabled|security defaults/i.test(e))
    return `Microsoft 365 blocked the sign-in for ${user}. Ask your Microsoft 365 admin to turn on "Authenticated SMTP" for this mailbox (admin.microsoft.com → Users → the user → Mail → Manage email apps). If the mailbox uses two-step sign-in (MFA) or the company has "Security defaults" on, this kind of sign-in is blocked: use a mailbox without MFA, or an app password.`;
  if (/5\.7\.3\b|535|Invalid login|Authentication unsuccessful|authentication failed|Username and Password not accepted/i.test(e))
    return `The mail server did not accept the user name or password for ${user}. Re-type the password and save again. (For Microsoft 365, "Authenticated SMTP" must also be on for this mailbox.)`;
  if (/wrong version number|SSL routines|ssl3_get_record|packet length too long/i.test(e))
    return 'The "SSL/TLS from the start" tick does not match the port: for port 587 leave it unticked; for port 465 tick it.';
  if (/ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|Greeting never received|Connection timeout|ECONNECTION/i.test(e))
    return `The app could not reach the mail server "${m.host}" on port ${m.port || 587}. Check the server name and port (Microsoft 365: smtp.office365.com, port 587).`;
  return e;
}

// Fire and forget: used after a change is saved, so a mail problem never fails the action.
export function sendMailLater(msg) {
  if (!mailEnabled()) return;
  setImmediate(() => { sendMail(msg).catch(() => {}); });
}
