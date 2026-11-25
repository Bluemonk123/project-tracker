// Email intake: reads new emails from the support mailbox over IMAP and turns them into tickets
// (or adds them to the ticket they reply to). Set up in Administration -> Ticket Board -> Email.
// Each email is marked as read once handled, so it is never picked up twice.
import { getSetting, setSetting } from './db.js';
import { mailConfig, isEmail } from './mailer.js';
import { ingestEmail } from './routes/tickets.js';

const KEY = 'imap_config';   // { enabled, host, port, secure, user, pass, folder, address, minutes }
const LAST = 'imap_last';    // { at, ok, read, created, replies, skipped, error }
const MAX_PER_CHECK = 50;

export function imapConfig() {
  try { return { folder: 'INBOX', port: 993, secure: true, minutes: 2, ...(JSON.parse(getSetting(KEY) || '{}') || {}) }; } catch { return { folder: 'INBOX', port: 993, secure: true, minutes: 2 }; }
}
export function saveImapConfig(c) { setSetting(KEY, JSON.stringify(c)); }
export function lastCheck() { try { return JSON.parse(getSetting(LAST) || 'null'); } catch { return null; } }

// Out-of-office replies, bounces and mailing lists must not become tickets (and must not start a mail loop).
export function isAutomatic(headers, fromEmail) {
  const h = (k) => String(headers.get(k) ?? '').toLowerCase();
  if (h('auto-submitted') && h('auto-submitted') !== 'no') return 'automatic reply';
  if (['bulk', 'junk', 'list', 'auto_reply'].includes(h('precedence'))) return 'bulk or list email';
  if (headers.has('x-autoreply') || headers.has('x-autorespond') || headers.has('list-id') || h('x-auto-response-suppress').includes('all')) return 'automatic reply';
  // server and robot senders (cPanel's own notices, no-reply addresses...): nobody to answer
  if (/^(mailer-daemon|postmaster|no-?reply|do-?not-?reply|noreply[-.\w]*|cpanel|root|daemon|bounces?|notifications?|alerts?|system|webmaster|hostmaster|abuse)@/i.test(fromEmail)) return 'system address';
  if (headers.has('x-cpanel-notice') || /^cpanel/i.test(h('x-mailer')) || /^(cpanel|whm)\b/i.test(h('x-cpanel-generator'))) return 'hosting control panel notice';
  const own = [mailConfig().main?.from, mailConfig().backup?.from, imapConfig().address, imapConfig().user].filter(Boolean).map(s => String(s).toLowerCase());
  if (own.includes(fromEmail)) return 'sent by this app';
  return null;
}

// Keeps only the new part of a reply: drops the quoted earlier message.
export function stripQuoted(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^On .{4,200}wrote:\s*$/i.test(l) || (/^On .{4,200}$/i.test(l) && /wrote:\s*$/i.test(lines[i + 1] || ''))) break;
    if (/^-{2,}\s*Original Message\s*-{2,}/i.test(l) || /^_{10,}\s*$/.test(l)) break;
    if (/^From:\s.+/i.test(l) && lines.slice(i + 1, i + 5).some(x => /^(Sent|Date|To|Subject):\s/i.test(x))) break;
    if (/^>/.test(l)) continue;
    out.push(l);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
const htmlToText = (html) => String(html || '')
  .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
  .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

// Turns one parsed email (mailparser output) into a ticket or a reply.
export function handleParsed(parsed) {
  const from = parsed.from?.value?.[0] || {};
  const fromEmail = String(from.address || '').toLowerCase();
  const why = isAutomatic(parsed.headers || new Map(), fromEmail);
  if (why) return { action: 'skipped', reason: why };
  const text = stripQuoted(parsed.text || htmlToText(parsed.html));
  const attachments = (parsed.attachments || []).filter(a => !a.related && a.filename && a.content?.length);
  return ingestEmail({
    fromEmail, fromName: from.name, subject: parsed.subject, text, attachments,
    rawText: parsed.text || htmlToText(parsed.html), // the whole body, for a "Requestor - email" line anywhere
    messageId: parsed.messageId, inReplyTo: parsed.inReplyTo,
    references: Array.isArray(parsed.references) ? parsed.references : parsed.references ? [parsed.references] : [],
  });
}

let running = false;
// Connects, handles every unread email in the folder (up to 50 per check), marks each as read.
export async function checkMailbox({ cfg = imapConfig() } = {}) {
  if (!cfg.host || !cfg.user) throw new Error('Enter the incoming mail server and user name first.');
  if (running) return lastCheck();
  running = true;
  const result = { at: new Date().toISOString(), ok: true, read: 0, created: 0, replies: 0, skipped: 0, error: null, unread: 0, items: [] };
  let client;
  try {
    const [{ ImapFlow }, { simpleParser }] = await Promise.all([import('imapflow'), import('mailparser')]);
    client = new ImapFlow({
      host: cfg.host, port: Number(cfg.port) || 993, secure: cfg.secure !== false,
      auth: { user: cfg.user, pass: cfg.pass || '' }, logger: false, socketTimeout: 60000,
    });
    client.on('error', () => {}); // a dropped connection is reported by the awaited call
    await client.connect();
    const lock = await client.getMailboxLock(cfg.folder || 'INBOX');
    try {
      const uids = (await client.search({ seen: false }, { uid: true })) || [];
      result.unread = uids.length;
      result.total = client.mailbox?.exists ?? null;
      for (const uid of uids.slice(0, MAX_PER_CHECK)) {
        const msg = await client.fetchOne(uid, { source: true }, { uid: true });
        result.read++;
        // what happened to each email, shown under "Check now" (helps when an email did not become a ticket)
        const note = { from: '', subject: '', outcome: '' };
        try {
          const parsed = await simpleParser(msg.source);
          note.from = String(parsed.from?.value?.[0]?.address || '').slice(0, 120);
          note.subject = String(parsed.subject || '').slice(0, 120);
          const out = handleParsed(parsed);
          if (out.action === 'created') { result.created++; note.outcome = `ticket created${out.ticket_no ? ` (${out.ticket_no})` : ''}`; }
          else if (out.action === 'reply') { result.replies++; note.outcome = 'added to its ticket'; }
          else { result.skipped++; note.outcome = `skipped: ${out.reason || out.action}`; }
        } catch (e) {
          result.skipped++;
          note.outcome = `could not be read: ${e.message}`;
          console.error('An email could not be turned into a ticket:', e.message);
        }
        if (result.items.length < 20) result.items.push(note);
        await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
      }
    } finally { lock.release(); }
    await client.logout();
  } catch (e) {
    result.ok = false;
    result.error = e.responseText || e.message || String(e);
    try { client?.close(); } catch { /* ignore */ }
  } finally { running = false; }
  setSetting(LAST, JSON.stringify(result));
  return result;
}

// Checks the mailbox when the set number of minutes (1, 2, 5, 10 or 15) has passed since the last check.
// Used by the in-app timer and by /api/cron (hosting without background timers).
let lastRun = 0;
export async function inboundDue() {
  const cfg = imapConfig();
  if (!cfg.enabled || !cfg.host) return { skipped: 'email intake is off' };
  const prev = Math.max(lastRun, Date.parse(lastCheck()?.at || 0) || 0);
  if (Date.now() - prev < (Number(cfg.minutes) || 2) * 60e3 - 5000) return { skipped: 'not due' };
  lastRun = Date.now();
  try { const r = await checkMailbox({ cfg }); return { ran: true, ok: r?.ok !== false, created: r?.created || 0, replies: r?.replies || 0 }; } catch (e) { return { ran: true, ok: false, error: e.message }; }
}

export function scheduleInbound() {
  setInterval(() => { inboundDue().catch(() => {}); }, 30e3).unref();
}

export const validAddress = isEmail;
