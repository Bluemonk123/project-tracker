import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, qs } from '../../api.js';
import { useApp, useLoad } from '../../context.jsx';
import Icon from '../../components/Icon.jsx';
import { Loading, ErrorBox, TypeLabel, Avatar, Due, Key, useAsync } from '../../components/ui.jsx';
import { addDays, today } from '../../lib/format.js';

export default function Board({ project }) {
  const { meta, user } = useApp();
  const nav = useNavigate();
  const [mode, setMode] = useState('status');
  const [filter, setFilter] = useState({ assignee_id: '', version_id: '', type_id: '' });
  const [hideRejected, setHideRejected] = useState(true);
  const [dragId, setDragId] = useState(null);
  const [over, setOver] = useState(null);
  const [adding, setAdding] = useState(null);
  const [newSubject, setNewSubject] = useState('');
  const [busy, run] = useAsync();
  const since = addDays(today(), -14);
  const { data, error, loading, reload, setData } = useLoad(
    () => api.get('/work-packages' + qs({ project_id: project.id, status: 'all', limit: 1000, sort: 'position:asc', ...filter })),
    [project.id, JSON.stringify(filter)],
  );
  const members = project.members.filter(m => m.status === 'active');
  // Show all open items plus anything closed in the last two weeks
  const rows = (data?.rows || []).filter(r => !r.is_closed || r.updated_at.slice(0, 10) >= since);
  const canEdit = project.permissions.includes('wp.edit');
  const canEditOwn = project.permissions.includes('wp.edit_own');
  const canAssign = project.permissions.includes('wp.assign') || canEdit;
  const editable = (r) => canEdit || (canEditOwn && [r.assignee_id, r.author_id, r.responsible_id].includes(user.id));

  const columns = useMemo(() => {
    if (mode === 'status') {
      return meta.statuses.filter(s => !(hideRejected && s.is_closed && s.name !== 'Done' && !rows.some(r => r.status_id === s.id)))
        .map(s => ({ id: s.id, title: s.name, color: s.color, field: 'status_id', items: rows.filter(r => r.status_id === s.id) }));
    }
    if (mode === 'assignee') {
      return [{ id: null, title: 'Unassigned', color: 'var(--line)', field: 'assignee_id', items: rows.filter(r => !r.assignee_id && !r.is_closed) },
        ...members.map(m => ({ id: m.user_id, title: m.name, person: m.user_id, field: 'assignee_id', items: rows.filter(r => r.assignee_id === m.user_id && !r.is_closed) }))];
    }
    return [{ id: null, title: 'No version', field: 'version_id', items: rows.filter(r => !r.version_id && !r.is_closed) },
      ...project.versions.filter(v => v.status !== 'closed').map(v => ({ id: v.id, title: v.name, field: 'version_id', items: rows.filter(r => r.version_id === v.id && !r.is_closed) }))];
  }, [mode, rows, meta.statuses, members, project.versions, hideRejected]);

  const drop = async (col, droppedId) => {
    const wp = rows.find(r => r.id === (droppedId || dragId));
    setOver(null); setDragId(null);
    if (!wp || wp[col.field] === col.id) return;
    if (!editable(wp)) return;
    if (col.field === 'assignee_id' && !canAssign && col.id !== user.id) return;
    // optimistic update
    setData(d => ({ ...d, rows: d.rows.map(r => (r.id === wp.id ? { ...r, [col.field]: col.id, ...(col.field === 'status_id' ? { status_name: col.title, status_color: col.color } : {}) } : r)) }));
    const r = await run(() => api.patch(`/work-packages/${wp.id}`, { [col.field]: col.id }));
    if (!r) reload(); else setData(d => ({ ...d, rows: d.rows.map(x => (x.id === r.id ? r : x)) }));
  };

  const quickAdd = async (col) => {
    if (!newSubject.trim()) { setAdding(null); return; }
    const body = { project_id: project.id, subject: newSubject.trim(), [col.field]: col.id };
    if (filter.version_id && col.field !== 'version_id') body.version_id = Number(filter.version_id);
    if (await run(() => api.post('/work-packages', body))) { setNewSubject(''); reload(); }
  };

  return (
    <div className="content wide">
      <div className="row wrap" style={{ marginBottom: 14 }}>
        <div className="subtabs" aria-label="Columns">
          <button className={mode === 'status' ? 'active' : ''} onClick={() => setMode('status')}>By status</button>
          <button className={mode === 'assignee' ? 'active' : ''} onClick={() => setMode('assignee')}>By person</button>
          <button className={mode === 'version' ? 'active' : ''} onClick={() => setMode('version')}>By version</button>
        </div>
        <div className="filterbar" style={{ margin: 0 }}>
          <select value={filter.assignee_id} onChange={(e) => setFilter({ ...filter, assignee_id: e.target.value })} aria-label="Assignee">
            <option value="">Everyone</option><option value="me">Only mine</option>{members.map(m => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}
          </select>
          <select value={filter.version_id} onChange={(e) => setFilter({ ...filter, version_id: e.target.value })} aria-label="Version">
            <option value="">Any version</option>{project.versions.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <select value={filter.type_id} onChange={(e) => setFilter({ ...filter, type_id: e.target.value })} aria-label="Type">
            <option value="">Any type</option>{meta.types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        {mode === 'status' && <label className="check small"><input type="checkbox" checked={hideRejected} onChange={(e) => setHideRejected(e.target.checked)} />Hide empty closed columns</label>}
        <span className="spacer" /><span className="small muted">Drag cards between columns. Done items stay visible for 14 days.</span>
      </div>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : (
        <div className="board">
          {columns.map(col => (
            <section key={String(col.id)} className={`board-col${over === col.id ? ' drop' : ''}`} aria-label={col.title}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (over !== col.id) setOver(col.id); }} onDragLeave={() => setOver(o => (o === col.id ? null : o))} onDrop={(e) => { e.preventDefault(); drop(col, Number(e.dataTransfer.getData('text/plain'))); }}>
              <div className="board-col-head">
                {col.person ? <Avatar id={col.person} name={col.title} size="sm" /> : <span style={{ width: 9, height: 9, borderRadius: 5, background: col.color || 'var(--ink-3)' }} />}
                <span className="ellipsis">{col.title}</span><span className="n">{col.items.length}</span>
                {project.permissions.includes('wp.create') && mode === 'status' && (
                  <button className="icon-btn" style={{ marginLeft: 'auto' }} aria-label={`Add to ${col.title}`} onClick={() => { setAdding(col.id); setNewSubject(''); }}><Icon name="plus" /></button>
                )}
              </div>
              <div className="board-cards">
                {adding === col.id && (
                  <div className="card" style={{ cursor: 'default' }}>
                    <input type="text" autoFocus value={newSubject} placeholder="Subject, then Enter" disabled={busy}
                      onChange={(e) => setNewSubject(e.target.value)} onBlur={() => quickAdd(col)}
                      onKeyDown={(e) => { if (e.key === 'Enter') quickAdd(col); if (e.key === 'Escape') setAdding(null); }} />
                  </div>
                )}
                {col.items.map(r => (
                  <article key={r.id} className={`card${dragId === r.id ? ' dragging' : ''}`} draggable={editable(r)} style={{ '--pc': r.priority_position >= 2 ? r.priority_color : project.color, cursor: editable(r) ? 'grab' : 'default' }}
                    tabIndex={0} role="link" aria-label={`${r.key} ${r.subject}`}
                    onClick={() => nav(`/wp/${r.id}`)} onKeyDown={(e) => { if (e.key === 'Enter') nav(`/wp/${r.id}`); }}
                    onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(r.id)); e.dataTransfer.effectAllowed = 'move'; setDragId(r.id); }} onDragEnd={() => { setDragId(null); setOver(null); }}>
                    <div className="row"><Key k={r.key} color={project.color} /><TypeLabel name={r.type_name} color={r.type_color} />
                      {r.priority_position >= 2 && <span className="tag" style={{ marginLeft: 'auto', color: r.priority_color }}>{r.priority_name}</span>}
                    </div>
                    <div className="card-subject">{r.subject}</div>
                    <div className="card-foot">
                      {mode !== 'assignee' && (r.assignee_name ? <Avatar id={r.assignee_id} name={r.assignee_name} size="sm" /> : <span className="xs muted">Unassigned</span>)}
                      {mode !== 'status' && <span className="pill" style={{ '--c': r.status_color }}>{r.status_name}</span>}
                      <span className="spacer" />
                      {r.due_date && <Due date={r.due_date} closed={r.is_closed} />}
                    </div>
                    {r.children_count > 0 && <div className="xs muted" style={{ marginTop: 6 }}>{r.children_count} child items</div>}
                  </article>
                ))}
                {!col.items.length && adding !== col.id && <div className="xs muted" style={{ padding: '8px 4px', textAlign: 'center' }}>Drop cards here</div>}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
