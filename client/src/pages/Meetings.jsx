import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, qs } from '../api.js';
import { useApp, useLoad } from '../context.jsx';
import Icon from '../components/Icon.jsx';
import { Loading, ErrorBox, Empty, Modal, Field, MultiUserPicker, useAsync } from '../components/ui.jsx';
import { useProjectInfo } from './NewWpModal.jsx';
import { today, addDays, fmtDay, fmtTime, MEETING_KINDS, startOfWeek } from '../lib/format.js';

const TEMPLATES = {
  daily: { title: 'Daily stand-up', duration: 15, recurrence: 'weekdays', agenda: ['Round the table: yesterday, today, blockers', 'Overdue and blocked items'] },
  weekly: { title: 'Weekly review', duration: 60, recurrence: 'weekly', agenda: ['Progress against the sprint or release goal', 'Overdue and blocked work', 'Risks and decisions needed', 'Plan for next week'] },
  review: { title: 'Sprint review', duration: 60, recurrence: 'none', agenda: ['Demo of finished work', 'Feedback', 'What did not get done and why'] },
  planning: { title: 'Sprint planning', duration: 90, recurrence: 'none', agenda: ['Review backlog', 'Agree sprint goal', 'Estimate and assign work'] },
  other: { title: '', duration: 30, recurrence: 'none', agenda: [] },
};

export function NewMeetingModal({ projectId: fixedProject, onClose, onCreated, initialKind = 'daily' }) {
  const { projects, can, isAdmin } = useApp();
  const nav = useNavigate();
  const allowNoProject = isAdmin || can('reports.view');
  const [projectId, setProjectId] = useState(fixedProject || projects[0]?.id || '');
  const info = useProjectInfo(projectId || null);
  const tpl = TEMPLATES[initialKind];
  const tomorrow = addDays(today(), 1);
  const [f, setF] = useState({
    kind: initialKind, title: tpl.title, starts_at: `${tomorrow}T${initialKind === 'weekly' ? '16:00' : '10:00'}`, duration_minutes: tpl.duration,
    location: '', recurrence: tpl.recurrence, until: addDays(today(), initialKind === 'weekly' ? 84 : 28), include_members: true, participant_ids: [],
    agenda: tpl.agenda.map(t => ({ title: t })),
  });
  const [busy, run] = useAsync();
  const set = (k, v) => setF(s => ({ ...s, [k]: v }));
  const pickKind = (k) => {
    const t = TEMPLATES[k];
    setF(s => ({ ...s, kind: k, title: !s.title || Object.values(TEMPLATES).some(x => x.title === s.title) ? t.title : s.title,
      duration_minutes: t.duration, recurrence: t.recurrence, agenda: t.agenda.map(a => ({ title: a })),
      until: addDays(today(), k === 'weekly' ? 84 : 28), starts_at: `${s.starts_at.slice(0, 10)}T${k === 'weekly' ? '16:00' : '10:00'}` }));
  };
  const members = (info?.members || []).filter(m => m.status === 'active').map(m => ({ id: m.user_id, name: m.name }));
  const submit = async () => {
    const body = {
      ...f, project_id: projectId || null,
      recurrence: f.recurrence === 'none' ? null : { frequency: f.recurrence, until: f.until },
      include_members: projectId ? f.include_members : false,
      agenda: f.agenda.filter(a => a.title.trim()),
    };
    const r = await run(() => api.post('/meetings', body), body.recurrence ? 'Meeting series created' : 'Meeting scheduled');
    if (r) { onClose(); if (onCreated) onCreated(r); else nav(`/meetings/${r.id}`); }
  };
  return (
    <Modal title="Schedule a meeting" wide onClose={onClose} onSubmit={submit} footer={<>
      <button type="button" className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy}>Schedule</button>
    </>}>
      <div className="row wrap">
        {Object.keys(TEMPLATES).map(k => (
          <button type="button" key={k} className={`btn sm${f.kind === k ? ' primary' : ''}`} onClick={() => pickKind(k)}>{MEETING_KINDS[k]}</button>
        ))}
      </div>
      <div className="form-grid three">
        {!fixedProject && (
          <Field label="Project">
            <select value={projectId} onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : '')}>
              {allowNoProject && <option value="">No project (cross-team meeting)</option>}
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Title" className={fixedProject ? 'span-2' : ''}><input type="text" value={f.title} onChange={(e) => set('title', e.target.value)} required /></Field>
        <Field label="Where" hint="Room or call link"><input type="text" value={f.location} onChange={(e) => set('location', e.target.value)} /></Field>
        <Field label="Starts"><input type="datetime-local" value={f.starts_at} onChange={(e) => set('starts_at', e.target.value)} required /></Field>
        <Field label="Duration (minutes)"><input type="number" min="5" max="600" step="5" value={f.duration_minutes} onChange={(e) => set('duration_minutes', e.target.value)} /></Field>
        <Field label="Repeats">
          <select value={f.recurrence} onChange={(e) => set('recurrence', e.target.value)}>
            <option value="none">Does not repeat</option><option value="weekdays">Every weekday (Mon–Fri)</option><option value="daily">Every day</option>
            <option value="weekly">Every week</option><option value="biweekly">Every 2 weeks</option>
          </select>
        </Field>
        {f.recurrence !== 'none' && <Field label="Repeat until"><input type="date" value={f.until} min={f.starts_at.slice(0, 10)} onChange={(e) => set('until', e.target.value)} /></Field>}
      </div>
      <Field label="Participants">
        {projectId && <label className="check" style={{ marginBottom: 6 }}><input type="checkbox" checked={f.include_members} onChange={(e) => set('include_members', e.target.checked)} />Invite every project member ({members.length})</label>}
        {(!projectId || !f.include_members) && <MultiUserPicker value={f.participant_ids} onChange={(v) => set('participant_ids', v)} users={projectId && members.length ? members : undefined} />}
      </Field>
      <Field label="Agenda">
        <div className="stack tight">
          {f.agenda.map((a, i) => (
            <div key={i} className="row">
              <span className="small muted num" style={{ width: 18 }}>{i + 1}.</span>
              <input type="text" value={a.title} onChange={(e) => set('agenda', f.agenda.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
              <button type="button" className="icon-btn" aria-label="Remove item" onClick={() => set('agenda', f.agenda.filter((_, j) => j !== i))}><Icon name="x" /></button>
            </div>
          ))}
          <button type="button" className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => set('agenda', [...f.agenda, { title: '' }])}><Icon name="plus" />Add agenda item</button>
        </div>
      </Field>
    </Modal>
  );
}

export default function Meetings({ project }) {
  const [when, setWhen] = useState('upcoming');
  const [kind, setKind] = useState('');
  const [mine, setMine] = useState(!project);
  const [modal, setModal] = useState(null);
  const t = today();
  const params = when === 'upcoming' ? { from: t, to: addDays(t, 60), order: 'asc' }
    : when === 'week' ? { from: startOfWeek(), to: addDays(startOfWeek(), 6), order: 'asc' }
      : { from: addDays(t, -90), to: addDays(t, -1), order: 'desc' };
  const { data, error, loading, reload } = useLoad(() => api.get('/meetings' + qs({ ...params, project_id: project?.id, kind, mine: mine ? 1 : undefined })), [when, kind, mine, project?.id]);
  const canCreate = project ? project.permissions.includes('meetings.manage') : true;
  const byDay = useMemo(() => {
    const m = new Map();
    for (const x of data || []) { const d = x.starts_at.slice(0, 10); if (!m.has(d)) m.set(d, []); m.get(d).push(x); }
    return [...m.entries()];
  }, [data]);

  return (
    <div className="content">
      <div className="page-head">
        <div className="grow">
          {project ? <h2>Meetings</h2> : <h1>Meetings</h1>}
          <p>Daily stand-ups, weekly reviews and other meetings, with agendas, minutes and action items.</p>
        </div>
        {canCreate && (
          <div className="head-actions">
            <button className="btn" onClick={() => setModal('daily')}><Icon name="plus" />Daily stand-up</button>
            <button className="btn" onClick={() => setModal('weekly')}><Icon name="plus" />Weekly meeting</button>
            <button className="btn primary" onClick={() => setModal('other')}><Icon name="plus" />Other meeting</button>
          </div>
        )}
      </div>
      <div className="filterbar">
        <div className="subtabs">
          <button className={when === 'upcoming' ? 'active' : ''} onClick={() => setWhen('upcoming')}>Upcoming</button>
          <button className={when === 'week' ? 'active' : ''} onClick={() => setWhen('week')}>This week</button>
          <button className={when === 'past' ? 'active' : ''} onClick={() => setWhen('past')}>Past</button>
        </div>
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Meeting type">
          <option value="">All types</option>{Object.entries(MEETING_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label className="check small"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />Only meetings I'm in</label>
      </div>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : !byDay.length ? (
        <div className="panel"><Empty title={when === 'past' ? 'No past meetings' : 'Nothing scheduled'} action={canCreate && when !== 'past' && <button className="btn primary" onClick={() => setModal('daily')}><Icon name="plus" />Set up a daily stand-up</button>}>
          {when === 'past' ? 'Meetings from the last 90 days show up here with their minutes.' : 'Schedule a recurring stand-up or weekly review for the team.'}
        </Empty></div>
      ) : (
        <div className="panel">
          {byDay.map(([d, list]) => (
            <div key={d}>
              <div className={`day-divider${d === t ? ' today' : ''}`}>{d === t ? `Today, ${fmtDay(d)}` : fmtDay(d)}</div>
              {list.map(m => (
                <Link key={m.id} to={`/meetings/${m.id}`} className="meeting-row" style={{ borderLeft: `3px solid ${m.project_color || 'var(--line)'}` }}>
                  <div className="meeting-when"><b>{fmtTime(m.starts_at)}</b><span className="xs muted">{m.duration_minutes} min</span></div>
                  <div style={{ minWidth: 0 }}>
                    <div className="ellipsis" style={{ fontWeight: 560, color: 'var(--ink)' }}>{m.title}</div>
                    <div className="xs muted ellipsis">{MEETING_KINDS[m.kind]}{!project && m.project_name ? `, ${m.project_name}` : ''}{m.location ? `, ${m.location}` : ''}</div>
                  </div>
                  <div className="row" style={{ justifyContent: 'flex-end' }}>
                    <span className="xs muted">{m.participant_count} people, {m.agenda_count} agenda items</span>
                    {m.status === 'closed' ? <span className="tag ok">Minutes ready</span> : m.status === 'in_progress' ? <span className="tag signal">In progress</span> : null}
                  </div>
                </Link>
              ))}
            </div>
          ))}
        </div>
      )}
      {modal && <NewMeetingModal projectId={project?.id} initialKind={modal} onClose={() => setModal(null)} />}
      {reload && null}
    </div>
  );
}
