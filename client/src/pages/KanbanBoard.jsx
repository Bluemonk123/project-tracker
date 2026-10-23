import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, qs } from '../api.js';
import { useApp, useLoad } from '../context.jsx';
import Icon from '../components/Icon.jsx';
import { Loading, ErrorBox, Avatar, useAsync } from '../components/ui.jsx';
import NewWpModal from './NewWpModal.jsx';
import { addDays, diffDays, fmtDate, startOfWeek, today, parseDate } from '../lib/format.js';

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

function Card({ w, column, onDragStart, onDragEnd, dragging }) {
  const nav = useNavigate();
  const overdue = !w.is_closed && w.due_date && w.due_date < today();
  const dates = cardDates(w);
  const primary = column.statuses[0];
  return (
    <article className={`kb-card${dragging ? ' dragging' : ''}`} style={{ '--tc': w.type_color }}
      draggable={w.can_edit} tabIndex={0} role="link" aria-label={`${w.key} ${w.subject}`}
      onClick={() => nav(`/wp/${w.id}`)} onKeyDown={(e) => { if (e.key === 'Enter') nav(`/wp/${w.id}`); }}
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(w.id)); e.dataTransfer.effectAllowed = 'move'; onDragStart(w.id); }}
      onDragEnd={onDragEnd}>
      <div className="kb-meta">#{w.key} - {w.project_name}</div>
      <div className="kb-title"><span className="kb-type" style={{ color: w.type_color }}>{w.type_name.toUpperCase()}</span> {w.subject}</div>
      {(w.assignee_name || dates || (primary && w.status_id !== primary.id)) && (
        <div className="kb-foot">
          {w.assignee_name ? <Avatar id={w.assignee_id} name={w.assignee_name} size="sm" /> : <span />}
          {primary && w.status_id !== primary.id && <span className="kb-status" style={{ '--c': w.status_color }}>{w.status_name}</span>}
          <span className="spacer" />
          {dates && <span className={`kb-dates${overdue ? ' overdue' : ''}`}>{dates}</span>}
        </div>
      )}
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
  const [, run] = useAsync();

  const set = (changes) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(changes)) { if (v === '' || v == null) next.delete(k); else next.set(k, v); }
    setSp(next, { replace: true });
  };
  const query = { from, to, assignee_id: employee || undefined, project_id: projectId || undefined, undated: undated ? undefined : 0 };
  const { data, error, loading, reload, setData } = useLoad(() => api.get('/board' + qs(query)), [JSON.stringify(query)]);

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
        {!project && <h1>Kanban board</h1>}
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
          {columns.map(col => {
            const items = byColumn(col);
            return (
              <section key={col.key} className={`kb-col${over === col.key ? ' drop' : ''}`} aria-label={col.name}
                onDragOver={(e) => { if (!col.statuses.length) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (over !== col.key) setOver(col.key); }}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(o => (o === col.key ? null : o)); }}
                onDrop={(e) => { e.preventDefault(); drop(col, Number(e.dataTransfer.getData('text/plain'))); }}>
                <div className="kb-col-bar" style={{ background: col.color }} />
                <div className="kb-col-head">
                  <span className="kb-col-label">Status</span>
                  <div className="row"><h2>{col.name}</h2><span className="kb-count">{items.length}</span></div>
                </div>
                {canCreateIn && col.statuses.length > 0 && (
                  <button className="kb-add" onClick={() => setAdding(col)} aria-label={`Add a work package to ${col.name}`}><Icon name="plus" /></button>
                )}
                <div className="kb-cards">
                  {items.map(w => <Card key={w.id} w={w} column={col} dragging={dragId === w.id} onDragStart={setDragId} onDragEnd={() => { setDragId(null); setOver(null); }} />)}
                  {!items.length && <div className="kb-empty">Nothing here for this period</div>}
                </div>
              </section>
            );
          })}
        </div>
      )}
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
