import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../../api.js';
import { useLoad } from '../../context.jsx';
import Icon from '../../components/Icon.jsx';
import { Loading, ErrorBox } from '../../components/ui.jsx';
import { addDays, isoDate, parseDate, today, MONTH_NAMES, DAY_NAMES, fmtTime } from '../../lib/format.js';

export default function Calendar({ project }) {
  const [month, setMonth] = useState(() => today().slice(0, 7));
  const [show, setShow] = useState({ due: true, start: false, meetings: true, mine: false });
  const first = `${month}-01`;
  const d0 = parseDate(first);
  const gridStart = addDays(first, -((d0.getDay() + 6) % 7));
  const days = [...Array(42)].map((_, i) => addDays(gridStart, i));
  const gridEnd = days[41];
  const wps = useLoad(() => api.get('/work-packages' + qs({ project_id: project?.id, status: 'all', from: gridStart, to: gridEnd, limit: 1500, assignee_id: show.mine ? 'me' : undefined })), [project?.id, gridStart, show.mine]);
  const meetings = useLoad(() => api.get('/meetings' + qs({ project_id: project?.id, from: gridStart, to: gridEnd })), [project?.id, gridStart]);

  const byDay = useMemo(() => {
    const m = new Map(days.map(d => [d, []]));
    for (const w of wps.data?.rows || []) {
      if (show.due && w.due_date && m.has(w.due_date)) m.get(w.due_date).push({ kind: 'due', w });
      if (show.start && w.start_date && w.start_date !== w.due_date && m.has(w.start_date)) m.get(w.start_date).push({ kind: 'start', w });
    }
    if (show.meetings) for (const mt of meetings.data || []) { const d = mt.starts_at.slice(0, 10); if (m.has(d)) m.get(d).push({ kind: 'meeting', m: mt }); }
    return m;
  }, [wps.data, meetings.data, show, gridStart]); // eslint-disable-line react-hooks/exhaustive-deps

  const shift = (n) => { const d = parseDate(first); d.setMonth(d.getMonth() + n); setMonth(isoDate(d).slice(0, 7)); };
  const t = today();
  return (
    <div className="content wide">
      <div className="row wrap" style={{ marginBottom: 14 }}>
        <button className="btn icon sm" onClick={() => shift(-1)} aria-label="Previous month"><Icon name="chevronLeft" /></button>
        <h2 style={{ minWidth: 180, textAlign: 'center', fontSize: 18 }}>{MONTH_NAMES[d0.getMonth()]} {d0.getFullYear()}</h2>
        <button className="btn icon sm" onClick={() => shift(1)} aria-label="Next month"><Icon name="chevronRight" /></button>
        {month !== t.slice(0, 7) && <button className="btn sm ghost" onClick={() => setMonth(t.slice(0, 7))}>Today</button>}
        <span className="spacer" />
        <label className="check small"><input type="checkbox" checked={show.due} onChange={(e) => setShow({ ...show, due: e.target.checked })} />Finish dates</label>
        <label className="check small"><input type="checkbox" checked={show.start} onChange={(e) => setShow({ ...show, start: e.target.checked })} />Start dates</label>
        <label className="check small"><input type="checkbox" checked={show.meetings} onChange={(e) => setShow({ ...show, meetings: e.target.checked })} />Meetings</label>
        <label className="check small"><input type="checkbox" checked={show.mine} onChange={(e) => setShow({ ...show, mine: e.target.checked })} />Only my work</label>
      </div>
      <ErrorBox error={wps.error || meetings.error} />
      {(wps.loading && !wps.data) ? <Loading /> : (
        <div className="cal">
          <div className="cal-head">{[1, 2, 3, 4, 5, 6, 0].map(i => <div key={i}>{DAY_NAMES[i]}</div>)}</div>
          <div className="cal-grid">
            {days.map(d => {
              const items = byDay.get(d) || [];
              return (
                <div key={d} className={`cal-cell${d.slice(0, 7) !== month ? ' other' : ''}${d === t ? ' today' : ''}`}>
                  <span className="d">{parseDate(d).getDate()}</span>
                  {items.slice(0, 5).map((it, i) => it.kind === 'meeting' ? (
                    <Link key={`m${it.m.id}`} to={`/meetings/${it.m.id}`} className="cal-item meeting" style={{ '--c': it.m.project_color || 'var(--ink-3)' }} title={it.m.title}>
                      {fmtTime(it.m.starts_at)} {it.m.title}
                    </Link>
                  ) : (
                    <Link key={`${it.kind}${it.w.id}${i}`} to={`/wp/${it.w.id}`} className="cal-item" style={{ '--c': it.w.is_closed ? 'var(--ink-3)' : it.w.type_color, textDecoration: it.w.is_closed ? 'line-through' : undefined }}
                      title={`${it.w.key} ${it.w.subject} (${it.kind === 'start' ? 'starts' : 'finish'})`}>
                      {it.kind === 'start' ? '▸ ' : ''}{it.w.key} {it.w.subject}
                    </Link>
                  ))}
                  {items.length > 5 && <span className="xs muted">and {items.length - 5} more</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
