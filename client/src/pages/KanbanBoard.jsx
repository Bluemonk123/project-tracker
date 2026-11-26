import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, qs } from '../api.js';
import { useApp, useLoad } from '../context.jsx';
import Icon from '../components/Icon.jsx';
import { Loading, ErrorBox, Avatar, useAsync, Modal } from '../components/ui.jsx';
import NewWpModal from './NewWpModal.jsx';
import RaiseTicketModal from './tickets/RaiseTicketModal.jsx';
import { SlaBadge } from './tickets/common.jsx';
import { LOCATIONS } from './WpDetail.jsx';
import { sprintWhen, SprintPicker, SprintSchedule, EndModal, useVersions, ProjectMultiSelect, idList } from './SprintPlanning.jsx';
import { addDays, diffDays, fmtDate, startOfWeek, today, parseDate } from '../lib/format.js';

const h = (n) => `${Math.round((n || 0) * 100) / 100} h`;

// Default range: this week, Monday to Friday
const thisWeek = () => { const mon = startOfWeek(today()); return { from: mon, to: addDays(mon, 4) }; };

function rangeLabel(from, to) {
  // e.g. "19 Oct – 23 Oct"; the year appears only when it is not the current year
  return `${fmtDate(from)} – ${fmtDate(to)}`;
}

function cardDates(w) {
  const s = w.start_date, e = w.due_date;
  if (!s && !e) return null;
  // the year is shown only when it is not the current year
  if (!s || !e || s === e) return fmtDate(s || e);
  return `${fmtDate(s)} – ${fmtDate(e)}`;
}

// "P2 - High" -> "P2"; ticket priorities map to P1-P3
const prioShort = (name) => (/^P\d/i.test(name || '') ? String(name).split(/[\s-]/)[0].toUpperCase() : String(name || '').slice(0, 3));
const TICKET_P = { urgent: 'P1', high: 'P2', normal: 'P3' };
const hrs = (n) => `${Math.round((n || 0) * 100) / 100}hr`;

function Who({ id, name }) {
  return name ? <Avatar id={id} name={name} size="sm" />
    : <span className="kb-unassigned" title="Unassigned" aria-label="Unassigned"><Icon name="userOff" size={14} /></span>;
}

// One task: project and estimate on top, subject, then one line of person · P/C · type.
// ---------- expanded view of one stage ----------
const plain = (t) => String(t || '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[#*_`>]+/g, '').replace(/\s+/g, ' ').trim();
const dayOf = (s) => String(s || '').slice(0, 10);
// days the task has been open (to the closed day once closed)
function ageing(w) {
  const from = dayOf(w.created_at);
  if (!from) return null;
  const to = w.is_closed && w.closed_on ? w.closed_on : today();
  return Math.max(0, diffDays(to, from));
}
const ageText = (n) => (n == null ? '—' : n === 0 ? 'Today' : `${n} day${n === 1 ? '' : 's'}`);

// Stage dropdown on each expanded card: moving a task here takes it out of this stage's list.
function StageSelect({ w, columns, onMove }) {
  const stop = (e) => e.stopPropagation();
  if (!w.can_edit || !onMove) return null;
  return (
    <select className="kbx-stage" value={w.board_column} aria-label={`Stage of ${w.key}`} title="Move to another stage"
      onClick={stop} onMouseDown={stop} onKeyDown={stop}
      onChange={(e) => { const c = columns.find(x => x.key === e.target.value); if (c) onMove(c, w.id); }}>
      {columns.filter(c => c.statuses?.length).map(c => <option key={c.key} value={c.key}>{c.name}</option>)}
    </select>
  );
}

function ExpandedCard({ w, columns, onMove }) {
  const nav = useNavigate();
  const age = ageing(w);
  const overdue = !w.is_closed && w.due_date && w.due_date < today();
  return (
    <article className={`kbx-card${overdue ? ' overdue' : ''}`} style={{ '--pc': w.project_color }} role="link" tabIndex={0} aria-label={`${w.key} ${w.subject}`}
      onClick={() => nav(`/wp/${w.id}`)} onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) nav(`/wp/${w.id}`); }}>
      <div className="kbx-top">
        <span className="kbx-proj ellipsis">{w.project_name} · {w.key}</span>
        <StageSelect w={w} columns={columns} onMove={onMove} />
        <span className="kb-type-pill" style={{ '--c': w.type_color }}>{w.type_name}</span>
      </div>
      <div className="kbx-module ellipsis">{w.module || <span className="muted">No module</span>}</div>
      <div className="kbx-subject" title={w.subject}>{w.subject}</div>
      <div className="kbx-desc">{plain(w.description) || <span className="muted">No description.</span>}</div>
      <dl className="kbx-meta">
        <div><dt>Requestor</dt><dd className="ellipsis">{w.requested_by || <span className="muted">—</span>}</dd></div>
        <div><dt>Assignee</dt><dd className="ellipsis">{w.assignee_name ? <><Avatar id={w.assignee_id} name={w.assignee_name} size={18} />{w.assignee_name}</> : <span className="muted">Unassigned</span>}</dd></div>
        <div><dt>Date assigned</dt><dd>{w.assigned_at ? fmtDate(dayOf(w.assigned_at), { year: true }) : <span className="muted">—</span>}</dd></div>
        <div><dt>Ageing</dt><dd className={age > 14 && !w.is_closed ? 'kbx-old' : ''}>{ageText(age)}</dd></div>
        <div><dt>Priority</dt><dd><span className="kbx-prio" style={{ '--c': w.priority_color }}>{w.priority_name || '—'}</span></dd></div>
        <div><dt>Due</dt><dd className={overdue ? 'danger-text' : ''}>{w.due_date ? fmtDate(w.due_date, { year: true }) : <span className="muted">—</span>}</dd></div>
      </dl>
    </article>
  );
}

function StageModal({ col, items, columns, onMove, onClose }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('age');
  const [member, setMember] = useState('');   // assignee id, 'none' or ''
  const [proj, setProj] = useState('');       // project id or ''
  const needle = q.trim().toLowerCase();
  // choices: only the people and projects that appear in this stage
  const members = [...new Map(items.filter(w => w.assignee_id).map(w => [w.assignee_id, w.assignee_name])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const projects = [...new Map(items.map(w => [w.project_id, w.project_name])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const list = items.filter(w => (!needle || [w.subject, w.key, w.module, w.requested_by, w.assignee_name, w.project_name, w.description].some(v => String(v || '').toLowerCase().includes(needle)))
    && (!member || (member === 'none' ? !w.assignee_id : String(w.assignee_id) === member))
    && (!proj || String(w.project_id) === proj));
  const count = (pred) => items.filter(pred).length;
  const sorted = [...list].sort((a, b) => {
    if (sort === 'age') return (ageing(b) ?? -1) - (ageing(a) ?? -1);
    if (sort === 'priority') return (b.priority_position || 0) - (a.priority_position || 0) || (ageing(b) ?? 0) - (ageing(a) ?? 0);
    if (sort === 'assigned') return String(b.assigned_at || '').localeCompare(String(a.assigned_at || ''));
    if (sort === 'due') return String(a.due_date || '9999').localeCompare(String(b.due_date || '9999'));
    return 0;
  });
  return (
    <Modal wide="xl" title={`${col.name} · ${items.length} task${items.length === 1 ? '' : 's'}`} onClose={onClose}>
      <div className="kbx-tools">
        <input type="search" placeholder="Find in this stage: subject, module, person…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find in this stage" />
        <select value={member} onChange={(e) => setMember(e.target.value)} aria-label="Team member" style={{ width: 'auto' }}>
          <option value="">All team members</option>
          {items.some(w => !w.assignee_id) && <option value="none">Unassigned ({count(w => !w.assignee_id)})</option>}
          {members.map(([id, name]) => <option key={id} value={id}>{name} ({count(w => w.assignee_id === id)})</option>)}
        </select>
        <select value={proj} onChange={(e) => setProj(e.target.value)} aria-label="Project" style={{ width: 'auto' }}>
          <option value="">All projects</option>
          {projects.map(([id, name]) => <option key={id} value={id}>{name} ({count(w => w.project_id === id)})</option>)}
        </select>
        {(member || proj || q) && <button type="button" className="btn sm ghost" onClick={() => { setMember(''); setProj(''); setQ(''); }}>Reset</button>}
        <label className="row" style={{ gap: 6 }}><span className="small muted">Sort</span>
          <select value={sort} onChange={(e) => setSort(e.target.value)} style={{ width: 'auto' }}>
            <option value="age">Oldest first (ageing)</option><option value="priority">Priority</option>
            <option value="assigned">Recently assigned</option><option value="due">Due date</option>
          </select>
        </label>
        <span className="small muted" style={{ marginLeft: 'auto' }}>{list.length === items.length ? '' : `${list.length} of ${items.length}`}</span>
      </div>
      <div className="kbx-grid" style={{ '--cc': col.color }}>
        {sorted.map(w => <ExpandedCard key={w.id} w={w} columns={columns} onMove={onMove} />)}
        {!sorted.length && <div className="kb-empty">No tasks{needle ? ' match' : ''}.</div>}
      </div>
    </Modal>
  );
}

function Card({ w, onDragStart, onDragEnd, dragging }) {
  const nav = useNavigate();
  const overdue = !w.is_closed && w.due_date && w.due_date < today();
  const dates = cardDates(w);
  const est = w.estimated_hours || 0, spent = w.spent_hours || 0;
  const tip = [w.subject, w.module && `Module: ${w.module}`, `${w.key} · ${w.status_name}`, w.requested_by && `Requested by ${w.requested_by}`, w.assignee_name ? `Assigned to ${w.assignee_name}` : 'Unassigned', w.priority_name && `Priority ${w.priority_name}`,
dates && `Dates ${dates}${overdue ? ' (overdue)' : ''}`, `Logged ${hrs(spent)} of ${hrs(est)} estimated`,
    w.ticket_no && `From ticket #${w.ticket_no}`].filter(Boolean).join('\n');
  return (
    <article className={`kb-card${dragging ? ' dragging' : ''}${overdue ? ' overdue' : ''}`} style={{ '--tc': w.type_color }} title={tip}
      draggable={w.can_edit} tabIndex={0} role="link" aria-label={`${w.key} ${w.subject}`}
      onClick={() => nav(`/wp/${w.id}`)} onKeyDown={(e) => { if (e.key === 'Enter') nav(`/wp/${w.id}`); }}
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(w.id)); e.dataTransfer.effectAllowed = 'move'; onDragStart(w.id); }}
      onDragEnd={onDragEnd}>
      <div className="kb-top">
        <span className="kb-project">{w.project_name}</span>
        <span className={`kb-est${est > 0 && spent > est ? ' over' : ''}`} title={`Estimated ${hrs(est)}${spent ? `, logged ${hrs(spent)}` : ''}`}>{hrs(est)}</span>
      </div>
      <div className="kb-title">{w.subject}</div>
      <div className="kb-line">
        <Who id={w.assignee_id} name={w.assignee_name} />
        <span className="kb-pc" style={{ '--pcol': w.priority_color }} title={w.priority_name}><b>{prioShort(w.priority_name)}</b></span>
        <span className="kb-type-pill" style={{ '--c': w.type_color }}>{w.type_name}</span>
      </div>
    </article>
  );
}

// A helpdesk ticket in the first column: opens it on the Ticket Board.
// Read-only summary of a ticket, for Task Board users who cannot open the Ticket Board
function TicketPeek({ t, onClose }) {
  return (
    <Modal title={`Ticket #${t.ticket_no}`} onClose={onClose} footer={<button type="button" className="btn primary" onClick={onClose}>Close</button>}>
      <h3 style={{ margin: 0 }}>{t.subject_display}</h3>
      <div className="row wrap small" style={{ gap: 10 }}>
        <span><span className="muted">Raised by</span> {t.requester_display}</span>
        <span><span className="muted">Assignee</span> {t.assignee_name || 'Unassigned'}</span>
        <span><span className="muted">Priority</span> {TICKET_P[t.priority] || 'P3'}</span>
        <SlaBadge sla={t.sla} />
      </div>
      <div className="tk-body" style={{ whiteSpace: 'pre-wrap' }}>{t.description || '(no description)'}</div>
      <p className="xs muted" style={{ margin: 0 }}>Opening and replying to tickets is on the Ticket Board, for people with "Enable Ticket Board".</p>
    </Modal>
  );
}

function TicketCard({ t, draggable, onDragStart, onDragEnd, dragging, canOpen }) {
  const nav = useNavigate();
  const [peek, setPeek] = useState(false);
  const open = () => (canOpen ? nav(`/ticket-board?ticket=${t.ticket_no}`) : setPeek(true));
  return (
    <>
    <article className={`kb-card${dragging ? ' dragging' : ''}`} style={{ '--tc': '#E5484D' }} tabIndex={0} role="link" aria-label={`Ticket ${t.ticket_no} ${t.subject_display}`}
      title={`Ticket #${t.ticket_no} · raised by ${t.requester_display}${draggable ? '\nDrag onto a task column to turn it into a task' : ''}`}
      draggable={draggable} onDragStart={(e) => { e.dataTransfer.setData('text/plain', `ticket:${t.ticket_no}`); e.dataTransfer.effectAllowed = 'move'; onDragStart?.(); }}
      onDragEnd={onDragEnd}
      onClick={open} onKeyDown={(e) => { if (e.key === 'Enter') open(); }}>
      <div className="kb-top">
        <span className="kb-project">{t.group_name}</span>
        <SlaBadge sla={t.sla} />
      </div>
      <div className="kb-title">{t.subject_display}</div>
      <div className="kb-line">
        <Who id={t.assignee_id} name={t.assignee_name} />
        <span className="kb-pc" style={{ '--pcol': { urgent: '#C2453B', high: '#C98A1B', normal: '#3B6EA8' }[t.priority] }}><b>{TICKET_P[t.priority] || 'P3'}</b></span>
        <span className="kb-type-pill" style={{ '--c': '#E5484D' }}>Ticket</span>
      </div>
    </article>
    {peek && <TicketPeek t={t} onClose={() => setPeek(false)} />}
    </>
  );
}

export default function KanbanBoard({ project }) {
  const { activeUsers, projects, user, meta } = useApp();
  const [sp, setSp] = useSearchParams();
  const def = thisWeek();
  const from = sp.get('from') || def.from;
  const to = sp.get('to') || def.to;
  // Team Member: whose tasks (assignee); Requestor: who asked for them ("Requested by")
  const employee = sp.get('member') || sp.get('employee') || '';
  const requester = sp.get('requester') || '';
  const teamsLoad = useLoad(() => api.get('/teams'), []);
  // everyone in a team, once each (A–Z), by full name
  const boardPeople = useMemo(() => {
    const byId = new Map();
    for (const t of teamsLoad.data || []) for (const m of t.members) if (!byId.has(m.id)) byId.set(m.id, { id: m.id, name: m.name });
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [teamsLoad.data]);
  const reqLoad = useLoad(() => api.get('/work-packages-requesters'), []);
  const projectId = project ? String(project.id) : (sp.get('project') || ''); // one or more project ids, comma separated
  const projectIds = idList(projectId);
  const oneProject = projectIds.length === 1 ? projectIds[0] : null; // versions belong to one project
  const undated = sp.get('undated') !== '0';
  const typeId = sp.get('type') || '';
  const location = sp.get('location') || '';
  const [dragId, setDragId] = useState(null);
  const [over, setOver] = useState(null);
  const [adding, setAdding] = useState(null);
  const [raising, setRaising] = useState(false);
  // Closed and Rejected share the last column, with a switcher (remembered in this browser)
  const [endTab, setEndTab] = useState(() => { try { return localStorage.getItem('pt-board-end') === 'rejected' ? 'rejected' : 'closed'; } catch { return 'closed'; } });
  const chooseEnd = (k) => { setEndTab(k); try { localStorage.setItem('pt-board-end', k); } catch { /* ignore */ } };
  const [converting, setConverting] = useState(null); // { ticket, col }
  const [dragTicket, setDragTicket] = useState(null);
  const [, run] = useAsync();

  const set = (changes) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(changes)) { if (v === '' || v == null) next.delete(k); else next.set(k, v); }
    setSp(next, { replace: true });
  };
  // Sprint: the current sprint by default; "all" shows the tasks by dates instead
  const versionId = oneProject ? sp.get('version') || '' : '';
  const versions = useVersions(oneProject);
  const sl = useLoad(() => api.get('/sprints' + qs({ project_id: projectId || undefined, version_id: versionId || undefined })), [projectId, versionId]);
  const [ending, setEnding] = useState(false);
  const [expanded, setExpanded] = useState(null); // a stage shown in the larger view
  const sprintParam = sp.get('sprint') || '';
  const sprints = sl.data?.sprints || [];
  const sprintId = sprintParam === 'all' ? null : /^\d+$/.test(sprintParam) ? Number(sprintParam) : (sl.data?.current_id || null);
  const sprint = sprints.find(x => x.id === sprintId) || null;
  const waiting = !sprintParam && !sl.data && !sl.error; // the default sprint is not known yet
  const filters = { assignee_id: employee || undefined, requested_by: requester || undefined, project_id: projectId || undefined, version_id: versionId || undefined, type_id: typeId || undefined, location: location || undefined };
  const query = sprintId ? { ...filters, sprint_id: sprintId } : { ...filters, from, to, undated: undated ? undefined : 0 };
  const { data, error, loading, reload, setData } = useLoad(() => (waiting ? null : api.get('/board' + qs(query))), [JSON.stringify(query), waiting]);
  useEffect(() => { // refresh when a ticket or task is raised from the top bar
    const again = () => reload();
    window.addEventListener('pt-wp-created', again);
    window.addEventListener('pt-ticket-created', again);
    return () => { window.removeEventListener('pt-wp-created', again); window.removeEventListener('pt-ticket-created', again); };
  });

  const span = Math.max(1, diffDays(to, from) + 1);
  const step = span <= 7 ? 7 : span;
  const shift = (dir) => set({ from: addDays(from, dir * step), to: addDays(to, dir * step) });
  const isThisWeek = from === def.from && to === def.to;

  const people = useMemo(() => {
    if (!project) return activeUsers;
    const ids = new Set(project.members.map(m => m.user_id));
    return activeUsers.filter(u => ids.has(u.id));
  }, [project, activeUsers]);

  const columns = data?.columns || [];
  // quick find across the cards on the board (subject, ID, ticket number, assignee)
  const [find, setFind] = useState('');
  const needle = find.trim().toLowerCase();
  const matches = (...vals) => !needle || vals.some(v => String(v ?? '').toLowerCase().includes(needle));
  const rows = (data?.rows || []).filter(r => matches(r.subject, r.key, r.assignee_name, r.project_name, r.ticket_no));
  const tickets = data?.tickets ? data.tickets.filter(t => matches(t.subject_display, t.ticket_no, t.assignee_name, t.requester_display)) : null;
  // Compact cards fit many more on screen (remembered in this browser)
  const dense = true; // compact cards only
  // the board fills the rest of the window; each column scrolls on its own, headers stay in view
  const boardRef = useRef(null);
  const [boardTop, setBoardTop] = useState(260);
  useEffect(() => {
    const measure = () => { if (boardRef.current) setBoardTop(Math.max(120, boardRef.current.getBoundingClientRect().top + window.scrollY)); };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [loading, data ? 1 : 0]);
  const byColumn = (c) => rows.filter(r => r.board_column === c.key);
  const sum = (list, k) => list.reduce((t, r) => t + (r[k] || 0), 0);

  const drop = async (col, droppedId) => {
    const w = rows.find(r => r.id === (droppedId || dragId));
    setOver(null); setDragId(null);
    if (!w || w.board_column === col.key || !w.can_edit) return;
    const target = col.statuses[0];
    if (!target) return;
    setData(d => ({ ...d, rows: d.rows.map(r => (r.id === w.id ? { ...r, board_column: col.key, status_id: target.id, status_name: target.name, status_color: target.color, is_closed: target.is_closed } : r)) }));
    const res = await run(() => api.patch(`/work-packages/${w.id}`, { status_id: target.id }), `${w.key} moved to ${col.name}`);
    if (!res) reload();
  };

  const canCreateIn = project ? project.permissions.includes('wp.create') : projects.length > 0;

  return (
    <div className={`content wide kb${dense ? ' dense' : ''}`}>
      <div className="kb-head">
        <div className="kb-titlebar">
        {!project && <h1>Task Board</h1>}
        <div className="kb-sprint" role="group" aria-label="Sprint">
          <SprintPicker sprints={sprints} value={sprintId} currentId={sl.data?.current_id}
            onChange={(id) => set({ sprint: id === (sl.data?.current_id || null) ? '' : id ? String(id) : (sl.data?.current_id ? 'all' : '') })} />
          {sprint ? (
            <span className="kb-sprint-info">
              {sprint.id === sl.data?.current_id && <b>Current sprint</b>}
              {sprint.version_name && <span>Version {sprint.version_name}</span>}
              <span>{sprintWhen(sprint)}</span>
              <span>{sprint.done}/{sprint.total} done</span>
              {sprint.goal && <span className="ellipsis" title={sprint.goal}>Goal: {sprint.goal}</span>}
            </span>
          ) : (
            <span className="kb-sprint-info muted">{sl.data && !sl.data.current_id ? 'No sprint is running. ' : ''}Showing tasks by their dates.</span>
          )}
          {sprint?.state === 'planned' && sprint.can_manage && <SprintSchedule s={sprint} onChanged={() => { sl.reload(); reload(); }} />}
          {sprint?.state === 'current' && sprint.can_end && <button type="button" className="btn sm" onClick={() => setEnding(true)} title="End the sprint today"><Icon name="stop" size={13} />End now</button>}
          <span className="spacer" />
          <Link to="/sprint-planning" className="btn icon sm ghost" title="Open Sprint Planning" aria-label="Open Sprint Planning"><Icon name="flag" size={16} /></Link>
        </div>
        </div>
        <div className="kb-filters" role="group" aria-label="Board filters">
          {!sprintId && <>
          <div className="kb-range">
            <button className="btn icon sm" onClick={() => shift(-1)} aria-label="Previous period"><Icon name="chevronLeft" /></button>
            <span className="kb-range-label">{rangeLabel(from, to)}</span>
            <button className="btn icon sm" onClick={() => shift(1)} aria-label="Next period"><Icon name="chevronRight" /></button>
            {!isThisWeek && <button className="btn sm ghost" onClick={() => set({ from: '', to: '' })}>This week</button>}
          </div>
          <label className="kb-field"><span>From</span>
            <input type="date" value={from} max={to} onChange={(e) => e.target.value && set({ from: e.target.value })} />
          </label>
          <label className="kb-field"><span>To</span>
            <input type="date" value={to} min={from} onChange={(e) => e.target.value && set({ to: e.target.value })} />
          </label>
          </>}
          <label className="kb-field"><span>Requestor</span>
            <select value={requester} onChange={(e) => set({ requester: e.target.value })}>
              <option value="">All requestors</option>
              {requester && !(reqLoad.data || []).some(x => x.name.toLowerCase() === requester.toLowerCase()) && <option value={requester}>{requester}</option>}
              {(reqLoad.data || []).map(x => <option key={x.name} value={x.name}>{x.name}</option>)}
            </select>
          </label>
          <label className="kb-field"><span>Team Member</span>
            <select value={employee} onChange={(e) => set({ member: e.target.value, employee: '' })}>
              <option value="">All team members</option>
              <option value="me">Me</option>
              <option value="none">Unassigned</option>
              {boardPeople.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              {/^\d+$/.test(employee) && !(teamsLoad.data || []).some(t => t.members.some(m => String(m.id) === employee)) && <option value={employee}>{people.find(u => String(u.id) === employee)?.name || 'Selected person'}</option>}
            </select>
          </label>
          {!project && (
            <div className="kb-field"><span>Projects</span>
              <ProjectMultiSelect value={projectIds} onChange={(ids) => set({ project: ids.join(','), ...(ids.length === 1 && ids[0] === oneProject ? {} : { version: '' }), sprint: '' })} />
            </div>
          )}
          {oneProject && (
            <label className="kb-field kb-narrow"><span>Version</span>
              <select value={versionId} onChange={(e) => set({ version: e.target.value, sprint: '' })}>
                <option value="">Any version</option><option value="none">No version</option>
                {versions.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </label>
          )}
          <label className="kb-field kb-narrow"><span>Type</span>
            <select value={typeId} onChange={(e) => set({ type: e.target.value })}>
              <option value="">All types</option>
              {meta.types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label className="kb-field kb-narrow"><span>Location</span>
            <select value={location} onChange={(e) => set({ location: e.target.value })}>
              <option value="">All locations</option>
              {Object.entries(LOCATIONS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              <option value="none">Not set</option>
            </select>
          </label>
          {!sprintId && <label className="check small kb-undated"><input type="checkbox" checked={undated} onChange={(e) => set({ undated: e.target.checked ? '' : '0' })} /><span>Show open items<br />without dates</span></label>}
          {(employee || requester || (!project && projectId) || (!sprintId && (!isThisWeek || !undated)) || typeId || location || sprintParam || versionId) && (
            <button className="btn sm ghost" onClick={() => setSp({}, { replace: true })}>Reset</button>
          )}
          <span className="spacer" />
          <label className="kb-field kb-find"><span>Find</span>
            <input type="search" placeholder="Subject, ID or person" value={find} onChange={(e) => setFind(e.target.value)} />
          </label>
        </div>
      </div>

      <ErrorBox error={error} />
      {!data ? (error ? null : <Loading />) : (
        <div className="kb-board" ref={boardRef} style={{ '--kb-h': `calc(100vh - ${Math.round(boardTop)}px - 34px)` }}>
          {tickets && (
            <section className="kb-col" aria-label="Tickets">
              <div className="kb-col-head" style={{ '--cc': '#E5484D' }}>
                <div className="kb-col-title"><h2>Tickets</h2><span className="kb-count">{tickets.length}</span></div>
                <button type="button" className="kb-add" onClick={() => setRaising(true)} title="Raise a ticket" aria-label="Raise a ticket"><Icon name="plus" /></button>
              </div>
              <div className="kb-cards">
                {tickets.map(t => <TicketCard key={t.id} t={t} canOpen={data.can_open_tickets !== false} draggable={!!data.can_convert} dragging={dragTicket === t.ticket_no}
                  onDragStart={() => setDragTicket(t.ticket_no)} onDragEnd={() => { setDragTicket(null); setOver(null); }} />)}
                {!tickets.length && <div className="kb-empty">{needle ? 'No matching tickets' : 'No open tickets'}</div>}
              </div>
            </section>
          )}
          {columns.filter(c => !(c.key === 'rejected' && columns.some(x => x.key === 'closed'))).map(base => {
            const rejectedCol = base.key === 'closed' ? columns.find(c => c.key === 'rejected') : null;
            const col = rejectedCol && endTab === 'rejected' ? rejectedCol : base;
            const items = byColumn(col);
            return (
              <section key={base.key} className={`kb-col${over === col.key ? ' drop' : ''}`} aria-label={col.name}
                onDragOver={(e) => { if (!col.statuses.length) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (over !== col.key) setOver(col.key); }}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(o => (o === col.key ? null : o)); }}
                onDrop={(e) => {
                  e.preventDefault();
                  const payload = e.dataTransfer.getData('text/plain');
                  if (payload.startsWith('ticket:')) {
                    const ticket = data.tickets?.find(x => String(x.ticket_no) === payload.slice(7));
                    setOver(null); setDragTicket(null);
                    if (ticket && col.statuses.length) setConverting({ ticket, col });
                    return;
                  }
                  drop(col, Number(payload));
                }}>
                <div className="kb-col-head" style={{ '--cc': col.color }}>
                  {rejectedCol ? (
                    <div className="kb-switch" role="tablist" aria-label="Closed or rejected work">
                      {[base, rejectedCol].map(c => (
                        <button type="button" key={c.key} role="tab" aria-selected={col.key === c.key} className={col.key === c.key ? 'active' : ''}
                          onClick={() => chooseEnd(c.key)} onDragEnter={() => chooseEnd(c.key)} title={c.key === 'rejected' ? 'Show rejected work (drop here to reject)' : 'Show closed work'}>
                          {c.name}<span className="kb-count">{byColumn(c).length}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                  <div className="kb-col-title">
                    <h2>{col.name}</h2><span className="kb-count">{items.length}</span>
                    {(sum(items, 'estimated_hours') > 0 || sum(items, 'spent_hours') > 0) && (
                      <span className="kb-col-hours" title="Logged / estimated hours of the tasks in this column">{h(sum(items, 'spent_hours')).replace(' h', '')} / {h(sum(items, 'estimated_hours'))}</span>
                    )}
                  </div>
                  )}
                  <button type="button" className="kb-add kb-expand" onClick={() => setExpanded(col.key)} title={`Expand ${col.name}`} aria-label={`Expand ${col.name} in a larger view`}><Icon name="maximize" /></button>
                  {canCreateIn && col.statuses.length > 0 && !['closed', 'rejected'].includes(col.key) && (
                    <button type="button" className="kb-add" onClick={() => setAdding(col)} title={`Add to ${col.name}`} aria-label={`Add a task to ${col.name}`}><Icon name="plus" /></button>
                  )}
                </div>
                <div className="kb-cards">
                  {items.map(w => <Card key={w.id} w={w} dragging={dragId === w.id} onDragStart={setDragId} onDragEnd={() => { setDragId(null); setOver(null); }} />)}
                  {!items.length && <div className="kb-empty">{needle ? 'No matching cards' : sprintId ? 'Nothing here in this sprint' : 'Nothing here for this period'}</div>}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {ending && sprint && <EndModal s={sprint} open={rows.filter(r => !r.is_closed).length} others={sprints.filter(x => x.id !== sprint.id && x.state !== 'ended' && x.project_id === sprint.project_id)}
        onClose={() => setEnding(false)} onDone={() => { setEnding(false); set({ sprint: '' }); sl.reload(); reload(); }} />}
      {raising && <RaiseTicketModal onClose={() => setRaising(false)} />}
      {expanded && data && (() => {
        const c = data.columns.find(x => x.key === expanded);
        return c ? <StageModal col={c} items={byColumn(c)} columns={columns} onMove={drop} onClose={() => setExpanded(null)} /> : null;
      })()}
      {converting && (
        <NewWpModal title={`Turn ticket #${converting.ticket.ticket_no} into a task`} single
          createUrl={`/tickets/${converting.ticket.ticket_no}/convert`}
          intro={<div className="info-box small" style={{ marginBottom: 10 }}>The task starts in <b>{converting.col.name}</b> with the ticket's description and files, and stays linked to ticket #{converting.ticket.ticket_no}. When the task is closed, the ticket is solved and {converting.ticket.raised_by} is told.</div>}
          defaults={{
            subject: converting.ticket.subject_display,
            description: `${converting.ticket.description}\n\n_From ticket #${converting.ticket.ticket_no}, raised by ${converting.ticket.raised_by}._`,
            status_id: converting.col.statuses[0].id,
            ...(sprint?.can_add ? { sprint_id: sprint.id } : {}),
            ...(oneProject ? { project_id: oneProject } : {}),
          }}
          onClose={() => setConverting(null)} onCreated={() => { setConverting(null); reload(); }} />
      )}
      {adding && (
        <NewWpModal projectId={project?.id || oneProject || undefined} title={`New task in ${adding.name}`}
          defaults={{
            status_id: adding.statuses[0].id,
            assignee_id: employee === 'me' ? user.id : /^\d+$/.test(employee) ? Number(employee) : null,
            ...(sprintId ? {} : { start_date: from, due_date: to }),
            ...(sprint?.can_add ? { sprint_id: sprint.id } : {}),
          }}
          onClose={() => setAdding(null)} onCreated={() => reload()} />
      )}
      <p className="xs muted" style={{ marginTop: 10 }}>
        {sprintId ? `Shows the tasks in ${sprint?.name || 'the sprint'}. New tasks added here ${sprint?.can_add ? 'go into this sprint' : 'go to "Not in a sprint" in Sprint Planning'}.` : 'Shows work whose dates fall in the selected period.'} Drag a card to another column to change its status. <Link to={project ? `/projects/${project.identifier}/work-packages` : '/work-packages'}>Open the full list</Link>
      </p>
    </div>
  );
}
