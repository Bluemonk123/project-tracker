import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useApp, useLoad } from '../context.jsx';
import Icon from '../components/Icon.jsx';
import {
  Loading, ErrorBox, Empty, Avatar, Person, StatusPill, Due, Markdown, MarkdownEditor, Modal, Field, MultiUserPicker,
  UserSelect, useAsync, confirmDialog, MoreMenu, Key,
} from '../components/ui.jsx';
import { WpSearchSelect, useProjectInfo } from './NewWpModal.jsx';
import { fmtDay, fmtTime, fmtDate, fmtHours, fmtSize, MEETING_KINDS, addDays, timeAgo } from '../lib/format.js';

function EditMeetingModal({ m, onClose, onSaved }) {
  const [f, setF] = useState({ title: m.title, kind: m.kind, starts_at: m.starts_at.replace(' ', 'T'), duration_minutes: m.duration_minutes, location: m.location || '' });
  const [scope, setScope] = useState('this');
  const [busy, run] = useAsync();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => { if (await run(() => api.patch(`/meetings/${m.id}`, { ...f, apply_to: scope === 'future' ? 'future' : undefined }), 'Meeting updated')) { onSaved(); onClose(); } };
  return (
    <Modal title="Edit meeting" onClose={onClose} onSubmit={save} footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>Save</button></>}>
      <div className="form-grid">
        <Field label="Title" className="span-2"><input type="text" value={f.title} onChange={set('title')} required /></Field>
        <Field label="Type"><select value={f.kind} onChange={set('kind')}>{Object.entries(MEETING_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Where"><input type="text" value={f.location} onChange={set('location')} /></Field>
        <Field label="Starts"><input type="datetime-local" value={f.starts_at} onChange={set('starts_at')} required /></Field>
        <Field label="Duration (minutes)"><input type="number" min="5" step="5" value={f.duration_minutes} onChange={set('duration_minutes')} /></Field>
      </div>
      {m.series_id && (
        <Field label="Apply changes to">
          <div className="row wrap">
            <label className="check"><input type="radio" checked={scope === 'this'} onChange={() => setScope('this')} />Only this meeting</label>
            <label className="check"><input type="radio" checked={scope === 'future'} onChange={() => setScope('future')} />This and following meetings in the series</label>
          </div>
        </Field>
      )}
    </Modal>
  );
}

function CopyModal({ m, onClose }) {
  const nav = useNavigate();
  const next = m.kind === 'weekly' ? addDays(m.starts_at.slice(0, 10), 7) : addDays(m.starts_at.slice(0, 10), 1);
  const [when, setWhen] = useState(`${next}T${m.starts_at.slice(11, 16)}`);
  const [all, setAll] = useState(false);
  const [busy, run] = useAsync();
  const save = async () => { const r = await run(() => api.post(`/meetings/${m.id}/copy`, { starts_at: when, copy_all_agenda: all }), 'Follow-up meeting created'); if (r) { onClose(); nav(`/meetings/${r.id}`); } };
  return (
    <Modal title="Schedule a follow-up" onClose={onClose} onSubmit={save} footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>Create follow-up</button></>}>
      <p className="soft small" style={{ margin: 0 }}>Copies the participants and every agenda item that is not ticked off yet.</p>
      <Field label="Starts"><input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required /></Field>
      <label className="check"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />Copy finished agenda items too</label>
    </Modal>
  );
}

function StandupForm({ m, mine, onSaved }) {
  const [f, setF] = useState({ yesterday: mine?.yesterday || '', today: mine?.today || '', blockers: mine?.blockers || '' });
  const [sug, setSug] = useState(null);
  const [busy, run] = useAsync();
  useEffect(() => { api.get(`/meetings/${m.id}/standup-suggestions`).then(setSug).catch(() => {}); }, [m.id]);
  const fill = () => {
    if (!sug) return;
    setF(s => ({
      yesterday: s.yesterday || sug.done.map(w => `${w.key} ${w.subject} (${w.status_name})`).join('\n'),
      today: s.today || sug.doing.slice(0, 5).map(w => `${w.key} ${w.subject}`).join('\n'),
      blockers: s.blockers,
    }));
  };
  const save = async () => { if (await run(() => api.put(`/meetings/${m.id}/standup`, f), 'Update saved')) onSaved(); };
  return (
    <div className="standup-card" style={{ borderColor: 'var(--accent)' }}>
      <div className="row"><b>Your update</b><span className="spacer" />
        {sug && (sug.done.length > 0 || sug.doing.length > 0) && <button className="btn sm ghost" onClick={fill} type="button">Fill from my work</button>}
      </div>
      <div className="form-grid three" style={{ marginTop: 10 }}>
        <Field label="Since last stand-up"><textarea rows={3} value={f.yesterday} onChange={(e) => setF({ ...f, yesterday: e.target.value })} placeholder="What you finished or moved forward" /></Field>
        <Field label="Today"><textarea rows={3} value={f.today} onChange={(e) => setF({ ...f, today: e.target.value })} placeholder="What you plan to do" /></Field>
        <Field label="Blockers"><textarea rows={3} value={f.blockers} onChange={(e) => setF({ ...f, blockers: e.target.value })} placeholder="Anything stopping you? The organiser is notified." /></Field>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn primary sm" disabled={busy} onClick={save}>{mine ? 'Update' : 'Post update'}</button>
        {sug && <span className="xs muted">You logged {fmtHours(sug.hours)} since {fmtDay(sug.since.slice(0, 10))}.</span>}
      </div>
    </div>
  );
}

function ReviewSummary({ m }) {
  const { data } = useLoad(() => api.get(`/meetings/${m.id}/summary`), [m.id]);
  if (!data) return null;
  const block = (title, rows, render, empty) => (
    <div>
      <div className="small soft" style={{ fontWeight: 600, marginBottom: 6 }}>{title} <span className="muted">({rows.length})</span></div>
      {rows.length ? <div className="stack tight">{rows.slice(0, 8).map(render)}</div> : <div className="xs muted">{empty}</div>}
      {rows.length > 8 && <div className="xs muted" style={{ marginTop: 4 }}>and {rows.length - 8} more</div>}
    </div>
  );
  const wpLine = (w, extra) => (
    <div key={w.id} className="row small"><Link to={`/wp/${w.id}`} className="key plain">{w.key}</Link><span className="ellipsis grow">{w.subject}</span>{extra}</div>
  );
  return (
    <section className="panel">
      <div className="panel-head"><h3>Review: {fmtDate(data.from)} to {fmtDate(data.to)}</h3><div className="actions"><span className="xs muted">Generated from the project's activity</span></div></div>
      <div className="panel-body grid-2">
        {block('Finished in this period', data.closed, (w) => wpLine(w, <span className="xs muted">{w.assignee_name}</span>), 'Nothing was closed.')}
        {block('Overdue now', data.overdue, (w) => wpLine(w, <Due date={w.due_date} />), 'Nothing is overdue.')}
        {block('Due in the next 7 days', data.dueSoon, (w) => wpLine(w, <Due date={w.due_date} />), 'Nothing due soon.')}
        <div>
          <div className="small soft" style={{ fontWeight: 600, marginBottom: 6 }}>Hours logged <span className="muted">({fmtHours(data.hours.reduce((s, h) => s + h.hours, 0))})</span></div>
          {data.hours.length ? data.hours.map(h => <div key={h.name} className="row small"><span className="grow">{h.name}</span><span className="num">{fmtHours(h.hours)}</span></div>) : <div className="xs muted">No time logged.</div>}
          <div className="xs muted" style={{ marginTop: 6 }}>{data.created} new work packages created</div>
        </div>
        {data.blockers.length > 0 && <div className="span-2" style={{ gridColumn: '1 / -1' }}>
          <div className="small soft" style={{ fontWeight: 600, marginBottom: 6 }}>Blockers raised in stand-ups</div>
          {data.blockers.map((b, i) => <div key={i} className="small"><b>{b.name}:</b> {b.blockers}</div>)}
        </div>}
      </div>
    </section>
  );
}

function AgendaItem({ item, index, m, canManage, onChange, members, first, last }) {
  const { user } = useApp();
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState(item.outcome || '');
  const [, run] = useAsync();
  const patch = async (body) => { if (await run(() => api.patch(`/meetings/${m.id}/agenda/${item.id}`, body))) onChange(); };
  const canOutcome = canManage || m.is_participant;
  return (
    <div className={`agenda-item${item.done ? ' done' : ''}`}>
      <span className="n">{item.done ? '✓' : index + 1}</span>
      <div style={{ minWidth: 0 }}>
        <div className="row wrap">
          <span className="title" style={{ fontWeight: 560 }}>{item.title}</span>
          {item.duration ? <span className="xs muted">{item.duration} min</span> : null}
          {item.presenter_name && <span className="xs muted">by {item.presenter_name}</span>}
        </div>
        {item.wp_id && (
          <div className="row small" style={{ marginTop: 4 }}>
            <Link to={`/wp/${item.wp_id}`} className="key plain">{item.wp_key}</Link>
            <span className="ellipsis">{item.wp_subject}</span>
            <StatusPill name={item.wp_status} color={item.wp_status_color} />
            {item.wp_assignee && <span className="xs muted">{item.wp_assignee}</span>}
          </div>
        )}
        {item.notes && <div className="small soft" style={{ marginTop: 4 }}><Markdown text={item.notes} /></div>}
        {item.outcome && !open && <div className="small" style={{ marginTop: 6, padding: '6px 10px', background: 'var(--surface-2)', borderRadius: 6 }}><b>Outcome:</b> <Markdown text={item.outcome} /></div>}
        {open && (
          <div className="stack tight" style={{ marginTop: 8 }}>
            <textarea rows={2} value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="Decision or outcome for this item" autoFocus />
            {canManage && (
              <div className="row wrap">
                <span className="small soft">Presenter</span>
                <span style={{ width: 200 }}><UserSelect value={item.presenter_id} onChange={(v) => patch({ presenter_id: v })} users={members} placeholder="Nobody" /></span>
                <span className="small soft">Minutes</span>
                <input type="number" style={{ width: 80 }} defaultValue={item.duration || ''} onBlur={(e) => patch({ duration: e.target.value || null })} />
              </div>
            )}
            <div className="row"><button className="btn sm primary" onClick={async () => { await patch({ outcome }); setOpen(false); }}>Save</button><button className="btn sm" onClick={() => setOpen(false)}>Cancel</button></div>
          </div>
        )}
      </div>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        {canOutcome && !open && <button className="btn sm ghost" onClick={() => setOpen(true)}>{item.outcome ? 'Edit' : 'Add outcome'}</button>}
        {canManage && <label className="check small" title="Mark as discussed"><input type="checkbox" checked={!!item.done} onChange={(e) => patch({ done: e.target.checked })} /></label>}
        {canManage && (
          <MoreMenu>
            {!first && <button className="menu-item" onClick={() => onChange('up', item)}>Move up</button>}
            {!last && <button className="menu-item" onClick={() => onChange('down', item)}>Move down</button>}
            <button className="menu-item danger" onClick={async () => { if (await run(() => api.del(`/meetings/${m.id}/agenda/${item.id}`))) onChange(); }}>Remove</button>
          </MoreMenu>
        )}
        {!canManage && item.presenter_id === user.id ? null : null}
      </div>
    </div>
  );
}

export default function MeetingDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user, meta } = useApp();
  const { data: m, error, loading, reload } = useLoad(() => api.get(`/meetings/${id}`), [id]);
  const info = useProjectInfo(m?.project_id);
  const [modal, setModal] = useState(null);
  const [minutes, setMinutes] = useState(null);
  const [newItem, setNewItem] = useState({ title: '', wp_id: null });
  const [action, setAction] = useState({ subject: '', assignee_id: null, due_date: '', type_id: '' });
  const [busy, run] = useAsync();
  useEffect(() => { setMinutes(null); }, [id]);
  useEffect(() => { if (m) document.title = m.title; }, [m]);

  if (loading && !m) return <div className="content"><Loading /></div>;
  if (error) return <div className="content"><ErrorBox error={error} /></div>;
  const canManage = m.can.manage;
  const members = (info?.members || []).filter(x => x.status === 'active').map(x => ({ id: x.user_id, name: x.name }));
  const mine = m.standups.find(s => s.user_id === user.id);
  const notUpdated = m.participants.filter(p => !m.standups.some(s => s.user_id === p.id));
  const isDaily = m.kind === 'daily';
  const editingMinutes = minutes !== null;

  const setStatus = async (status) => { if (await run(() => api.patch(`/meetings/${m.id}`, { status }), status === 'closed' ? 'Meeting closed. Participants were notified that the minutes are ready.' : status === 'in_progress' ? 'Meeting started' : 'Meeting reopened')) reload(); };
  const saveMinutes = async () => { if (await run(() => api.patch(`/meetings/${m.id}`, { minutes }), 'Minutes saved')) { setMinutes(null); reload(); } };
  const addItem = async (e) => {
    e?.preventDefault();
    if (!newItem.title.trim() && !newItem.wp_id) return;
    if (await run(() => api.post(`/meetings/${m.id}/agenda`, newItem))) { setNewItem({ title: '', wp_id: null }); reload(); }
  };
  const addAction = async (e) => {
    e?.preventDefault();
    if (!action.subject.trim()) return;
    const body = { ...action, type_id: action.type_id || undefined, due_date: action.due_date || null };
    if (await run(() => api.post(`/meetings/${m.id}/actions`, body), 'Action item created as a work package')) { setAction({ subject: '', assignee_id: null, due_date: '', type_id: '' }); reload(); }
  };
  const agendaChange = async (dir, item) => {
    if (!dir) return reload();
    const ids = m.agenda.map(a => a.id);
    const i = ids.indexOf(item.id);
    const j = dir === 'up' ? i - 1 : i + 1;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    if (await run(() => api.put(`/meetings/${m.id}/agenda-order`, { ids }))) reload();
  };
  const del = async () => {
    const series = m.series_id && m.series?.count > 1;
    if (series) {
      setModal('delete');
      return;
    }
    if (!await confirmDialog({ message: `Delete “${m.title}” on ${fmtDay(m.starts_at.slice(0, 10))}?`, confirmLabel: 'Delete meeting', danger: true })) return;
    if (await run(() => api.del(`/meetings/${m.id}`), 'Meeting deleted')) nav(m.project_identifier ? `/projects/${m.project_identifier}/meetings` : '/meetings');
  };
  const total = m.agenda.reduce((s, a) => s + (a.duration || 0), 0);

  return (
    <div className="content" style={{ '--pc': m.project_color }}>
      <div className="breadcrumbs">
        {m.project_identifier ? <><Link to={`/projects/${m.project_identifier}`}><span className="key" style={{ '--pc': m.project_color }}>{m.project_name}</span></Link><span>/</span><Link to={`/projects/${m.project_identifier}/meetings`}>Meetings</Link></>
          : <Link to="/meetings">Meetings</Link>}
      </div>
      <div className="page-head">
        <div className="grow">
          <div className="row wrap" style={{ marginBottom: 4 }}>
            <span className="tag accent">{MEETING_KINDS[m.kind]}</span>
            {m.status === 'closed' ? <span className="tag ok">Closed, minutes shared</span> : m.status === 'in_progress' ? <span className="tag signal">In progress</span> : <span className="tag">Open</span>}
          </div>
          <h1>{m.title}</h1>
          <p>
            <b style={{ color: 'var(--ink)' }}>{fmtDay(m.starts_at.slice(0, 10))}, {fmtTime(m.starts_at)}</b> for {m.duration_minutes} minutes
            {m.location ? `, ${m.location}` : ''}. Organised by {m.created_by_name || 'someone'}.
          </p>
          {m.series && (
            <div className="row small" style={{ marginTop: 6 }}>
              {m.series.prev ? <Link className="btn sm" to={`/meetings/${m.series.prev.id}`}><Icon name="chevronLeft" />{fmtDate(m.series.prev.starts_at.slice(0, 10))}</Link> : null}
              <span className="muted">Part of a series of {m.series.count}</span>
              {m.series.next ? <Link className="btn sm" to={`/meetings/${m.series.next.id}`}>{fmtDate(m.series.next.starts_at.slice(0, 10))}<Icon name="chevronRight" /></Link> : null}
            </div>
          )}
        </div>
        <div className="head-actions">
          {canManage && m.status === 'open' && <button className="btn" onClick={() => setStatus('in_progress')}><Icon name="play" />Start meeting</button>}
          {canManage && m.status !== 'closed' && <button className="btn primary" onClick={() => setStatus('closed')}><Icon name="check" />Close and share minutes</button>}
          {canManage && m.status === 'closed' && <button className="btn" onClick={() => setStatus('open')}>Reopen</button>}
          <MoreMenu>
            <button className="menu-item" onClick={() => window.print()}><Icon name="printer" size={16} />Print minutes</button>
            {canManage && <button className="menu-item" onClick={() => setModal('edit')}><Icon name="edit" size={16} />Edit details</button>}
            {canManage && <button className="menu-item" onClick={() => setModal('copy')}><Icon name="copy" size={16} />Schedule follow-up</button>}
            {canManage && <><div className="menu-sep" /><button className="menu-item danger" onClick={del}><Icon name="trash" size={16} />Delete</button></>}
          </MoreMenu>
        </div>
      </div>

      <div className="split">
        <div className="stack" style={{ gap: 20 }}>
          {isDaily && (
            <section className="panel">
              <div className="panel-head"><h3>Stand-up updates</h3><div className="actions"><span className="small muted">{m.standups.length} of {m.participants.length} posted</span></div></div>
              <div className="panel-body stack">
                {m.is_participant && m.status !== 'closed' && <StandupForm key={mine?.updated_at || 'new'} m={m} mine={mine} onSaved={reload} />}
                {m.standups.filter(s => s.user_id !== user.id || m.status === 'closed' || !m.is_participant).map(s => (
                  <div key={s.id} className={`standup-card${s.blockers?.trim() ? ' blocked' : ''}`}>
                    <div className="row"><Person id={s.user_id} name={s.user_name} /><span className="spacer" /><span className="xs muted">{timeAgo(s.updated_at)}</span></div>
                    <dl>
                      <dt>Since last time</dt><dd>{s.yesterday || <span className="muted">—</span>}</dd>
                      <dt>Today</dt><dd>{s.today || <span className="muted">—</span>}</dd>
                      <dt>Blockers</dt><dd className={s.blockers?.trim() ? 'danger-text' : ''}>{s.blockers?.trim() || <span className="muted">None</span>}</dd>
                    </dl>
                  </div>
                ))}
                {notUpdated.length > 0 && <div className="small muted">{m.status === 'closed' ? 'No update from' : 'Waiting for'}: {notUpdated.map(p => p.name).join(', ')}</div>}
              </div>
            </section>
          )}

          <section className="panel">
            <div className="panel-head"><h3>Agenda</h3><div className="actions">{total > 0 && <span className="small muted">{total} of {m.duration_minutes} min planned</span>}</div></div>
            <div className="panel-body" style={{ paddingTop: 4 }}>
              {!m.agenda.length && <p className="small muted">No agenda items yet.</p>}
              {m.agenda.map((a, i) => <AgendaItem key={a.id} item={a} index={i} m={m} canManage={canManage} members={members} onChange={agendaChange} first={i === 0} last={i === m.agenda.length - 1} />)}
              {(canManage || m.is_participant) && (
                <form onSubmit={addItem} className="stack tight" style={{ marginTop: 12 }}>
                  <div className="row">
                    <input type="text" placeholder="Add an agenda item" value={newItem.title} onChange={(e) => setNewItem({ ...newItem, title: e.target.value })} />
                    <button className="btn" disabled={busy || (!newItem.title.trim() && !newItem.wp_id)}>Add</button>
                  </div>
                  {m.project_id && <div className="row"><span className="xs muted nowrap">or discuss a work package</span><span className="grow"><WpSearchSelect projectId={m.project_id} value={newItem.wp_id} onChange={(v) => setNewItem({ ...newItem, wp_id: v })} /></span></div>}
                </form>
              )}
            </div>
          </section>

          {m.project_id && (
            <section className="panel">
              <div className="panel-head"><h3>Action items</h3><div className="actions"><span className="small muted">Each becomes a tracked work package</span></div></div>
              <div className="panel-body" style={{ paddingTop: 6 }}>
                {m.actions.map(a => (
                  <div key={a.id} className="child-row" style={{ paddingLeft: 0, paddingRight: 0 }}>
                    <Key k={a.key} color={m.project_color} />
                    <Link to={`/wp/${a.id}`} className="ellipsis grow" style={{ color: a.is_closed ? 'var(--ink-3)' : 'var(--ink)', textDecoration: a.is_closed ? 'line-through' : undefined }}>{a.subject}</Link>
                    <Person name={a.assignee_name} muted="Unassigned" />
                    <span style={{ width: 100, textAlign: 'right' }}><Due date={a.due_date} closed={a.is_closed} /></span>
                    <StatusPill name={a.status_name} color={a.status_color} />
                  </div>
                ))}
                {!m.actions.length && <p className="small muted">Record who will do what by when. Action items show up in that person's work list.</p>}
                {m.can.create_wp && (
                  <form onSubmit={addAction} className="row wrap" style={{ marginTop: 10 }}>
                    <input type="text" placeholder="What needs to happen?" value={action.subject} onChange={(e) => setAction({ ...action, subject: e.target.value })} style={{ flex: '2 1 220px' }} />
                    <span style={{ flex: '1 1 150px' }}><UserSelect value={action.assignee_id} onChange={(v) => setAction({ ...action, assignee_id: v })} users={members.length ? members : undefined} placeholder="Who?" /></span>
                    <input type="date" value={action.due_date} onChange={(e) => setAction({ ...action, due_date: e.target.value })} style={{ flex: '0 1 150px' }} aria-label="Due date" />
                    <select value={action.type_id} onChange={(e) => setAction({ ...action, type_id: e.target.value })} style={{ flex: '0 1 120px' }} aria-label="Type">
                      <option value="">Task</option>{meta.types.filter(t => !t.is_milestone && t.name !== 'Task').map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                    <button className="btn primary" disabled={busy || !action.subject.trim()}>Add action</button>
                  </form>
                )}
              </div>
            </section>
          )}

          <section className="panel">
            <div className="panel-head"><h3>Minutes</h3>
              <div className="actions">{canManage && !editingMinutes && <button className="btn sm" onClick={() => setMinutes(m.minutes || '')}><Icon name="edit" />{m.minutes ? 'Edit' : 'Write minutes'}</button>}</div>
            </div>
            <div className="panel-body">
              {editingMinutes ? (
                <div className="stack tight">
                  <MarkdownEditor value={minutes} onChange={setMinutes} rows={10} autoFocus placeholder="Decisions, notes, follow-ups…" onSubmitShortcut={saveMinutes} />
                  <div className="row"><button className="btn primary sm" disabled={busy} onClick={saveMinutes}>Save minutes</button><button className="btn sm" onClick={() => setMinutes(null)}>Cancel</button></div>
                </div>
              ) : m.minutes ? <Markdown text={m.minutes} /> : <p className="small muted" style={{ margin: 0 }}>No minutes yet.{canManage ? ' Close the meeting when done and participants get notified.' : ''}</p>}
            </div>
          </section>

          {m.project_id && ['weekly', 'review', 'planning'].includes(m.kind) && <ReviewSummary m={m} />}
        </div>

        <div className="stack" style={{ gap: 20 }}>
          <section className="panel">
            <div className="panel-head"><h3>Participants</h3><div className="actions">{canManage && <button className="btn sm" onClick={() => setModal('people')}>Edit</button>}</div></div>
            <ul className="list">
              {m.participants.map(p => (
                <li key={p.id}>
                  <Avatar id={p.id} name={p.name} size="sm" />
                  <span className="grow ellipsis">{p.name}<div className="xs muted">{p.job_title}</div></span>
                  {(canManage || p.id === user.id) ? (
                    <select value={p.attended == null ? '' : p.attended ? '1' : '0'} style={{ width: 110, height: 28, fontSize: 12 }} aria-label={`Attendance for ${p.name}`}
                      onChange={async (e) => { await run(() => api.patch(`/meetings/${m.id}/participants/${p.id}`, { attended: e.target.value === '' ? null : e.target.value === '1' })); reload(); }}>
                      <option value="">Not marked</option><option value="1">Attended</option><option value="0">Absent</option>
                    </select>
                  ) : <span className="xs muted">{p.attended == null ? '' : p.attended ? 'Attended' : 'Absent'}</span>}
                </li>
              ))}
            </ul>
          </section>
          {(m.attachments.length > 0 || m.can.upload) && (
            <section className="panel">
              <div className="panel-head"><h3>Files</h3>
                <div className="actions">{m.can.upload && <label className="btn sm" style={{ cursor: 'pointer' }}><Icon name="paperclip" />Attach
                  <input type="file" hidden multiple onChange={async (e) => { for (const f of e.target.files) await run(() => api.upload(f, 'meeting', m.id), `Uploaded ${f.name}`); e.target.value = ''; reload(); }} /></label>}</div>
              </div>
              {!m.attachments.length ? <Empty small>Slides, notes or screenshots for this meeting.</Empty> : (
                <ul className="list">
                  {m.attachments.map(a => <li key={a.id}><Icon name="paperclip" size={14} /><a className="ellipsis grow" href={`/api/attachments/${a.id}/download?inline=1`} target="_blank" rel="noreferrer">{a.filename}</a><span className="xs muted">{fmtSize(a.size)}</span></li>)}
                </ul>
              )}
            </section>
          )}
        </div>
      </div>

      {modal === 'edit' && <EditMeetingModal m={m} onClose={() => setModal(null)} onSaved={reload} />}
      {modal === 'copy' && <CopyModal m={m} onClose={() => setModal(null)} />}
      {modal === 'people' && <ParticipantsModal m={m} members={members} onClose={() => setModal(null)} onSaved={reload} />}
      {modal === 'delete' && (
        <Modal title="Delete recurring meeting" onClose={() => setModal(null)} footer={<>
          <button className="btn" onClick={() => setModal(null)}>Cancel</button>
          <button className="btn danger" onClick={async () => { if (await run(() => api.del(`/meetings/${m.id}`), 'Meeting deleted')) nav(m.project_identifier ? `/projects/${m.project_identifier}/meetings` : '/meetings'); }}>Only this one</button>
          <button className="btn danger solid" onClick={async () => { if (await run(() => api.del(`/meetings/${m.id}?scope=future`), 'Meetings deleted')) nav(m.project_identifier ? `/projects/${m.project_identifier}/meetings` : '/meetings'); }}>This and all following</button>
        </>}>
          <p style={{ margin: 0 }}>“{m.title}” repeats. Which meetings do you want to delete?</p>
        </Modal>
      )}
    </div>
  );
}

function ParticipantsModal({ m, members, onClose, onSaved }) {
  const [ids, setIds] = useState(m.participants.map(p => p.id));
  const [busy, run] = useAsync();
  const save = async () => { if (await run(() => api.put(`/meetings/${m.id}/participants`, { user_ids: ids }), 'Participants updated')) { onSaved(); onClose(); } };
  return (
    <Modal title="Participants" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>Save</button></>}>
      <p className="small soft" style={{ margin: 0 }}>New participants get an invitation notification.</p>
      <MultiUserPicker value={ids} onChange={setIds} users={members.length ? undefined : undefined} />
    </Modal>
  );
}
