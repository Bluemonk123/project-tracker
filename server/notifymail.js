// Email copies of in-app notifications (task assigned, mentions, comments, stage changes, meetings, approvals,
// project news, tickets...). Each notification is marked "pending"; about half a minute later the pending ones of
// each person go out as ONE email (so a burst of changes is one message, not five). Runs from a short timer after
// each notification and from the scheduled jobs (/api/cron), so nothing is lost when the server sleeps.
// Off when: outgoing email is not set up, the administrator switched it off, or the person turned it off.
import { get, all, run, getSetting } from './db.js';
import { mailEnabled, sendMail } from './mailer.js';

// Ticket updates to the person who raised the ticket already get their own email (tickets.js), so no copy.
const OWN_EMAIL = new Set(['ticket_update']);
const GROUP_AFTER_MS = 30_000;

export const notifyEmailOn = () => getSetting('notify_email', '1') !== '0';

// Where links in the emails point: Administration setting, else the address the app was last opened at.
let origin = null;
export function rememberOrigin(req) {
  const host = req.get('host');
  if (host && !/^(localhost|127\.|\[::1\])/.test(host)) origin = `${req.protocol}://${host}`;
  else if (host && !origin) origin = `${req.protocol}://${host}`;
}
export const siteUrl = () => (getSetting('site_url', '') || origin || '').replace(/\/+$/, '');

export function wantsEmail(userId, reason) {
  if (OWN_EMAIL.has(reason) || !notifyEmailOn() || !mailEnabled()) return false;
  const u = get("SELECT email, email_notify FROM users WHERE id = ? AND status = 'active'", userId);
  return !!(u?.email && u.email_notify !== 0);
}

let timer = null;
export function scheduleFlush() {
  if (timer) return;
  timer = setTimeout(() => { timer = null; flushNotificationEmails().catch(e => console.error('Notification emails failed:', e.message)); }, GROUP_AFTER_MS + 2000);
  timer.unref?.();
}

const linkOf = (n) => (n.link && n.link.startsWith('/') ? n.link : n.wp_id ? `/wp/${n.wp_id}` : n.meeting_id ? `/meetings/${n.meeting_id}`
  : n.project_identifier ? `/projects/${n.project_identifier}` : '/notifications');

let flushing = false;
export async function flushNotificationEmails() {
  if (flushing) return { skipped: 'busy' };
  flushing = true;
  try {
    // too old to be useful (e.g. email was off for days): drop instead of a flood
    run("UPDATE notifications SET email_state = 'skipped' WHERE email_state = 'pending' AND created_at < datetime('now', '-2 day')");
    if (!mailEnabled() || !notifyEmailOn()) {
      const n = run("UPDATE notifications SET email_state = 'skipped' WHERE email_state = 'pending'").changes;
      return { skipped: 'email is off', dropped: n };
    }
    const pending = all(`SELECT n.*, u.name AS actor_name, p.identifier AS project_identifier, p.name AS project_name
                         FROM notifications n LEFT JOIN users u ON u.id = n.actor_id LEFT JOIN projects p ON p.id = n.project_id
                         WHERE n.email_state = 'pending' AND n.created_at <= datetime('now', ?) ORDER BY n.user_id, n.id`, `-${Math.round(GROUP_AFTER_MS / 1000)} seconds`);
    if (!pending.length) return { sent: 0 };
    const base = siteUrl();
    const appName = getSetting('app_name', 'Project Tracker');
    const byUser = new Map();
    for (const n of pending) { if (!byUser.has(n.user_id)) byUser.set(n.user_id, []); byUser.get(n.user_id).push(n); }
    let sent = 0; let failed = 0;
    for (const [uid, list] of byUser) {
      const u = get("SELECT name, email, email_notify FROM users WHERE id = ? AND status = 'active'", uid);
      const ids = list.map(n => n.id);
      const mark = (state) => run(`UPDATE notifications SET email_state = ? WHERE id IN (${ids.map(() => '?').join(',')})`, state, ...ids);
      if (!u?.email || u.email_notify === 0) { mark('skipped'); continue; }
      const first = list[0];
      const subject = list.length === 1 ? String(first.message).replace(/\s+/g, ' ').slice(0, 120) : `${list.length} new notifications`;
      const lines = list.map(n => {
        const who = n.actor_name ? `${n.actor_name}: ` : '';
        const where = n.project_name ? ` (${n.project_name})` : '';
        return `• ${who}${String(n.message).trim()}${where}${base ? `\n  Open: ${base}${linkOf(n)}` : ''}`;
      });
      const text = `Hello ${String(u.name).split(' ')[0]},\n\n${list.length === 1 ? 'You have a new notification' : `You have ${list.length} new notifications`} in ${appName}:\n\n${lines.join('\n\n')}\n\n`
        + `${base ? `All notifications: ${base}/notifications\n` : ''}To stop these emails, turn off "Email me my notifications" in My profile.`;
      const r = await sendMail({ to: u.email, subject, text });
      if (r.ok) { mark('sent'); sent++; } else { mark('failed'); failed++; }
    }
    return { sent, failed };
  } finally { flushing = false; }
}
