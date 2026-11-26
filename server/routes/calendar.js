// Time -> Working calendar: priority durations, weekly off days, daily hours, holidays.
import { Router } from 'express';
import { all, get, run } from '../db.js';
import { need, fail } from '../access.js';
import { calendar, saveCalendar, holidaysList } from '../calendar.js';

const r = Router();
const DAY = /^\d{4}-\d{2}-\d{2}$/;

r.get('/work-calendar', (req, res) => {
  res.json({ ...calendar(), holidays: holidaysList(), priorities: all('SELECT id, name, color, position FROM priorities WHERE no_timeline = 0 ORDER BY position DESC') });
});

r.put('/work-calendar', (req, res) => {
  need(req, 'admin.settings');
  const b = req.body || {};
  const off = [...new Set((b.off_days || []).map(Number))].filter(d => Number.isInteger(d) && d >= 0 && d <= 6);
  if (off.length >= 7) fail(400, 'At least one day of the week must be a working day.');
  const hours = Number(b.hours_per_day);
  if (!(hours > 0 && hours <= 24)) fail(400, 'Daily working hours must be between 0 and 24.');
  const pd = {};
  for (const p of all('SELECT id, name, no_timeline FROM priorities')) {
    if (p.no_timeline) { pd[p.id] = null; continue; }
    const v = b.priority_days?.[p.id];
    if (v === null || v === '' || v === undefined) { pd[p.id] = null; continue; }
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 365) fail(400, `${p.name}: enter whole working days from 1 to 365, or leave it empty.`);
    pd[p.id] = n;
  }
  saveCalendar({ off_days: off, hours_per_day: Math.round(hours * 100) / 100, priority_days: pd });
  res.json({ ok: true });
});

r.post('/holidays', (req, res) => {
  need(req, 'admin.settings');
  const day = String(req.body.day || '');
  const name = String(req.body.name || '').trim().slice(0, 80);
  if (!DAY.test(day)) fail(400, 'Choose the holiday date.');
  if (!name) fail(400, 'Name the holiday.');
  if (get('SELECT id FROM holidays WHERE day = ?', day)) fail(400, 'That date is already a holiday.');
  res.status(201).json({ id: run('INSERT INTO holidays(day, name) VALUES(?, ?)', day, name).id, holidays: holidaysList() });
});

r.delete('/holidays/:id', (req, res) => {
  need(req, 'admin.settings');
  run('DELETE FROM holidays WHERE id = ?', Number(req.params.id));
  res.json({ ok: true, holidays: holidaysList() });
});

export default r;
