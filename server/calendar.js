// Working calendar: weekly off days, daily working hours, holidays, and how many working days each priority allows.
// Used to set a task's due date from its priority (start date + N working days).
import { get, all, getSetting, setSetting } from './db.js';

const KEY = 'work_calendar'; // JSON { off_days: [0..6] (0 = Sunday), hours_per_day, priority_days: { [priority_id]: days } }
const DEFAULT_DAYS = { P1: 1, P2: 3, P3: 5, P4: 10 };

export function calendar() {
  let c = {};
  try { c = JSON.parse(getSetting(KEY) || '{}') || {}; } catch { c = {}; }
  const off = Array.isArray(c.off_days) ? c.off_days.filter(d => Number.isInteger(d) && d >= 0 && d <= 6) : [0, 6];
  const hours = Number(c.hours_per_day) > 0 ? Number(c.hours_per_day) : 8;
  const pd = {};
  for (const p of all('SELECT id, name FROM priorities')) {
    const v = c.priority_days?.[p.id];
    const fallback = DEFAULT_DAYS[String(p.name).split(/[\s-]/)[0].toUpperCase()] ?? null;
    pd[p.id] = v === null ? null : Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : fallback;
  }
  return { off_days: off, hours_per_day: hours, priority_days: pd };
}
export function saveCalendar(c) { setSetting(KEY, JSON.stringify(c)); }

const iso = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
export function isWorkingDay(day, cal = calendar(), holidays = holidaySet()) {
  const d = new Date(`${day}T00:00:00Z`);
  return !cal.off_days.includes(d.getUTCDay()) && !holidays.has(day);
}
export const holidaySet = () => new Set(all('SELECT day FROM holidays').map(h => h.day));

// The Nth working day counting the start day (if the start is a working day). N = 1 -> the start day itself.
export function addWorkingDays(start, n, cal = calendar()) {
  if (!start || !(n > 0)) return null;
  const holidays = holidaySet();
  const d = new Date(`${start}T00:00:00Z`);
  let left = n;
  for (let guard = 0; guard < 3660; guard++) {
    const day = iso(d);
    if (isWorkingDay(day, cal, holidays)) { left--; if (left === 0) return day; }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return null;
}

// Due date for a priority from a start date, or null when that priority has no duration set.
export function dueFor(priorityId, start, cal = calendar()) {
  const n = cal.priority_days[priorityId];
  return n ? addWorkingDays(start, n, cal) : null;
}
export const holidaysList = () => all('SELECT id, day, name FROM holidays ORDER BY day');
export const holidayById = (id) => get('SELECT * FROM holidays WHERE id = ?', id);
