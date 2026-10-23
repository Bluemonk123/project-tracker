import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useApp, useLoad } from '../context.jsx';
import Icon from '../components/Icon.jsx';
import { Loading, ErrorBox, StatusPill, Due, Key, Empty, Person, TypeLabel } from '../components/ui.jsx';
import NewWpModal from './NewWpModal.jsx';
import { LogTimeModal } from './Time.jsx';
import { addDays, fmtHours, fmtTime, fmtDay, MEETING_KINDS, timeAgo, DAY_NAMES } from '../lib/format.js';

function bucket(due, today) {
  if (!due) return 'No finish date';
  if (due < today) return 'Overdue';
  if (due === today) return 'Today';
  if (due <= addDays(today, 7)) return 'Next 7 days';
  return 'Later';
}
const ORDER = ['Overdue', 'Today', 'Next 7 days', 'Later', 'No finish date'];

export function ActivityItem({ a }) {
  let changes = {};
  try { changes = JSON.parse(a.changes || '{}') || {}; } catch { /* ignore */ }
  const what = changes.created ? 'created' : a.notes && !Object.keys(changes).length ? 'commented on' : changes.status_id ? 'changed the status of' : 'updated';
  return (
    <li>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="small"><b>{a.user_name || 'Someone'}</b> {what} <Link to={`/wp/${a.wp_id}`}>{a.key}</Link></div>
        <div className="ellipsis small soft">{a.subject}</div>
      </div>
      <span className="xs muted nowrap">{timeAgo(a.created_at)}</span>
    </li>
  );
}

export default function MyPage() {
  const { user, projects } = useApp();
  const { data, error, loading, reload } = useLoad(() => api.get('/dashboard'), []);
  const [modal, setModal] = useState(null);
  if (loading && !data) return <div className="content"><Loading /></div>;
  if (error) return <div className="content"><ErrorBox error={error} /></div>;
  const t = data.today;
  const groups = ORDER.map(k => ({ k, rows: data.myWork.filter(w => bucket(w.due_date, t) === k) })).filter(g => g.rows.length);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const weekDays = [...Array(5)].map((_, i) => addDays(data.weekStart, i));
  const hoursFor = (d) => data.hours.find(h => h.spent_on === d)?.hours || 0;
  const weekTotal = data.hours.reduce((s, h) => s + h.hours, 0);

  return (
    <div className="content">
      <div className="page-head">
        <div className="grow">
          <h1>{greeting}, {user.name.split(' ')[0]}</h1>
          <p>{fmtDay(t)}. {data.counts.overdue ? `${data.counts.overdue} of your items are overdue.` : data.counts.open ? 'Nothing of yours is overdue.' : 'You have no open work assigned.'}</p>
        </div>
        <div className="head-actions">
          <button className="btn" onClick={() => setModal('time')}><Icon name="clock" />Log time</button>
          {projects.length > 0 && <button className="btn primary" onClick={() => setModal('wp')}><Icon name="plus" />New task</button>}
        </div>
      </div>

      <div className="figures">
        <Link className="figure" to="/work-packages?assignee_id=me"><div className="n">{data.counts.open}</div><div className="l">Open and assigned to me</div></Link>
        <Link className={`figure${data.counts.overdue ? ' danger' : ''}`} to="/work-packages?assignee_id=me&overdue=1"><div className="n">{data.counts.overdue}</div><div className="l">Overdue</div></Link>
        <div className={`figure${data.counts.dueToday ? ' signal' : ''}`}><div className="n">{data.counts.dueToday}</div><div className="l">Due today</div></div>
        <div className="figure"><div className="n">{data.counts.dueWeek}</div><div className="l">Due in the next 7 days</div></div>
        <Link className="figure" to="/time"><div className="n">{fmtHours(weekTotal)}</div><div className="l">Logged this week</div></Link>
      </div>

      <div className="split">
        <div className="stack" style={{ gap: 20 }}>
          <section className="panel">
            <div className="panel-head"><h3>My work</h3><div className="actions"><Link to="/work-packages?assignee_id=me" className="small">Open full list</Link></div></div>
            {!groups.length ? <Empty small title="All clear">Nothing is assigned to you right now.</Empty> : groups.map(g => (
              <div key={g.k}>
                <div className={`day-divider${g.k === 'Overdue' ? ' today' : ''}`} style={g.k === 'Overdue' ? { color: 'var(--danger)' } : undefined}>{g.k} <span className="muted">({g.rows.length})</span></div>
                <ul className="list">
                  {g.rows.map(w => (
                    <li key={w.id}>
                      <Key k={w.key} color={w.project_color} />
                      <div className="grow" style={{ minWidth: 0 }}>
                        <Link to={`/wp/${w.id}`} className="ellipsis" style={{ color: 'var(--ink)', display: 'block' }}>{w.subject}</Link>
                        <span className="xs muted"><TypeLabel name={w.type_name} color={w.type_color} />{'  '}{w.project_name}</span>
                      </div>
                      <span className="hide-sm"><StatusPill name={w.status_name} color={w.status_color} /></span>
                      <span style={{ width: 110, textAlign: 'right' }}><Due date={w.due_date} /></span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>

          {data.accountable.length > 0 && (
            <section className="panel">
              <div className="panel-head"><h3>I'm accountable for</h3><div className="actions"><span className="small muted">Work others are doing that you answer for</span></div></div>
              <ul className="list">
                {data.accountable.map(w => (
                  <li key={w.id}>
                    <Key k={w.key} color={w.project_color} />
                    <Link to={`/wp/${w.id}`} className="ellipsis grow" style={{ color: 'var(--ink)' }}>{w.subject}</Link>
                    <Person name={w.assignee_name} muted="Unassigned" />
                    <StatusPill name={w.status_name} color={w.status_color} />
                    <span style={{ width: 100, textAlign: 'right' }}><Due date={w.due_date} /></span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <div className="stack" style={{ gap: 20 }}>
          <section className="panel">
            <div className="panel-head"><h3>My meetings this week</h3><div className="actions"><Link to="/meetings" className="small">All meetings</Link></div></div>
            {!data.meetings.length ? <Empty small>No meetings in the next 7 days.</Empty> : (
              <ul className="list">
                {data.meetings.map(m => (
                  <li key={m.id} style={{ borderLeft: `3px solid ${m.project_color || 'var(--line)'}` }}>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <Link to={`/meetings/${m.id}`} className="ellipsis" style={{ display: 'block', color: 'var(--ink)', fontWeight: 520 }}>{m.title}</Link>
                      <span className="xs muted">{MEETING_KINDS[m.kind]}{m.location ? `, ${m.location}` : ''}</span>
                    </div>
                    <div style={{ textAlign: 'right' }} className="small">
                      <div className={m.starts_at.slice(0, 10) === t ? 'signal-text' : ''} style={{ fontWeight: 600 }}>{m.starts_at.slice(0, 10) === t ? 'Today' : fmtDay(m.starts_at.slice(0, 10))}</div>
                      <div className="muted num">{fmtTime(m.starts_at)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel">
            <div className="panel-head"><h3>My hours this week</h3><div className="actions"><b className="num">{fmtHours(weekTotal)}</b></div></div>
            <div className="panel-body">
              <div className="chart-bars">
                {weekDays.map((d, i) => (
                  <div key={d} className={`b${d === t ? ' today' : ''}`} title={`${fmtHours(hoursFor(d))}`}>
                    <small className="num">{hoursFor(d) ? hoursFor(d) : ''}</small>
                    <span style={{ height: `${Math.min(hoursFor(d), 10) * 7}px` }} />
                    <small>{DAY_NAMES[i + 1]}</small>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head"><h3>Latest activity</h3></div>
            {!data.activity.length ? <Empty small>No activity yet.</Empty> : <ul className="list">{data.activity.slice(0, 10).map(a => <ActivityItem key={a.id} a={a} />)}</ul>}
          </section>
        </div>
      </div>
      {modal === 'wp' && <NewWpModal onClose={() => setModal(null)} onCreated={reload} defaults={{ assignee_id: user.id }} />}
      {modal === 'time' && <LogTimeModal onClose={() => setModal(null)} onSaved={reload} />}
    </div>
  );
}
