import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api.js';
import { useApp, useLoad } from '../context.jsx';
import Icon from '../components/Icon.jsx';
import { Modal, Field, Loading, ErrorBox, Empty, Person, Key, useAsync, confirmDialog } from '../components/ui.jsx';
import { WpSearchSelect } from './NewWpModal.jsx';
import { today, addDays, startOfWeek, fmtDay, fmtDate, fmtHours, DAY_NAMES, parseDate } from '../lib/format.js';

// Time logged on a task defaults to its current stage: Design, Development or Testing.
const STAGE_ACTIVITY = { design: 'Design', develop: 'Development', testing: 'Testing' };
function stageActivity(wp, activities) {
  const a = STAGE_ACTIVITY[wp?.board_column];
  return a && activities.includes(a) ? a : null;
}

export function LogTimeModal({ wp, entry, projectId, onClose, onSaved, date }) {
  const { meta, projects } = useApp();
  const [f, setF] = useState({
    project_id: entry?.project_id || wp?.project_id || projectId || projects[0]?.id || '',
    wp_id: entry?.wp_id || wp?.id || null,
    spent_on: entry?.spent_on || date || today(),
    hours: entry?.hours ?? '',
    activity: entry?.activity || stageActivity(wp, meta.activities) || meta.activities[0],
    comment: entry?.comment || '',
  });
  const [busy, run] = useAsync();
  const set = (k, v) => setF(s => ({ ...s, [k]: v }));
  const save = async () => {
    const body = { ...f, hours: Number(f.hours) };
    const r = await run(() => (entry ? api.patch(`/time-entries/${entry.id}`, body) : api.post('/time-entries', body)), entry ? 'Time entry updated' : `${fmtHours(body.hours)} logged`);
    if (r) { onSaved?.(); onClose(); }
  };
  return (
    <Modal title={entry ? 'Edit time entry' : wp ? `Log time on ${wp.key}` : 'Log time'} onClose={onClose} onSubmit={save} footer={<>
      <button type="button" className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy || !f.hours}>{entry ? 'Save' : 'Log time'}</button>
    </>}>
      {!wp && (
        <div className="form-grid">
          <Field label="Project">
            <select value={f.project_id} onChange={(e) => { set('project_id', Number(e.target.value)); set('wp_id', null); }}>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Work package" hint="Optional"><WpSearchSelect projectId={f.project_id} value={f.wp_id} onChange={(v) => set('wp_id', v)} /></Field>
        </div>
      )}
      <div className="form-grid three">
        <Field label="Date"><input type="date" value={f.spent_on} max={addDays(today(), 7)} onChange={(e) => set('spent_on', e.target.value)} required /></Field>
        <Field label="Hours" hint="e.g. 1.5 for 1 h 30 min"><input type="number" min="0.25" max="24" step="0.25" value={f.hours} onChange={(e) => set('hours', e.target.value)} required /></Field>
        <Field label="Activity">
          <select value={f.activity} onChange={(e) => set('activity', e.target.value)}>{meta.activities.map(a => <option key={a}>{a}</option>)}</select>
        </Field>
      </div>
      <Field label="Comment"><input type="text" value={f.comment} onChange={(e) => set('comment', e.target.value)} placeholder="What did you work on?" /></Field>
    </Modal>
  );
}

function WeekView({ project, userFilter }) {
  const { user } = useApp();
  const [week, setWeek] = useState(startOfWeek());
  const [modal, setModal] = useState(null);
  const end = addDays(week, 6);
  const uid = userFilter || 'me';
  const { data, loading, reload } = useLoad(() => api.get('/time-entries' + qs({ from: week, to: end, user_id: uid, project_id: project?.id })), [week, uid, project?.id]);
  const days = [...Array(7)].map((_, i) => addDays(week, i));
  const byDay = useMemo(() => {
    const m = Object.fromEntries(days.map(d => [d, []]));
    for (const e of data?.rows || []) m[e.spent_on]?.push(e);
    return m;
  }, [data, week]); // eslint-disable-line react-hooks/exhaustive-deps
  const max = Math.max(8, ...days.map(d => byDay[d].reduce((s, e) => s + e.hours, 0)));
  const canEdit = (e) => e.user_id === user.id;
  return (
    <>
      <div className="row wrap" style={{ marginBottom: 14 }}>
        <button className="btn icon sm" onClick={() => setWeek(addDays(week, -7))} aria-label="Previous week"><Icon name="chevronLeft" /></button>
        <b>{fmtDate(week)} – {fmtDate(end, { year: true })}</b>
        <button className="btn icon sm" onClick={() => setWeek(addDays(week, 7))} aria-label="Next week"><Icon name="chevronRight" /></button>
        {week !== startOfWeek() && <button className="btn sm ghost" onClick={() => setWeek(startOfWeek())}>This week</button>}
        <span className="spacer" />
        <span className="soft">Week total <b className="num" style={{ color: 'var(--ink)' }}>{fmtHours(data?.total || 0)}</b></span>
        {uid === 'me' && <button className="btn primary" onClick={() => setModal({ date: today() >= week && today() <= end ? today() : week })}><Icon name="plus" />Log time</button>}
      </div>
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-body">
          <div className="chart-bars" aria-label="Hours per day">
            {days.map((d, i) => {
              const h = byDay[d].reduce((s, e) => s + e.hours, 0);
              return (
                <div key={d} className={`b${d === today() ? ' today' : ''}`} title={`${fmtDay(d)}: ${fmtHours(h)}`}>
                  <small className="num">{h ? fmtHours(h) : ''}</small>
                  <span style={{ height: `${(h / max) * 70}px` }} />
                  <small>{DAY_NAMES[(i + 1) % 7]}</small>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {loading && !data ? <Loading /> : (
        <div className="panel">
          {days.map(d => (
            <div key={d}>
              <div className={`day-divider row${d === today() ? ' today' : ''}`}>
                <span>{fmtDay(d)}</span><span className="spacer" />
                <span className="num">{fmtHours(byDay[d].reduce((s, e) => s + e.hours, 0))}</span>
                {uid === 'me' && <button className="btn sm ghost" style={{ height: 24 }} onClick={() => setModal({ date: d })}><Icon name="plus" />Add</button>}
              </div>
              {byDay[d].map(e => (
                <div key={e.id} className="child-row" style={{ paddingLeft: 16 }}>
                  {e.wp_key ? <Link to={`/wp/${e.wp_id}`}><Key k={e.wp_key} color={e.project_color} /></Link> : <span className="key" style={{ '--pc': e.project_color }}>{e.project_identifier}</span>}
                  <span className="ellipsis grow">{e.wp_subject || e.comment || e.project_name}{e.wp_subject && e.comment ? <span className="muted">, {e.comment}</span> : null}</span>
                  {uid !== 'me' && <Person id={e.user_id} name={e.user_name} />}
                  <span className="tag">{e.activity}</span>
                  <b className="num" style={{ width: 54, textAlign: 'right' }}>{fmtHours(e.hours)}</b>
                  {canEdit(e) && <button className="icon-btn" aria-label="Edit entry" onClick={() => setModal({ entry: e })}><Icon name="edit" /></button>}
                  {canEdit(e) && <button className="icon-btn" aria-label="Delete entry" onClick={async () => {
                    if (await confirmDialog({ message: `Delete ${fmtHours(e.hours)} on ${fmtDay(e.spent_on)}?`, confirmLabel: 'Delete', danger: true })) { await api.del(`/time-entries/${e.id}`); reload(); }
                  }}><Icon name="trash" /></button>}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {modal && <LogTimeModal projectId={project?.id} date={modal.date} entry={modal.entry} onClose={() => setModal(null)} onSaved={reload} />}
    </>
  );
}

const GROUPS = { user: 'Person', project: 'Project', activity: 'Activity', wp: 'Work package', day: 'Day', week: 'Week', month: 'Month' };

function Report({ project }) {
  const { activeUsers } = useApp();
  const [f, setF] = useState({ rows: 'user', cols: 'week', from: addDays(startOfWeek(), -28), to: today(), user_id: '' });
  const { data, loading, error } = useLoad(() => api.get('/time-entries/report' + qs({ ...f, project_id: project?.id })), [JSON.stringify(f), project?.id]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const { rowLabels, colLabels, cell, rowTotal, colTotal, total } = useMemo(() => {
    const d = data || [];
    const rowLabels = [...new Set(d.map(x => x.row_label))];
    const colLabels = [...new Set(d.map(x => x.col_label))].sort();
    const map = new Map(d.map(x => [`${x.row_label}|${x.col_label}`, x.hours]));
    const rowTotal = (r) => colLabels.reduce((s, c) => s + (map.get(`${r}|${c}`) || 0), 0);
    const colTotal = (c) => rowLabels.reduce((s, r) => s + (map.get(`${r}|${c}`) || 0), 0);
    return { rowLabels, colLabels, cell: (r, c) => map.get(`${r}|${c}`), rowTotal, colTotal, total: d.reduce((s, x) => s + x.hours, 0) };
  }, [data]);
  const csv = () => {
    const lines = [[GROUPS[f.rows], ...colLabels, 'Total'].join(',')];
    for (const r of rowLabels) lines.push([`"${String(r).replace(/"/g, '""')}"`, ...colLabels.map(c => cell(r, c) || 0), rowTotal(r).toFixed(2)].join(','));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `time-report-${f.from}-to-${f.to}.csv`; a.click();
  };
  return (
    <>
      <div className="filterbar">
        <label className="small soft">Rows</label>
        <select value={f.rows} onChange={set('rows')}>{Object.entries(GROUPS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <label className="small soft">Columns</label>
        <select value={f.cols} onChange={set('cols')}>{Object.entries(GROUPS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <input type="date" value={f.from} onChange={set('from')} aria-label="From" />
        <input type="date" value={f.to} onChange={set('to')} aria-label="To" />
        <select value={f.user_id} onChange={set('user_id')} aria-label="Person"><option value="">Everyone I can see</option>{activeUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
        <span className="spacer" />
        <button className="btn sm" onClick={csv} disabled={!rowLabels.length}><Icon name="download" />Export CSV</button>
      </div>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : !rowLabels.length ? <div className="panel"><Empty title="No time logged in this period">Pick a wider date range or another person.</Empty></div> : (
        <div className="panel table-wrap">
          <table className="table compact">
            <thead><tr><th>{GROUPS[f.rows]}</th>{colLabels.map(c => <th key={c} className="num">{c}</th>)}<th className="num">Total</th></tr></thead>
            <tbody>
              {rowLabels.map(r => (
                <tr key={r}><td className="ellipsis" style={{ maxWidth: 320 }}>{r}</td>{colLabels.map(c => <td key={c} className="num">{cell(r, c) ? cell(r, c).toFixed(2) : ''}</td>)}<td className="num"><b>{rowTotal(r).toFixed(2)}</b></td></tr>
              ))}
              <tr className="group-row"><td>Total</td>{colLabels.map(c => <td key={c} className="num">{colTotal(c).toFixed(2)}</td>)}<td className="num">{total.toFixed(2)}</td></tr>
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export default function Time({ project }) {
  const { activeUsers } = useApp();
  const [tab, setTab] = useState('week');
  const [person, setPerson] = useState('');
  const canSeeOthers = project ? project.permissions.includes('time.view_all') : true;
  return (
    <div className="content">
      {!project && <div className="page-head"><div className="grow"><h1>Time</h1><p>Log hours against projects and tasks, and see where the team's time goes.</p></div></div>}
      <div className="row wrap" style={{ marginBottom: 16 }}>
        <div className="subtabs">
          <button className={tab === 'week' ? 'active' : ''} onClick={() => setTab('week')}>Timesheet</button>
          <button className={tab === 'report' ? 'active' : ''} onClick={() => setTab('report')}>Report</button>
        </div>
        {tab === 'week' && canSeeOthers && (
          <select value={person} onChange={(e) => setPerson(e.target.value)} style={{ width: 'auto', height: 30, fontSize: 13 }} aria-label="Whose timesheet">
            <option value="">My timesheet</option>{activeUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        )}
      </div>
      {tab === 'week' ? <WeekView project={project} userFilter={person || undefined} /> : <Report project={project} />}
    </div>
  );
}

export { parseDate };
