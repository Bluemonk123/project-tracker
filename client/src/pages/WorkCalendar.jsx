// Time -> Working calendar: how many working days each priority allows, weekly off days, daily hours, holidays.
import { useState } from 'react';
import { api } from '../api.js';
import { useApp, useLoad } from '../context.jsx';
import Icon from '../components/Icon.jsx';
import { Loading, ErrorBox, Field, useAsync, confirmDialog } from '../components/ui.jsx';
import { fmtDate } from '../lib/format.js';

const DAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']];

export default function WorkCalendar() {
  const { data, error, loading, reload } = useLoad(() => api.get('/work-calendar'), []);
  if (error) return <ErrorBox error={error} />;
  if (loading && !data) return <Loading />;
  return <CalendarForm key={JSON.stringify(data)} data={data} onSaved={reload} />;
}

function CalendarForm({ data, onSaved }) {
  const { can } = useApp();
  const canEdit = can('admin.settings');
  const [off, setOff] = useState(data.off_days);
  const [hours, setHours] = useState(data.hours_per_day);
  const [pd, setPd] = useState(data.priority_days);
  const [hol, setHol] = useState({ day: '', name: '' });
  const [busy, run] = useAsync();
  const save = async (e) => { e.preventDefault(); if (await run(() => api.put('/work-calendar', { off_days: off, hours_per_day: Number(hours), priority_days: pd }), 'Working calendar saved')) onSaved(); };
  const addHoliday = async (e) => { e.preventDefault(); if (await run(() => api.post('/holidays', hol), 'Holiday added')) { setHol({ day: '', name: '' }); onSaved(); } };
  const delHoliday = async (h) => {
    if (await confirmDialog({ message: `Remove the holiday “${h.name}” on ${fmtDate(h.day)}?`, confirmLabel: 'Remove', danger: true }) && await run(() => api.del(`/holidays/${h.id}`), 'Holiday removed')) onSaved();
  };
  const upcoming = data.holidays.filter(h => h.day >= new Date().toISOString().slice(0, 10));
  const past = data.holidays.length - upcoming.length;
  return (
    <div className="stack" style={{ gap: 18, maxWidth: 860 }}>
      <div className="info-box">A new task starts the day it is created and is due after its priority's number of <b>working days</b> (counting the start day, skipping weekly off days and holidays). Changing a task's priority sets its due date again; the due date can always be changed by hand, which never changes the priority.{!canEdit && ' Only administrators can change these settings.'}</div>
      <form className="panel" onSubmit={save}>
        <div className="panel-head"><h3>Priority durations</h3><span className="xs muted">Working days to finish a task of each priority. Leave empty for no automatic due date.</span></div>
        <div className="panel-body row wrap" style={{ gap: 16 }}>
          {data.priorities.map(p => (
            <Field key={p.id} label={p.name}>
              <div className="row" style={{ gap: 6 }}>
                <input type="number" min={1} max={365} step={1} value={pd[p.id] ?? ''} disabled={!canEdit} style={{ width: 90 }}
                  onChange={(e) => setPd({ ...pd, [p.id]: e.target.value === '' ? null : Number(e.target.value) })} />
                <span className="small muted">days</span>
              </div>
            </Field>
          ))}
        </div>
        <div className="panel-head" style={{ borderTop: '1px solid var(--line-2)' }}><h3>Working week</h3></div>
        <div className="panel-body stack">
          <Field label="Weekly off days">
            <div className="row wrap" style={{ gap: 6 }}>
              {DAYS.map(([d, l]) => (
                <label key={d} className={`wc-day${off.includes(d) ? ' off' : ''}`}>
                  <input type="checkbox" checked={off.includes(d)} disabled={!canEdit} onChange={(e) => setOff(e.target.checked ? [...off, d] : off.filter(x => x !== d))} />{l}
                </label>
              ))}
            </div>
          </Field>
          <Field label="Daily working hours" hint={`A working week is ${(7 - off.length) * (Number(hours) || 0)} hours.`}>
            <input type="number" min={0.5} max={24} step={0.5} value={hours} disabled={!canEdit} onChange={(e) => setHours(e.target.value)} style={{ width: 110 }} />
          </Field>
        </div>
        {canEdit && <div className="modal-foot"><button className="btn primary" disabled={busy}>Save working calendar</button></div>}
      </form>

      <section className="panel">
        <div className="panel-head"><h3>Holidays</h3><span className="xs muted">{upcoming.length} upcoming{past ? `, ${past} past` : ''}</span></div>
        {!data.holidays.length ? <div className="panel-body small muted">No holidays yet.</div> : (
          <ul className="list">
            {data.holidays.map(h => (
              <li key={h.id} className={h.day < new Date().toISOString().slice(0, 10) ? 'muted' : ''}>
                <span className="num" style={{ width: 120 }}>{fmtDate(h.day)}</span>
                <span className="xs muted" style={{ width: 40 }}>{new Date(`${h.day}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short' })}</span>
                <span className="grow">{h.name}</span>
                {canEdit && <button type="button" className="icon-btn" aria-label={`Remove ${h.name}`} onClick={() => delHoliday(h)}><Icon name="trash" size={15} /></button>}
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <form className="panel-body row wrap" onSubmit={addHoliday} style={{ borderTop: '1px solid var(--line-2)', gap: 8 }}>
            <input type="date" required value={hol.day} onChange={(e) => setHol({ ...hol, day: e.target.value })} style={{ width: 170 }} />
            <input type="text" required maxLength={80} placeholder="Holiday name, e.g. Diwali" value={hol.name} onChange={(e) => setHol({ ...hol, name: e.target.value })} style={{ maxWidth: 280 }} />
            <button className="btn" disabled={busy}><Icon name="plus" />Add holiday</button>
          </form>
        )}
      </section>
    </div>
  );
}
