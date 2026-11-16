// Outgoing email through the company mailbox (SMTP), with an optional backup mailbox.
// Set up in Administration -> Email. When it isn't set up, nothing is sent and nothing fails.
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

// Returns { ok, via } or { ok: false, error }. Never throws.
export async function sendMail({ to, subject, text }) {
  const cfg = mailConfig();
  if (!usable(cfg.main) || !isEmail(to)) return { ok: false, error: 'Email is not set up.' };
  const appName = getSetting('app_name', 'Project Tracker');
  let lastError = null;
  for (const [via, m] of [['main', cfg.main], ['backup', cfg.backup]]) {
    if (!usable(m)) continue;
    try {
      const t = await transport(m);
      await t.sendMail({ from: m.from_name ? `"${String(m.from_name).replace(/"/g, '')}" <${m.from}>` : m.from, to, subject: `[${appName}] ${subject}`, text });
      return { ok: true, via };
    } catch (e) {
      lastError = e.message;
      console.error(`Email through the ${via} mailbox failed:`, e.message);
    }
  }
  return { ok: false, error: lastError || 'Email is not set up.' };
}

// Fire and forget: used after a change is saved, so a mail problem never fails the action.
export function sendMailLater(msg) {
  if (!mailEnabled()) return;
  setImmediate(() => { sendMail(msg).catch(() => {}); });
}
