import { run, get } from './db.js';
import { fail } from './access.js';

export function notify(userIds, { actorId = null, projectId = null, wpId = null, meetingId = null, reason, message }) {
  const uniq = [...new Set(userIds.filter(Boolean).map(Number))].filter(id => id !== Number(actorId));
  for (const uid of uniq) {
    const active = get("SELECT id FROM users WHERE id = ? AND status = 'active'", uid);
    if (!active) continue;
    run(`INSERT INTO notifications(user_id, actor_id, project_id, wp_id, meeting_id, reason, message)
         VALUES(?,?,?,?,?,?,?)`, uid, actorId, projectId, wpId, meetingId, reason, message);
  }
}

export const MENTION_RE = /@\[[^\]]+\]\(user:(\d+)\)/g;
export function mentionedUserIds(text) {
  if (!text) return [];
  return [...String(text).matchAll(MENTION_RE)].map(m => Number(m[1]));
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function dateOrNull(v, field = 'date') {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (!DATE_RE.test(String(v)) || Number.isNaN(Date.parse(v))) fail(400, `${field} must be a date like 2026-10-22.`);
  return String(v);
}
export function intOrNull(v) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) fail(400, 'Expected a number.');
  return Math.trunc(n);
}
export function numOrNull(v) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) fail(400, 'Expected a number.');
  return n;
}
export function requireText(v, field) {
  const s = String(v ?? '').trim();
  if (!s) fail(400, `${field} is required.`);
  return s;
}
export const textOrNull = (v) => (v === undefined ? undefined : v === null ? null : String(v));

// Build "SET a = ?, b = ?" from an object containing only defined values.
export function updateSet(fields) {
  const keys = Object.keys(fields).filter(k => fields[k] !== undefined);
  return { sql: keys.map(k => `${k} = ?`).join(', '), values: keys.map(k => fields[k]), keys };
}

export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
