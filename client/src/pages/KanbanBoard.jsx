import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, qs } from '../api.js';
import { useApp, useLoad } from '../context.jsx';
import Icon from '../components/Icon.jsx';
import { Loading, ErrorBox, Avatar, useAsync } from '../components/ui.jsx';
import NewWpModal from './NewWpModal.jsx';
import { LogTimeModal } from './Time.jsx';
import RaiseTicketModal from './tickets/RaiseTicketModal.jsx';
import { TicketPriority, SlaBadge, SourceTag, CritTag } from './tickets/common.jsx';
import { RemarksModal } from './Remarks.jsx';
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

function Card({ w, column, onDragStart, onDragEnd, dragging, onLog, onRemarks }) {
  const nav = useNavigate();
  const overdue = !w.is_closed && w.due_date && w.due_date < today();
  const dates = cardDates(w);
  const primary = column.statuses[0];
  const est = w.estimated_hours || 0, spent = w.spent_hours || 0;
  const over = est > 0 && spent > est;
  return (
    <article className={`kb-card${dragging ? ' dragging' : ''}`} style={{ '--tc': w.type_color }}
      draggable={w.can_edit} tabIndex={0} role="link" aria-label={`${w.key} ${w.subject}`}
      onClick={() => nav(`/wp/${w.id}`)} onKeyDown={(e) => { if (e.key === 'Enter') nav(`/wp/${w.id}`); }}
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(w.id)); e.dataTransfer.effectAllowed = 'move'; onDragStart(w.id); }}
      onDragEnd={onDragEnd}>
      <div className="kb-meta">#{w.key} - {w.project_name}{w.ticket_no ? <span className="kb-ticket" title="Converted from this ticket"> · Ticket #{w.ticket_no}</span> : null}</div>
      <div className="kb-title">{w.subject}</div>
      {(w.criticality_name || (w.source && w.source !== 'project')) && (
        <div className="kb-tags">
          {w.criticality_name && <CritTag name={w.criticality_name} color={w.criticality_color} />}
          {w.source && w.source !== 'project' && <SourceTag source={w.source} />}
        </div>
      )}
      {(est > 0 || spent > 0 || w.can_log) && (
        <div className="kb-hours">
          <span className={`kb-hours-val${over ? ' over' : ''}`} title={`Logged ${h(spent)}${est ? ` of ${h(est)} estimated` : ''}${w.range_hours ? `; ${h(w.range_hours)} in this period` : ''}`}>
            <Icon name="clock" size={12} />{est > 0 ? <>{h(spent).replace(' h', '')} / {h(est)}</> : h(spent)}
          </span>
          {est > 0 && <span className="kb-hours-bar"><span style={{ width: `${Math.min(100, (spent / est) * 100)}%` }} className={over ? 'over' : ''} /></span>}
          {w.can_log && (
            <button type="button" className="kb-log" title="Log time on this task" aria-label={`Log time on ${w.key}`}
              onClick={(e) => { e.stopPropagation(); onLog(w); }} onKeyDown={(e) => e.stopPropagation()} draggable={false}><Icon name="plus" size={12} />Log</button>
          )}
        </div>
      )}
      {(w.remarks_count > 0 || w.can_remark) && (
        <button type="button" className={`kb-remarks${w.remarks_count ? ' has' : ''}`} draggable={false}
          title={w.remarks_count ? `${w.remarks_count} remark${w.remarks_count === 1 ? '' : 's'}` : 'Add a remark'}
          aria-label={`Remarks on ${w.key}: ${w.remarks_count}`}
          onClick={(e) => { e.stopPropagation(); onRemarks(w); }} onKeyDown={(e) => e.stopPropagation()}>
          <Icon name="chat" size={13} />{w.remarks_count ? `${w.remarks_count} remark${w.remarks_count === 1 ? '' : 's'}` : 'Add remark'}
        </button>
      )}
      <div className="kb-foot">
        {w.assignee_name ? <Avatar id={w.assignee_id} name={w.assignee_name} size="sm" /> : <span />}
        {primary && w.status_id !== primary.id && <span className="kb-status" style={{ '--c': w.status_color }}>{w.status_name}</span>}
        <span className="spacer" />
        {dates && <span className={`kb-dates${overdue ? ' overdue' : ''}`}>{dates}</span>}
        <span className="kb-type-pill" style={{ '--c': w.type_color }}>{w.type_name}</span>
      </div>
    </article>
  );
}

// A helpdesk ticket in the first column: opens it on the Ticket Board.
function TicketCard({ t, draggable, onDragStart, onDragEnd, dragging }) {
  const nav = useNavigate();
  const open = () => nav(`/ticket-board?ticket=${t.ticket_no}`);
  return (
    <article className={`kb-card${dragging ? ' dragging' : ''}`} style={{ '--tc': '#E5484D' }} tabIndex={0} role="link" aria-label={`Ticket ${t.ticket_no} ${t.subject_display}`}
      title={draggable ? 'Drag onto a task column to turn this ticket into a task' : undefined}
      draggable={draggable} onDragStart={(e) => { e.dataTransfer.setData('text/plain', `ticket:${t.ticket_no}`); e.dataTransfer.effectAllowed = 'move'; onDragStart?.(); }}
      onDragEnd={onDragEnd}
      onClick={open} onKeyDown={(e) => { if (e.key === 'Enter') open(); }}>
      <div className="kb-meta">#{t.ticket_no} - {t.group_name} · {t.requester_display}</div>
      <div className="kb-title">{t.subject_display}</div>
      <div className="kb-foot">
        {t.assignee_name ? <Avatar id={t.assignee_id} name={t.assignee_name} size="sm" /> : <span className="xs muted">Unassigned</span>}
        <TicketPriority priority={t.priority} />
        <span className="spacer" />
        <SlaBadge sla={t.sla} />
        <span className="kb-type-pill" style={{ '--c': '#E5484D' }}>Ticket</span>
      </div>
    </article>
  );
}

export default function KanbanBoard({ project }) {
  const { activeUsers, projects, user } = useApp();
  const [sp, setSp] = useSearchParams();
  const def = thisWeek();
  const from = sp.get('from') || def.from;
  const to = sp.get('to') || def.to;
  const employee = sp.get('employee') || '';
  const projectId = project ? String(project.id) : (sp.get('project') || '');
  const undated = sp.get('undated') !== '0';
  const [dragId, setDragId] = useState(null);
  const [over, setOver] = useState(null);
  const [adding, setAdding] = useState(null);
  const [logging, setLogging] = useState(null);
  const [raising, setRaising] = useState(false);
  const [remarksFor, setRemarksFor] = useState(null);
  const [converting, setConverting] = useState(null); // { ticket, col }
  const [dragTicket, setDragTicket] = useState(null);
  const [, run] = useAsync();

  const set = (changes) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(changes)) { if (v === '' || v == null) next.delete(k); else next.set(k, v); }
    setSp(next, { replace: true });
  };
  const query = { from, to, assignee_id: employee || undefined, project_id: projectId || undefined, undated: undated ? undefined : 0 };
  const { data, error, loading, reload, setData } = useLoad(() => api.get('/board' + qs(query)), [JSON.stringify(query)]);
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
  const rows = data?.rows || [];
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
    <div className="content wide kb">
      <div className="kb-head">
        {!project && <h1>Task Board</h1>}
        <div className="kb-filters" role="group" aria-label="Board filters">
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
          <label className="kb-field"><span>Employee</span>
            <select value={employee} onChange={(e) => set({ employee: e.target.value })}>
              <option value="">All employees</option>
              <option value="me">Me</option>
              <option value="none">Unassigned</option>
              {people.filter(u => u.id !== user.id).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </label>
          {!project && (
            <label className="kb-field"><span>Project</span>
              <select value={projectId} onChange={(e) => set({ project: e.target.value })}>
                <option value="">All projects</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          )}
          <label className="check small kb-undated"><input type="checkbox" checked={undated} onChange={(e) => set({ undated: e.target.checked ? '' : '0' })} /><span>Show open items<br />without dates</span></label>
          {(employee || (!project && projectId) || !isThisWeek || !undated) && (
            <button className="btn sm ghost" onClick={() => setSp({}, { replace: true })}>Reset</button>
          )}
        </div>
      </div>

      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : (
        <div className="kb-board">
          {data?.tickets && (
            <section className="kb-col" aria-label="Tickets">
              <div className="kb-col-head" style={{ '--cc': '#E5484D' }}>
                <div className="kb-col-title"><h2>Tickets</h2><span className="kb-count">{data.tickets.length}</span></div>
                <button type="button" className="kb-add" onClick={() => setRaising(true)} title="Raise a ticket" aria-label="Raise a ticket"><Icon name="plus" /></button>
              </div>
              <div className="kb-cards">
                {data.tickets.map(t => <TicketCard key={t.id} t={t} draggable={!!data.can_convert} dragging={dragTicket === t.ticket_no}
                  onDragStart={() => setDragTicket(t.ticket_no)} onDragEnd={() => { setDragTicket(null); setOver(null); }} />)}
                {!data.tickets.length && <div className="kb-empty">No open tickets</div>}
              </div>
            </section>
          )}
          {columns.map(col => {
            const items = byColumn(col);
            return (
              <section key={col.key} className={`kb-col${over === col.key ? ' drop' : ''}`} aria-label={col.name}
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
                  <div className="kb-col-title">
                    <h2>{col.name}</h2><span className="kb-count">{items.length}</span>
                    {(sum(items, 'estimated_hours') > 0 || sum(items, 'spent_hours') > 0) && (
                      <span className="kb-col-hours" title="Logged / estimated hours of the tasks in this column">{h(sum(items, 'spent_hours')).replace(' h', '')} / {h(sum(items, 'estimated_hours'))}</span>
                    )}
                  </div>
                  {canCreateIn && col.statuses.length > 0 && (
                    <button type="button" className="kb-add" onClick={() => setAdding(col)} title={`Add to ${col.name}`} aria-label={`Add a work package to ${col.name}`}><Icon name="plus" /></button>
                  )}
                </div>
                <div className="kb-cards">
                  {items.map(w => <Card key={w.id} w={w} column={col} dragging={dragId === w.id} onLog={setLogging} onRemarks={setRemarksFor} onDragStart={setDragId} onDragEnd={() => { setDragId(null); setOver(null); }} />)}
                  {!items.length && <div className="kb-empty">Nothing here for this period</div>}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {raising && <RaiseTicketModal onClose={() => setRaising(false)} />}
      {remarksFor && <RemarksModal wp={remarksFor} onClose={() => setRemarksFor(null)}
        onChanged={(n) => setData(d => ({ ...d, rows: d.rows.map(r => (r.id === remarksFor.id ? { ...r, remarks_count: n } : r)) }))} />}
      {converting && (
        <NewWpModal title={`Turn ticket #${converting.ticket.ticket_no} into a task`} single
          createUrl={`/tickets/${converting.ticket.ticket_no}/convert`}
          intro={<div className="info-box small" style={{ marginBottom: 10 }}>The task starts in <b>{converting.col.name}</b> with the ticket's description and files, and stays linked to ticket #{converting.ticket.ticket_no}. When the task is closed, the ticket is solved and {converting.ticket.raised_by} is told.</div>}
          defaults={{
            subject: converting.ticket.subject_display,
            description: `${converting.ticket.description}\n\n_From ticket #${converting.ticket.ticket_no}, raised by ${converting.ticket.raised_by}._`,
            status_id: converting.col.statuses[0].id,
            ...(projectId ? { project_id: Number(projectId) } : {}),
          }}
          onClose={() => setConverting(null)} onCreated={() => { setConverting(null); reload(); }} />
      )}
      {logging && <LogTimeModal wp={logging} onClose={() => setLogging(null)} onSaved={reload} />}
      {adding && (
        <NewWpModal projectId={project?.id || (projectId ? Number(projectId) : undefined)} title={`New task in ${adding.name}`}
          defaults={{
            status_id: adding.statuses[0].id,
            assignee_id: employee === 'me' ? user.id : /^\d+$/.test(employee) ? Number(employee) : null,
            start_date: from, due_date: to,
          }}
          onClose={() => setAdding(null)} onCreated={() => reload()} />
      )}
      <p className="xs muted" style={{ marginTop: 10 }}>
        Shows work whose dates fall in the selected period. Drag a card to another column to change its status. <Link to={project ? `/projects/${project.identifier}/work-packages` : '/work-packages'}>Open the full list</Link>
      </p>
    </div>
  );
}
