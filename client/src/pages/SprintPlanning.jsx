// Sprint Planning: every task in one place, by sprint: current, future and completed sprints, and the tasks
// not in any sprint yet ("unpicked"). Each sprint belongs to a project and, optionally, one of its versions.
// Pick tasks into a sprint by selecting them and adding, or by dragging them onto a sprint.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, qs } from '../api.js';
import { useApp, useLoad } from '../context.jsx';
import Icon from '../components/Icon.jsx';
import { Loading, ErrorBox, Modal, Field, TypeLabel, Priority, Due, Person, Key, useAsync, MoreMenu } from '../components/ui.jsx';
import { LOCATIONS } from './WpDetail.jsx';
import { fmtDate, today, diffDays, fmtHours } from '../lib/format.js';

export const SPRINT_STATE = { current: 'Current', planned: 'Future', ended: 'Completed' };
const STAGE_NAME = { new: 'New', design: 'In Design', develop: 'In Develop', testing: 'In Testing', closed: 'Closed', rejected: 'Rejected' };

// "18 Nov – 29 Nov · 9 days left"
export function sprintWhen(s) {
  const t = today();
  const dates = `${fmtDate(s.start_date)} – ${fmtDate(s.end_date)}`;
  if (s.state === 'planned') { const n = diffDays(s.start_date, t); return `${dates} · starts ${n === 1 ? 'tomorrow' : `in ${n} days`}`; }
  if (s.state === 'current') { const n = diffDays(s.end_date, t); return `${dates} · ${n === 0 ? 'last day' : `${n + 1} days left`}`; }
  return `${dates} · completed`;
}
export const sprintCode = (id) => (id ? `SPR-${id}` : '');
export const sprintOption = (s, withProject) => `${sprintCode(s.id)} · ${s.name}${withProject && s.project_identifier ? ` · ${s.project_identifier}` : ''}${s.version_name ? ` · ${s.version_name}` : ''} (${SPRINT_STATE[s.state]}, ${fmtDate(s.start_date)} – ${fmtDate(s.end_date)})`;

// Versions of a project, for the version pickers.
export function useVersions(projectId) {
  const { data } = useLoad(() => (projectId ? api.get(`/projects/${projectId}/versions`) : []), [projectId]);
  return Array.isArray(data) ? data : data?.versions || [];
}

// Search-and-select list of sprints, in order of their scheduled dates. value: a sprint id or null (no sprint).
export function SprintPicker({ sprints, value, onChange, currentId, noneLabel = 'No sprint: tasks by dates', withProject }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef(null);
  const input = useRef(null);
  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const cur = sprints.find(s => s.id === value);
  const needle = q.trim().toLowerCase();
  const list = sprints.filter(s => !needle || [sprintCode(s.id), String(s.id), s.name, s.version_name, s.project_name, s.project_identifier, s.goal, SPRINT_STATE[s.state]].some(v => String(v || '').toLowerCase().includes(needle)));
  const pick = (id) => { onChange(id); setOpen(false); setQ(''); };
  return (
    <div className="sprint-picker" ref={ref}>
      <button type="button" className="sprint-picker-btn" onClick={() => setOpen(o => !o)} aria-haspopup="listbox" aria-expanded={open}>
        {cur ? <><span className="sp-code">{sprintCode(cur.id)}</span><span className="ellipsis">{cur.name}{withProject && cur.project_identifier ? ` · ${cur.project_identifier}` : ''}</span><span className={`sp-state ${cur.state}`}>{cur.id === currentId ? 'Current' : SPRINT_STATE[cur.state]}</span></>
          : <span className="ellipsis muted">{noneLabel}</span>}
        <Icon name="chevronDown" size={15} />
      </button>
      {open && (
        <div className="sprint-picker-pop" role="listbox">
          <input ref={input} type="search" placeholder="Search by name or code (SPR-…)" value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); if (e.key === 'Enter') { e.preventDefault(); if (list[0]) pick(list[0].id); } }} />
          <div className="sprint-picker-list">
            {!needle && <button type="button" role="option" aria-selected={!value} className={`sprint-opt${!value ? ' active' : ''}`} onClick={() => pick(null)}><span className="muted">{noneLabel}</span></button>}
            {list.map(s => (
              <button type="button" key={s.id} role="option" aria-selected={s.id === value} className={`sprint-opt${s.id === value ? ' active' : ''}`} onClick={() => pick(s.id)}>
                <span className="sprint-opt-main">
                  <span className="row" style={{ gap: 6, minWidth: 0 }}><span className="sp-code">{sprintCode(s.id)}</span><b className="ellipsis">{s.name}</b></span>
                  <span className={`sp-state ${s.state}`}>{s.id === currentId ? 'Current' : SPRINT_STATE[s.state]}</span>
                </span>
                <span className="xs muted ellipsis">{fmtDate(s.start_date)} – {fmtDate(s.end_date)}{withProject && s.project_name ? ` · ${s.project_name}` : ''}{s.version_name ? ` · ${s.version_name}` : ''} · {s.done}/{s.total} done</span>
              </button>
            ))}
            {!list.length && <div className="xs muted" style={{ padding: 10 }}>No sprint matches.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

// Pick several projects (checkbox list with search). value: array of project ids; empty = all projects.
export function ProjectMultiSelect({ value, onChange, allLabel = 'All projects', label = 'Projects' }) {
  const { projects } = useApp();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const chosen = projects.filter(p => value.includes(p.id));
  const text = !chosen.length ? allLabel : chosen.length === 1 ? chosen[0].name : `${chosen.length} projects`;
  const needle = q.trim().toLowerCase();
  const list = projects.filter(p => !needle || p.name.toLowerCase().includes(needle) || String(p.identifier).toLowerCase().includes(needle));
  const toggle = (id) => onChange(value.includes(id) ? value.filter(x => x !== id) : [...value, id]);
  return (
    <div className="proj-multi" ref={ref}>
      <button type="button" className={`proj-multi-btn${chosen.length ? ' on' : ''}`} onClick={() => setOpen(o => !o)} aria-haspopup="listbox" aria-expanded={open} aria-label={label}
        title={chosen.map(p => p.name).join(', ') || allLabel}>
        <span className="ellipsis">{text}</span><Icon name="chevronDown" size={15} />
      </button>
      {open && (
        <div className="proj-multi-pop" role="listbox" aria-multiselectable="true">
          {projects.length > 6 && <input type="search" placeholder="Search projects" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />}
          <div className="proj-multi-list">
            {list.map(p => (
              <label key={p.id} className="proj-multi-opt">
                <input type="checkbox" checked={value.includes(p.id)} onChange={() => toggle(p.id)} />
                <span className="proj-dot" style={{ background: p.color }} /><span className="ellipsis grow">{p.name}</span><span className="xs muted">{p.identifier}</span>
              </label>
            ))}
            {!list.length && <div className="xs muted" style={{ padding: 8 }}>No project matches.</div>}
          </div>
          <div className="proj-multi-foot">
            <button type="button" className="btn xs ghost" onClick={() => onChange([])} disabled={!value.length}>Clear</button>
            <button type="button" className="btn xs ghost" onClick={() => onChange(list.map(p => p.id))}>Select all</button>
            <span className="spacer" />
            <button type="button" className="btn xs primary" onClick={() => setOpen(false)}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}
export const idList = (v) => String(v || '').split(',').map(Number).filter(Boolean);

// Start day / End day with Start now and End now, for a sprint that has not started (Sprint Planning and the Task Board).
export function SprintSchedule({ s, onChanged }) {
  const [busy, run] = useAsync();
  const save = async (body, msg) => { const r = await run(() => api.patch(`/sprints/${s.id}`, body), msg); if (r) onChanged?.(r); };
  const t = today();
  return (
    <span className="sp-schedule">
      <label><span>Start day</span><input type="date" value={s.start_date} max={s.end_date} disabled={busy} onChange={(e) => e.target.value && save({ start_date: e.target.value }, 'Start day saved')} /></label>
      <label><span>End day</span><input type="date" value={s.end_date} min={s.start_date < t ? t : s.start_date} disabled={busy} onChange={(e) => e.target.value && save({ end_date: e.target.value }, 'End day saved')} /></label>
      <button type="button" className="btn sm" disabled={busy} onClick={() => save({ start_now: true }, `${s.name} started today`)} title="The sprint starts today"><Icon name="play" size={13} />Start now</button>
      <button type="button" className="btn sm" disabled={busy} onClick={() => save({ end_now: true }, `${s.name} runs today only`)} title="The sprint ends today (it starts today if it was later)"><Icon name="stop" size={13} />End now</button>
    </span>
  );
}

const TABS = [
  { key: 'none', label: 'Not in a sprint', q: { sprint_id: 'none' }, status: 'open' },
  { key: 'current', label: 'Current sprints', q: { sprint_state: 'current' }, status: 'all' },
  { key: 'planned', label: 'Future sprints', q: { sprint_state: 'planned' }, status: 'all' },
  { key: 'ended', label: 'Completed sprints', q: { sprint_state: 'ended' }, status: 'all' },
  { key: 'all', label: 'All tasks', q: {}, status: 'open' },
];
const FILTERS = ['q', 'project_id', 'version_id', 'type_id', 'assignee_id', 'priority_id', 'location', 'status'];
const dragIds = (e) => { const p = e.dataTransfer.getData('text/plain'); return p.startsWith('tasks:') ? p.slice(6).split(',').map(Number).filter(Boolean) : []; };

export default function SprintPlanning() {
  const { meta, projects, activeUsers } = useApp();
  const [sp, setSp] = useSearchParams();
  const [selected, setSelected] = useState([]);
  const [modal, setModal] = useState(null); // { sprint?, taskIds? } | { end: sprint }
  const [over, setOver] = useState(null);
  const [showEnded, setShowEnded] = useState(false);
  const [limit, setLimit] = useState(500);
  const [busy, run] = useAsync();

  // ?sprint=<id>: only that sprint's tasks (e.g. from the Sprints column in All work)
  const sprintFilter = /^\d+$/.test(sp.get('sprint') || '') ? Number(sp.get('sprint')) : null;
  const tab = sprintFilter ? { key: 'sprint', q: { sprint_id: sprintFilter }, status: 'all' } : TABS.find(t => t.key === sp.get('tab')) || TABS[0];
  const f = Object.fromEntries(FILTERS.map(k => [k, sp.get(k) || undefined]));
  const status = f.status || tab.status;
  const base = { ...f, version_id: idList(f.project_id).length === 1 ? f.version_id : undefined, status, sort: sp.get('sort') || 'priority:desc,id:asc' };
  const query = { ...base, ...tab.q, limit };
  const up = useLoad(() => api.get('/work-packages' + qs(query)), [JSON.stringify(query)]);
  // how many tasks each tab has with the same filters
  const counts = useLoad(() => (sprintFilter ? null : Promise.all(TABS.map(t => api.get('/work-packages' + qs({ ...base, status: f.status || t.status, ...t.q, limit: 1 })).then(r => r.total)))), [JSON.stringify(base), sprintFilter]);
  const sl = useLoad(() => api.get('/sprints' + qs({ project_id: f.project_id, version_id: idList(f.project_id).length === 1 ? f.version_id : undefined })), [f.project_id, f.version_id]);
  const projectIds = idList(f.project_id);
  const oneProject = projectIds.length === 1 ? projectIds[0] : null; // versions belong to one project
  const versions = useVersions(oneProject);
  const sprints = sl.data?.sprints || [];
  const live = sprints.filter(s => s.state !== 'ended');
  const ended = sprints.filter(s => s.state === 'ended').reverse();
  const focus = sprints.find(s => s.id === sprintFilter) || null;
  useEffect(() => { if (focus?.state === 'ended') setShowEnded(true); }, [focus?.id, focus?.state]);
  useEffect(() => { if (focus) setTimeout(() => document.getElementById(`sprint-${focus.id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 150); }, [focus?.id]);
  const shownIds = [...live, ...(showEnded ? ended : [])].map(s => s.id);
  const st = useLoad(() => (shownIds.length ? api.get('/work-packages' + qs({ sprint_id: shownIds.join(','), status: 'all', sort: 'status:asc,id:asc', limit: 2000 })) : { rows: [] }), [shownIds.join(',')]);
  const bySprint = useMemo(() => {
    const m = new Map();
    for (const r of st.data?.rows || []) { if (!m.has(r.sprint_id)) m.set(r.sprint_id, []); m.get(r.sprint_id).push(r); }
    return m;
  }, [st.data]);

  const rows = up.data?.rows || [];
  const reloadAll = () => { up.reload(); sl.reload(); st.reload(); counts.reload(); setSelected([]); };
  const setParams = (changes) => {
    const n = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(changes)) { if (!v) n.delete(k); else n.set(k, v); }
    setSp(n, { replace: true }); setSelected([]);
  };
  const setParam = (k, v) => setParams(k === 'project_id' ? { project_id: v, ...(idList(v).length === 1 && idList(v)[0] === oneProject ? {} : { version_id: '' }) } : { [k]: v });
  const filtered = FILTERS.some(k => sp.get(k)) || !!sprintFilter;
  const exportUrl = '/api/work-packages/export.csv' + qs({ ...base, ...tab.q, sort: undefined, file: tab.key === 'none' ? 'upcoming' : undefined });

  // the selected tasks' project, when they are all in one (sprints of that project are offered)
  const selProjects = [...new Set(rows.filter(r => selected.includes(r.id)).map(r => r.project_id))];
  const addable = sprints.filter(s => s.can_add && selProjects.every(pid => s.project_ids.includes(pid)));

  const move = async (ids, sprint) => {
    if (!ids.length) return;
    const name = sprint ? sprint.name : 'Not in a sprint';
    const r = await run(() => api.patch('/work-packages-bulk', { ids, changes: { sprint_id: sprint ? sprint.id : null } }), `${ids.length} task${ids.length > 1 ? 's' : ''} moved to ${name}`);
    if (r) reloadAll();
  };
  const remove = async (s) => {
    if (!window.confirm(`Delete ${s.name}? Its ${s.total} task(s) go back to "Not in a sprint".`)) return;
    if (await run(() => api.del(`/sprints/${s.id}`), `${s.name} deleted`)) reloadAll();
  };
  const allSel = rows.length > 0 && selected.length === rows.length;
  const dropProps = (key, onIds) => ({
    onDragOver: (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (over !== key) setOver(key); },
    onDragLeave: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(o => (o === key ? null : o)); },
    onDrop: (e) => { e.preventDefault(); setOver(null); onIds(dragIds(e)); },
  });
  const dragStart = (e, id) => {
    const ids = selected.includes(id) ? selected : [id];
    e.dataTransfer.setData('text/plain', `tasks:${ids.join(',')}`);
    e.dataTransfer.effectAllowed = 'move';
  };
  const sprintGroups = [['current', live.filter(s => s.state === 'current')], ['planned', live.filter(s => s.state === 'planned')]];

  return (
    <div className="content wide sp-page">
      <div className="page-head row wrap" style={{ marginBottom: 12 }}>
        <div>
          <h1 style={{ margin: 0 }}>Sprint Planning</h1>
          <p className="small muted" style={{ margin: '4px 0 0' }}>All tasks by sprint. Pick tasks into a sprint: select them and add, or drag them onto a sprint.</p>
        </div>
        <span className="spacer" />
        <a className="btn sm" href={exportUrl} title={filtered ? 'Download the tasks in this list that match the filters' : 'Download the tasks in this list'}><Icon name="download" />Export CSV</a>
        {sl.data?.can_create && <button type="button" className="btn primary" onClick={() => setModal({ taskIds: selected })}><Icon name="plus" />New sprint{selected.length ? ` with ${selected.length} task${selected.length > 1 ? 's' : ''}` : ''}</button>}
      </div>

      <div className="filterbar sp-filters" role="group" aria-label="Filters">
        <ProjectMultiSelect value={projectIds} onChange={(ids) => setParam('project_id', ids.join(','))} />
        <SprintPicker sprints={sprints} value={sprintFilter} currentId={sl.data?.current_id} noneLabel="Any sprint" withProject={projectIds.length !== 1}
          onChange={(id) => setParams({ sprint: id ? String(id) : '', tab: '' })} />
        <select value={oneProject ? f.version_id || '' : ''} onChange={(e) => setParam('version_id', e.target.value)} aria-label="Version" disabled={!oneProject} title={oneProject ? 'Version' : 'Choose one project to pick one of its versions'}>
          <option value="">{oneProject ? 'Any version' : 'Version (choose one project)'}</option>
          {oneProject && <option value="none">No version</option>}
          {versions.map(v => <option key={v.id} value={v.id}>{v.name}{v.status === 'closed' ? ' (closed)' : ''}</option>)}
        </select>
        <input type="search" placeholder="Subject or ID" defaultValue={f.q || ''} aria-label="Find" key={f.q || ''}
          onKeyDown={(e) => { if (e.key === 'Enter') setParam('q', e.target.value.trim()); }}
          onBlur={(e) => { if ((e.target.value.trim() || undefined) !== f.q) setParam('q', e.target.value.trim()); }} />
        <select value={f.type_id || ''} onChange={(e) => setParam('type_id', e.target.value)} aria-label="Type">
          <option value="">Any type</option>{meta.types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select value={f.assignee_id || ''} onChange={(e) => setParam('assignee_id', e.target.value)} aria-label="Assignee">
          <option value="">Anyone</option><option value="me">Me</option><option value="none">Unassigned</option>
          {activeUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select value={f.priority_id || ''} onChange={(e) => setParam('priority_id', e.target.value)} aria-label="Priority">
          <option value="">Any priority</option>{[...meta.priorities].reverse().map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={f.location || ''} onChange={(e) => setParam('location', e.target.value)} aria-label="Location">
          <option value="">Any location</option>{Object.entries(LOCATIONS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}<option value="none">Not set</option>
        </select>
        <select value={status} onChange={(e) => setParam('status', e.target.value === tab.status ? '' : e.target.value)} aria-label="Status">
          <option value="open">Open</option><option value="closed">Closed</option><option value="all">Any status</option>
        </select>
        {filtered && <button type="button" className="btn sm ghost" onClick={() => { setSp(sp.get('tab') ? { tab: sp.get('tab') } : {}, { replace: true }); setSelected([]); }}>Reset</button>}
      </div>
      <ErrorBox error={up.error || sl.error} />

      <div className="sp-layout">
        {/* ---------- tasks: not in a sprint / current / future / completed / all ---------- */}
        <section className={`panel sp-upcoming${over === 'upcoming' ? ' drop' : ''}`} aria-label="Tasks"
          {...dropProps('upcoming', (ids) => { const inSprint = ids.filter(id => !rows.some(r => r.id === id && !r.sprint_id)); if (tab.key === 'none') move(inSprint, null); })}>
          {sprintFilter ? (
            <div className="sp-filter-head">
              <Icon name="flag" size={15} />
              <span>Tasks in <span className="sp-code">{sprintCode(sprintFilter)}</span> <b>{focus?.name || ''}</b></span>
              {focus && <span className={`sp-state ${focus.state}`}>{SPRINT_STATE[focus.state]}</span>}
              <span className="spacer" />
              <button type="button" className="btn sm ghost" onClick={() => setParams({ sprint: '' })}><Icon name="x" size={13} />Show all tasks</button>
            </div>
          ) : (
          <div className="sp-tabs" role="tablist" aria-label="Which tasks">
            {TABS.map((t, i) => (
              <button type="button" key={t.key} role="tab" aria-selected={tab.key === t.key} className={tab.key === t.key ? 'active' : ''}
                onClick={() => { setParams({ tab: t.key === 'none' ? '' : t.key, status: '', sprint: '' }); setLimit(500); }}>
                {t.label}<span className="kb-count">{counts.data ? counts.data[i] : '…'}</span>
              </button>
            ))}
          </div>
          )}
          {selected.length > 0 && (
            <div className="bulkbar">
              <b className="small">{selected.length} selected</b>
              <select aria-label="Add to sprint" value="" disabled={busy || !addable.length}
                onChange={(e) => { const s = sprints.find(x => x.id === Number(e.target.value)); if (s) move(selected, s); }}>
                <option value="">{addable.length ? 'Add to sprint…' : 'No sprint open for planning'}</option>
                {addable.map(s => <option key={s.id} value={s.id}>{sprintOption(s, projectIds.length !== 1)}</option>)}
              </select>
              {rows.some(r => selected.includes(r.id) && r.sprint_id) && <button type="button" className="btn sm" onClick={() => move(selected, null)}>Take out of sprint</button>}
              {sl.data?.can_create && <button type="button" className="btn sm" onClick={() => setModal({ taskIds: selected })}><Icon name="plus" />New sprint with these</button>}
              <button type="button" className="btn sm ghost" onClick={() => setSelected([])}>Clear</button>
            </div>
          )}
          <div className="table-wrap">
            <table className="table sp-table">
              <thead>
                <tr>
                  <th style={{ width: 34 }}><input type="checkbox" checked={allSel} aria-label="Select all" onChange={() => setSelected(allSel ? [] : rows.map(r => r.id))} /></th>
                  <th>ID</th><th>Type</th><th>Subject</th><th>Stage</th><th>Sprint</th><th>Assignee</th>
                  <th className="hide-sm">Priority</th><th className="hide-sm sp-opt">Version</th><th className="hide-sm sp-opt">Location</th><th className="hide-sm sp-opt">Due</th>
                </tr>
              </thead>
              <tbody>
                {up.loading && !up.data && <tr><td colSpan={11}><Loading /></td></tr>}
                {rows.map(r => (
                  <tr key={r.id} className={selected.includes(r.id) ? 'selected' : ''} draggable onDragStart={(e) => dragStart(e, r.id)}
                    title="Drag onto a sprint (selected tasks move together)">
                    <td><input type="checkbox" checked={selected.includes(r.id)} aria-label={`Select ${r.key}`}
                      onChange={() => setSelected(s => (s.includes(r.id) ? s.filter(x => x !== r.id) : [...s, r.id]))} /></td>
                    <td><Key k={r.key} color={r.project_color} /></td>
                    <td><TypeLabel name={r.type_name} color={r.type_color} /></td>
                    <td className="subject">
                      <Link to={`/wp/${r.id}`} className="ellipsis" style={{ color: 'var(--ink)' }} title={r.subject}>{r.subject}</Link>
                      <div className="xs muted ellipsis">{r.project_name}{r.module ? <> · <span className="wl-module">{r.module}</span></> : null}</div>
                    </td>
                    <td>{r.sprint_id
                      ? <span className="sp-stage-pill" style={{ '--sc': r.status_color }} title={r.status_name}>{STAGE_NAME[r.board_column] || r.status_name}</span>
                      : <span className="sp-unpicked" title={`On the Task Board: ${STAGE_NAME[r.board_column] || r.status_name}`}>Unpicked task</span>}</td>
                    <td>{r.sprint_id ? <span className="sp-sprint-tag ellipsis" title={`${sprintCode(r.sprint_id)} · ${r.sprint_name}`}><span className="sp-code">{sprintCode(r.sprint_id)}</span> {r.sprint_name}</span> : <span className="sp-unpicked soft">Unpicked</span>}</td>
                    <td><Person id={r.assignee_id} name={r.assignee_name} /></td>
                    <td className="hide-sm"><Priority name={r.priority_name} color={r.priority_color} position={r.priority_position} /></td>
                    <td className="hide-sm sp-opt small soft ellipsis" style={{ maxWidth: 120 }}>{r.version_name || '—'}</td>
                    <td className="hide-sm sp-opt small soft">{LOCATIONS[r.location] || '—'}</td>
                    <td className="hide-sm sp-opt"><Due date={r.due_date} closed={r.is_closed} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {up.data && !rows.length && <div className="kb-empty" style={{ margin: 14 }}>{filtered ? 'No tasks match the filters.' : tab.key === 'none' ? 'Every open task is in a sprint.' : 'No tasks here.'}</div>}
          {up.data && rows.length > 0 && (
            <div className="row between small muted" style={{ padding: '10px 14px', borderTop: '1px solid var(--line-2)' }}>
              <span>Showing {rows.length} of {up.data.total}, {fmtHours(rows.reduce((t, r) => t + (r.estimated_hours || 0), 0))} estimated</span>
              {up.data.total > rows.length && <button type="button" className="btn sm" onClick={() => setLimit(l => l + 500)}>Show more</button>}
            </div>
          )}
        </section>

        {/* ---------- sprints, in order of their dates ---------- */}
        <aside className="sp-sprints" aria-label="Sprints">
          {sl.loading && !sl.data && <Loading />}
          {sl.data && !sprints.length && (
            <div className="panel sp-none">
              <Icon name="flag" size={22} />
              <p><b>No sprints {projectIds.length ? `for ${projectIds.length > 1 ? 'these projects' : 'this project'}` : 'yet'}.</b><br />Select tasks and choose <b>New sprint</b>, or create an empty one and drag tasks onto it.</p>
            </div>
          )}
          {sprintGroups.map(([state, list]) => list.length > 0 && (
            <div key={state} className="sp-group">
              <h3 className="sp-group-title">{SPRINT_STATE[state]} sprint{list.length > 1 ? 's' : ''} <span className="kb-count">{list.length}</span></h3>
              {list.map(s => (
                <SprintGroup key={s.id} s={s} focused={s.id === sprintFilter} tasks={bySprint.get(s.id) || []} over={over === `s${s.id}`} isAdmin={sl.data.is_admin} withProject={projectIds.length !== 1}
                  dropProps={dropProps(`s${s.id}`, (ids) => (s.can_add ? move(ids.filter(id => !(bySprint.get(s.id) || []).some(t => t.id === id)), s) : run(async () => { throw new Error(`${s.name} has started, so only an administrator can add tasks to it.`); })))}
                  onDragTask={dragStart} onRemove={(t) => move([t.id], null)} onEnd={() => setModal({ end: s })}
                  onEdit={() => setModal({ sprint: s })} onDelete={() => remove(s)} onChanged={reloadAll} />
              ))}
            </div>
          ))}
          {ended.length > 0 && (
            <button type="button" className="btn sm ghost sp-ended-toggle" onClick={() => setShowEnded(v => !v)} aria-expanded={showEnded}>
              <Icon name={showEnded ? 'chevronDown' : 'chevronRight'} />Completed sprints ({ended.length})
            </button>
          )}
          {showEnded && ended.map(s => (
            <SprintGroup key={s.id} s={s} focused={s.id === sprintFilter} tasks={bySprint.get(s.id) || []} over={over === `s${s.id}`} isAdmin={sl.data.is_admin} withProject={projectIds.length !== 1}
              dropProps={s.can_add ? dropProps(`s${s.id}`, (ids) => move(ids, s)) : {}}
              onDragTask={dragStart} onRemove={(t) => move([t.id], null)} onEdit={() => setModal({ sprint: s })} onDelete={() => remove(s)} onChanged={reloadAll} />
          ))}
        </aside>
      </div>

      {modal && !modal.end && (
        <SprintModal sprint={modal.sprint} taskIds={modal.taskIds || []}
          defaultProjects={modal.sprint ? modal.sprint.project_ids : selProjects.length ? selProjects : projectIds}
          defaultVersion={oneProject && f.version_id && f.version_id !== 'none' ? Number(f.version_id) : ''}
          onClose={() => setModal(null)} onSaved={() => { setModal(null); reloadAll(); }} />
      )}
      {modal?.end && <EndModal s={modal.end} open={(bySprint.get(modal.end.id) || []).filter(t => !t.is_closed).length} others={live.filter(x => x.id !== modal.end.id && modal.end.project_ids.every(pid => x.project_ids.includes(pid)))}
        onClose={() => setModal(null)} onDone={() => { setModal(null); reloadAll(); }} />}
    </div>
  );
}

function SprintGroup({ s, focused, tasks, over, isAdmin, withProject, dropProps, onDragTask, onRemove, onEnd, onEdit, onDelete, onChanged }) {
  const [open, setOpen] = useState(s.state !== 'ended');
  const canMoveOut = isAdmin || s.state === 'planned';
  const est = tasks.reduce((t, r) => t + (r.estimated_hours || 0), 0);
  const exportUrl = '/api/work-packages/export.csv' + qs({ sprint_id: s.id, status: 'all' });
  return (
    <section id={`sprint-${s.id}`} className={`panel sp-sprint ${s.state}${over ? ' drop' : ''}${focused ? ' focused' : ''}`} aria-label={s.name} {...dropProps}>
      <div className="sp-sprint-head">
        <button type="button" className="sp-sprint-toggle" onClick={() => setOpen(o => !o)} aria-expanded={open}>
          <Icon name={open ? 'chevronDown' : 'chevronRight'} size={16} />
          <span className="sp-code">{sprintCode(s.id)}</span>
          <span className="sp-sprint-name">{s.name}</span>
          <span className={`sp-state ${s.state}`}>{SPRINT_STATE[s.state]}</span>
        </button>
        <span className="spacer" />
        {s.state === 'current' && onEnd && s.can_end && <button type="button" className="btn xs" onClick={onEnd} title="End the sprint today"><Icon name="stop" size={13} />End now</button>}
        <MoreMenu label={`More for ${s.name}`}>
          <a className="menu-item" href={exportUrl}><Icon name="download" size={15} />Export tasks</a>
          {s.can_manage && <button type="button" className="menu-item" onClick={onEdit}><Icon name="edit" size={15} />Edit sprint</button>}
          {s.can_manage && <button type="button" className="menu-item danger" onClick={onDelete}><Icon name="trash" size={15} />Delete sprint</button>}
        </MoreMenu>
      </div>
      <div className="sp-sprint-meta xs muted">
        <span>{withProject && s.project_name ? <><b className="soft">{s.project_name}</b> · </> : null}{s.version_name ? <>Version <b className="soft">{s.version_name}</b> · </> : null}{sprintWhen(s)}</span>
        <span>{s.done}/{s.total} done · {fmtHours(est)} est.</span>
      </div>
      {s.state === 'planned' && s.can_manage && <div className="sp-sched-row"><SprintSchedule s={s} onChanged={onChanged} /></div>}
      {s.goal && <div className="sp-goal small">{s.goal}</div>}
      {s.total > 0 && <div className="sp-progress" aria-hidden="true"><span style={{ width: `${Math.round((s.done / s.total) * 100)}%` }} /></div>}
      {open && (
        <ul className="sp-tasks">
          {tasks.map(t => (
            <li key={t.id} draggable={canMoveOut} onDragStart={(e) => onDragTask(e, t.id)} className={t.is_closed ? 'done' : ''}>
              <Key k={t.key} color={t.project_color} />
              <Link to={`/wp/${t.id}`} className="ellipsis grow" title={t.subject}>{t.subject}</Link>
              <span className="sp-stage" title={t.status_name}>{STAGE_NAME[t.board_column] || t.status_name}</span>
              {canMoveOut && <button type="button" className="btn icon xs ghost" onClick={() => onRemove(t)} title="Take out of the sprint" aria-label={`Take ${t.key} out of ${s.name}`}><Icon name="x" size={14} /></button>}
            </li>
          ))}
          {!tasks.length && <li className="sp-drop-hint">{s.can_add ? 'Drag tasks here' : 'No tasks'}</li>}
        </ul>
      )}
    </section>
  );
}

function SprintModal({ sprint, taskIds, defaultProjects, defaultVersion, onClose, onSaved }) {
  const t = today();
  const [v, setV] = useState({ name: sprint?.name || '', goal: sprint?.goal || '', start_date: sprint?.start_date || t, end_date: sprint?.end_date || '',
    project_ids: defaultProjects || [], version_id: sprint ? sprint.version_id || '' : defaultVersion || '' });
  const single = v.project_ids.length === 1 ? v.project_ids[0] : null;
  const versions = useVersions(single);
  const [busy, run] = useAsync();
  const set = (k) => (e) => setV(x => ({ ...x, [k]: e.target.value }));
  const removed = sprint ? sprint.project_ids.filter(id => !v.project_ids.includes(id)) : [];
  const save = async () => {
    const body = { ...v, name: v.name.trim(), version_id: single ? v.version_id || null : null };
    const r = await run(() => (sprint ? api.patch(`/sprints/${sprint.id}`, body) : api.post('/sprints', { ...body, task_ids: taskIds })), sprint ? 'Sprint saved' : 'Sprint created');
    if (r) onSaved(r);
  };
  const days = v.start_date && v.end_date && v.end_date >= v.start_date ? diffDays(v.end_date, v.start_date) + 1 : null;
  return (
    <Modal title={sprint ? `Edit ${sprintCode(sprint.id)} · ${sprint.name}` : 'New sprint'} onClose={onClose} onSubmit={save}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>{sprint ? 'Save' : 'Create sprint'}</button></>}>
      {!sprint && taskIds.length > 0 && <div className="info-box small" style={{ marginBottom: 12 }}>The {taskIds.length} selected task{taskIds.length > 1 ? 's go' : ' goes'} into this sprint{v.version_id ? ' and its version' : ''}.</div>}
      <div className="form-grid">
        <Field label="Projects" hint={removed.length ? 'Tasks of a project you take off go back to "Not in a sprint".' : 'One or more projects.'}>
          <ProjectMultiSelect value={v.project_ids} allLabel="Choose projects…" onChange={(ids) => setV(x => ({ ...x, project_ids: ids, version_id: ids.length === 1 && ids[0] === single ? x.version_id : '' }))} />
        </Field>
        <Field label="Version" hint={single ? 'Tasks in the sprint go into this version.' : v.project_ids.length > 1 ? 'A version belongs to one project, so a sprint with several projects has none.' : 'Choose one project to pick its version.'}>
          <select value={single ? v.version_id : ''} onChange={set('version_id')} disabled={!single}>
            <option value="">No version</option>{versions.filter(x => x.status !== 'closed' || x.id === v.version_id).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Name" hint={sprint ? undefined : 'Leave empty for the next number, e.g. "Sprint 4".'}><input value={v.name} onChange={set('name')} maxLength={80} placeholder="Sprint name" /></Field>
      <div className="form-grid">
        <Field label="Start day">
          <div className="row" style={{ gap: 6 }}>
            <input type="date" value={v.start_date} onChange={set('start_date')} required />
            <button type="button" className={`btn sm${v.start_date === t ? ' active' : ''}`} onClick={() => setV(x => ({ ...x, start_date: t, end_date: x.end_date && x.end_date < t ? t : x.end_date }))}>Start now</button>
          </div>
        </Field>
        <Field label="End day">
          <div className="row" style={{ gap: 6 }}>
            <input type="date" value={v.end_date} min={v.start_date} onChange={set('end_date')} required />
            <button type="button" className={`btn sm${v.end_date === t ? ' active' : ''}`} onClick={() => setV(x => ({ ...x, end_date: t, start_date: x.start_date > t ? t : x.start_date }))}>End now</button>
          </div>
        </Field>
      </div>
      {days && <p className="xs muted" style={{ marginTop: -4 }}>{days} day{days > 1 ? 's' : ''}{v.start_date <= t && v.end_date >= t ? ' · this sprint is running today, so only an administrator can change its tasks afterwards' : ''}</p>}
      <Field label="Goal (optional)"><textarea rows={2} value={v.goal} onChange={set('goal')} maxLength={500} placeholder="What this sprint should deliver" /></Field>
    </Modal>
  );
}

export function EndModal({ s, open, others, onClose, onDone }) {
  const [to, setTo] = useState('upcoming');
  const [busy, run] = useAsync();
  const end = async () => {
    const r = await run(() => api.post(`/sprints/${s.id}/end`, { move_to: to }), `${s.name} ended`);
    if (r) onDone();
  };
  return (
    <Modal title={`End ${s.name} now`} onClose={onClose} onSubmit={end}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>End sprint</button></>}>
      <p className="small">The sprint ends today. {open ? <><b>{open}</b> of its tasks {open > 1 ? 'are' : 'is'} not finished.</> : 'All its tasks are finished.'}</p>
      {open > 0 && (
        <Field label="Unfinished tasks">
          <select value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="upcoming">Back to "Not in a sprint"</option>
            {others.map(o => <option key={o.id} value={o.id}>Move to {sprintOption(o)}</option>)}
            <option value="keep">Keep them in {s.name}</option>
          </select>
        </Field>
      )}
    </Modal>
  );
}
