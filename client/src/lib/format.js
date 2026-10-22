// Dates: plain dates are "YYYY-MM-DD"; *_at timestamps from the server are UTC "YYYY-MM-DD HH:MM:SS";
// meeting starts_at is local wall-clock "YYYY-MM-DD HH:MM".

export const pad = (n) => String(n).padStart(2, '0');
export const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => isoDate(new Date());
export const parseDate = (s) => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (s, n) => { const d = parseDate(s); d.setDate(d.getDate() + n); return isoDate(d); };
export const diffDays = (a, b) => Math.round((parseDate(a) - parseDate(b)) / 86400000);
export const startOfWeek = (s = today()) => { const d = parseDate(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return isoDate(d); };
export const utc = (s) => (s ? new Date(s.replace(' ', 'T') + (s.length <= 19 ? 'Z' : '')) : null);
export const localDT = (s) => (s ? new Date(s.replace(' ', 'T')) : null);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const DAY_NAMES = DAYS;

export function fmtDate(s, { year } = {}) {
  if (!s) return '';
  const d = parseDate(s);
  const showYear = year ?? d.getFullYear() !== new Date().getFullYear();
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${showYear ? ` ${d.getFullYear()}` : ''}`;
}
export function fmtDay(s) {
  const d = parseDate(s);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
export function fmtTime(s) {
  const d = localDT(s);
  return d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : '';
}
export function fmtMeeting(s) {
  if (!s) return '';
  const date = s.slice(0, 10);
  const t = today();
  const label = date === t ? 'Today' : date === addDays(t, 1) ? 'Tomorrow' : date === addDays(t, -1) ? 'Yesterday' : fmtDay(date);
  return `${label}, ${fmtTime(s)}`;
}
export function fmtDateTime(s) {
  const d = utc(s);
  if (!d) return '';
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function timeAgo(s) {
  const d = utc(s);
  if (!d) return '';
  const sec = Math.round((Date.now() - d.getTime()) / 1000);
  if (sec < 45) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const days = Math.round(h / 24);
  if (days < 7) return `${days} d ago`;
  return fmtDate(isoDate(d));
}
export function dueLabel(due, closed) {
  if (!due) return null;
  const n = diffDays(due, today());
  if (closed) return { text: fmtDate(due), tone: 'muted' };
  if (n < 0) return { text: `${-n} d overdue`, tone: 'danger' };
  if (n === 0) return { text: 'Due today', tone: 'signal' };
  if (n === 1) return { text: 'Due tomorrow', tone: 'signal' };
  if (n <= 7) return { text: `Due ${fmtDay(due)}`, tone: 'normal' };
  return { text: `Due ${fmtDate(due)}`, tone: 'muted' };
}
export const fmtHours = (h) => {
  const n = Number(h || 0);
  return `${Number.isInteger(n) ? n : n.toFixed(n < 10 ? 2 : 1).replace(/0$/, '')} h`;
};
export const fmtSize = (b) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`);
export const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('');

export const PROJECT_STATUS = {
  not_set: { label: 'Not set', color: '#8A93A0' },
  on_track: { label: 'On track', color: '#2F7A4B' },
  at_risk: { label: 'At risk', color: '#C98A1B' },
  off_track: { label: 'Off track', color: '#C2453B' },
  finished: { label: 'Finished', color: '#3B6EA8' },
  discontinued: { label: 'Discontinued', color: '#5B6472' },
};

export const MEETING_KINDS = {
  daily: 'Daily stand-up', weekly: 'Weekly meeting', review: 'Review', planning: 'Planning', other: 'Meeting',
};

// deterministic soft colour for people
const PEOPLE = ['#3B6EA8', '#2F7A6B', '#7A4FA3', '#B5662A', '#2E8A9A', '#9C4F6E', '#5B6B85', '#6E7A2E'];
export const personColor = (id) => PEOPLE[Math.abs(Number(id) || 0) % PEOPLE.length];
