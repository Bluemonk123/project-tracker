import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../../api.js';
import { useApp, useLoad } from '../../context.jsx';
import { Loading, ErrorBox, Empty, Key, useAsync } from '../../components/ui.jsx';
import { addDays, diffDays, today, parseDate, MONTH_NAMES, fmtDate } from '../../lib/format.js';

const ZOOMS = { day: 30, week: 14, month: 5 };
const ROW = 36;

export default function Gantt({ project }) {
  const { user } = useApp();
  const [zoom, setZoom] = useState('week');
  const [status, setStatus] = useState('open');
  const [drag, setDrag] = useState(null);
  const [, run] = useAsync();
  const scroller = useRef(null);
  const { data, error, loading, reload, setData } = useLoad(
    () => api.get('/work-packages' + qs({ project_id: project.id, status, has_dates: 1, with_relations: 1, limit: 1500, sort: 'start_date:asc' })),
    [project.id, status],
  );
  const dayW = ZOOMS[zoom];
  const canEdit = project.permissions.includes('wp.edit');
  const canEditOwn = project.permissions.includes('wp.edit_own');
  const editable = (r) => canEdit || (canEditOwn && [r.assignee_id, r.author_id, r.responsible_id].includes(user.id));

  // order rows as a tree: parents followed by their children
  const rows = useMemo(() => {
    const list = data?.rows || [];
    const ids = new Set(list.map(r => r.id));
    const kids = new Map();
    for (const r of list) {
      const p = r.parent_id && ids.has(r.parent_id) ? r.parent_id : 0;
      if (!kids.has(p)) kids.set(p, []);
      kids.get(p).push(r);
    }
    const out = [];
    const walk = (pid, depth) => (kids.get(pid) || []).forEach(r => { out.push({ ...r, depth }); walk(r.id, depth + 1); });
    walk(0, 0);
    return out;
  }, [data]);

  const range = useMemo(() => {
    const t = today();
    let start = addDays(t, -14), end = addDays(t, 60);
    for (const r of rows) {
      const s = r.start_date || r.due_date, e = r.due_date || r.start_date;
      if (s && s < start) start = s;
      if (e && e > end) end = e;
    }
    start = addDays(start, -7); end = addDays(end, 14);
    // align to Monday
    const d = parseDate(start); start = addDays(start, -((d.getDay() + 6) % 7));
    return { start, days: diffDays(end, start) + 1 };
  }, [rows]);

  useEffect(() => {
    if (scroller.current && rows.length) scroller.current.scrollLeft = Math.max(0, (diffDays(today(), range.start) - 10) * dayW);
  }, [rows.length, range.start, dayW]);

  const x = (date) => diffDays(date, range.start) * dayW;
  const width = range.days * dayW;

  const months = useMemo(() => {
    const out = [];
    let cur = range.start;
    while (diffDays(cur, range.start) < range.days) {
      const d = parseDate(cur);
      const next = `${d.getMonth() === 11 ? d.getFullYear() + 1 : d.getFullYear()}-${String(d.getMonth() === 11 ? 1 : d.getMonth() + 2).padStart(2, '0')}-01`;
      const len = Math.min(diffDays(next, cur), range.days - diffDays(cur, range.start));
      out.push({ label: `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`, w: len * dayW });
      cur = next;
    }
    return out;
  }, [range, dayW]);

  const ticks = useMemo(() => [...Array(range.days)].map((_, i) => {
    const date = addDays(range.start, i);
    const d = parseDate(date);
    return { date, day: d.getDate(), we: d.getDay() === 0 || d.getDay() === 6, monday: d.getDay() === 1 };
  }), [range]);

  const dates = (r) => {
    if (drag && drag.id === r.id) return { s: drag.s, e: drag.e };
    return { s: r.start_date || r.due_date, e: r.due_date || r.start_date };
  };

  const startDrag = (e, r, kind) => {
    if (!editable(r)) return;
    e.preventDefault(); e.stopPropagation();
    const s0 = r.start_date || r.due_date, e0 = r.due_date || r.start_date;
    const x0 = e.clientX;
    let latest = { id: r.id, s: s0, e: e0 };
    const move = (ev) => {
      const delta = Math.round((ev.clientX - x0) / dayW);
      let s = s0, en = e0;
      if (kind === 'move') { s = addDays(s0, delta); en = addDays(e0, delta); }
      if (kind === 'l') { s = addDays(s0, delta); if (s > en) s = en; }
      if (kind === 'r') { en = addDays(e0, delta); if (en < s) en = s; }
      latest = { id: r.id, s, e: en };
      setDrag(latest);
    };
    const up = async () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      if (latest.s === s0 && latest.e === e0) { setDrag(null); return; }
      const body = r.is_milestone ? { start_date: latest.s, due_date: latest.s } : { start_date: latest.s, due_date: latest.e };
      setData(d => ({ ...d, rows: d.rows.map(w => (w.id === r.id ? { ...w, ...body } : w)) }));
      setDrag(null);
      const res = await run(() => api.patch(`/work-packages/${r.id}`, body), `${r.key} moved to ${fmtDate(body.start_date)}`);
      if (!res) reload();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const index = new Map(rows.map((r, i) => [r.id, i]));
  const links = (data?.relations || []).filter(l => l.type === 'precedes' && index.has(l.from_id) && index.has(l.to_id)).map(l => {
    const a = rows[index.get(l.from_id)], b = rows[index.get(l.to_id)];
    const ad = dates(a), bd = dates(b);
    const x1 = x(ad.e) + dayW, y1 = index.get(l.from_id) * ROW + ROW / 2;
    const x2 = x(bd.s), y2 = index.get(l.to_id) * ROW + ROW / 2;
    const late = bd.s <= ad.e;
    return { id: l.id, d: `M${x1} ${y1} H${x1 + 8} V${y2} H${x2 - 2}`, late, x2, y2 };
  });

  return (
    <div className="content wide">
      <div className="row wrap" style={{ marginBottom: 14 }}>
        <div className="subtabs" aria-label="Zoom">
          {Object.keys(ZOOMS).map(z => <button key={z} className={zoom === z ? 'active' : ''} onClick={() => setZoom(z)}>{z === 'day' ? 'Days' : z === 'week' ? 'Weeks' : 'Months'}</button>)}
        </div>
        <div className="subtabs">
          <button className={status === 'open' ? 'active' : ''} onClick={() => setStatus('open')}>Open</button>
          <button className={status === 'all' ? 'active' : ''} onClick={() => setStatus('all')}>Include done</button>
        </div>
        <button className="btn sm" onClick={() => { if (scroller.current) scroller.current.scrollLeft = Math.max(0, (diffDays(today(), range.start) - 10) * dayW); }}>Jump to today</button>
        <span className="spacer" /><span className="small muted">Drag a bar to move it, drag its ends to change dates. Arrows show “precedes” relations.</span>
      </div>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : !rows.length ? (
        <div className="panel"><Empty title="Nothing to draw yet">Give work packages a start and finish date and they appear here.</Empty></div>
      ) : (
        <div className="gantt">
          <div className="gantt-left">
            <div className="gantt-head row" style={{ padding: '0 10px' }}><span className="small soft">Work package</span></div>
            {rows.map(r => (
              <div key={r.id} className="gantt-row" style={{ paddingLeft: 10 + r.depth * 16 }}>
                <Key k={r.key} color={project.color} />
                <Link to={`/wp/${r.id}`} className="ellipsis small" style={{ color: 'var(--ink)', fontWeight: r.children_count ? 600 : 400 }} title={r.subject}>{r.subject}</Link>
              </div>
            ))}
          </div>
          <div className="gantt-right" ref={scroller}>
            <div style={{ width }}>
              <div className="gantt-head">
                <div className="gantt-months">{months.map((m, i) => <div key={i} style={{ width: m.w, flex: 'none' }}>{m.w > 40 ? m.label : ''}</div>)}</div>
                <div className="gantt-days">
                  {ticks.map(t => <div key={t.date} className={t.we ? 'we' : ''} style={{ width: dayW, flex: 'none' }}>{zoom === 'day' ? t.day : zoom === 'week' && t.monday ? t.day : ''}</div>)}
                </div>
              </div>
              <div className="gantt-canvas" style={{ height: rows.length * ROW }}>
                {zoom !== 'month' && ticks.map((t, i) => t.we && <div key={t.date} className="gantt-col we" style={{ left: i * dayW, width: dayW }} />)}
                <div className="gantt-today" style={{ left: x(today()) + dayW / 2 }} title="Today" />
                {rows.map((r, i) => <div key={`l${r.id}`} style={{ position: 'absolute', left: 0, right: 0, top: (i + 1) * ROW - 1, height: 1, background: 'var(--line-2)' }} />)}
                <svg className="gantt-links" width={width} height={rows.length * ROW} aria-hidden="true">
                  <defs><marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 8 4 0 8z" fill="var(--ink-3)" /></marker>
                    <marker id="arrow-late" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 8 4 0 8z" fill="var(--danger)" /></marker></defs>
                  {links.map(l => <path key={l.id} d={l.d} fill="none" stroke={l.late ? 'var(--danger)' : 'var(--ink-3)'} strokeWidth="1.3" markerEnd={`url(#${l.late ? 'arrow-late' : 'arrow'})`} />)}
                </svg>
                {rows.map((r, i) => {
                  const { s, e } = dates(r);
                  const top = i * ROW;
                  if (r.is_milestone) {
                    return (
                      <div key={r.id}>
                        <div className="gantt-ms" style={{ top: top + 10, left: x(s) + dayW / 2 - 8, cursor: editable(r) ? 'grab' : 'default', background: r.type_color }}
                          onMouseDown={(ev) => startDrag(ev, r, 'move')} title={`${r.subject} (${fmtDate(s)})`} />
                        <span className="gantt-label" style={{ top: top + 10, left: x(s) + dayW / 2 + 14 }}>{r.subject}</span>
                      </div>
                    );
                  }
                  const left = x(s), w = Math.max(dayW, (diffDays(e, s) + 1) * dayW);
                  const pct = r.is_closed ? 100 : r.done_ratio;
                  return (
                    <div key={r.id}>
                      <div className={`gantt-bar${r.is_closed ? ' closed' : ''}`} style={{ top: top + 8, left, width: w, '--c': r.children_count ? 'var(--ink-2)' : r.type_color, cursor: editable(r) ? 'grab' : 'default' }}
                        title={`${r.key} ${r.subject}\n${fmtDate(s)} to ${fmtDate(e)}\n${r.assignee_name || 'Unassigned'}, ${pct}% done`}
                        onMouseDown={(ev) => startDrag(ev, r, 'move')}>
                        <span className="done" style={{ width: `${pct}%` }} />
                        {editable(r) && <><span className="handle l" onMouseDown={(ev) => startDrag(ev, r, 'l')} /><span className="handle r" onMouseDown={(ev) => startDrag(ev, r, 'r')} /></>}
                      </div>
                      <span className="gantt-label" style={{ top: top + 9, left: left + w + 6 }}>{r.assignee_name || ''}{drag?.id === r.id ? `  ${fmtDate(s)} to ${fmtDate(e)}` : ''}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
