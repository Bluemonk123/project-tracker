import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../../api.js';
import { useApp, useLoad } from '../../context.jsx';
import Icon from '../../components/Icon.jsx';
import { Loading, ErrorBox, Empty, StatusPill, Key, Person, Progress, Due, TypeLabel } from '../../components/ui.jsx';
import NewWpModal from '../NewWpModal.jsx';

export default function Requirements({ project }) {
  const { meta } = useApp();
  const parentTypes = meta.types.filter(t => ['Requirement', 'Epic', 'Feature', 'User story'].includes(t.name));
  const [typeId, setTypeId] = useState(meta.types.find(t => t.name === 'Requirement')?.id || meta.types[0].id);
  const [showClosed, setShowClosed] = useState(true);
  const [open, setOpen] = useState({});
  const [modal, setModal] = useState(null);
  const { data, error, loading, reload } = useLoad(() => api.get('/work-packages' + qs({ project_id: project.id, status: 'all', limit: 2000, sort: 'key:asc' })), [project.id]);

  const { reqs, childrenOf } = useMemo(() => {
    const rows = data?.rows || [];
    const childrenOf = new Map();
    for (const r of rows) if (r.parent_id) { if (!childrenOf.has(r.parent_id)) childrenOf.set(r.parent_id, []); childrenOf.get(r.parent_id).push(r); }
    return { reqs: rows.filter(r => r.type_id === Number(typeId) && (showClosed || !r.is_closed)), childrenOf };
  }, [data, typeId, showClosed]);

  const descendants = (id) => {
    const out = [];
    const walk = (pid) => (childrenOf.get(pid) || []).forEach(c => { out.push(c); walk(c.id); });
    walk(id);
    return out;
  };
  const canCreate = project.permissions.includes('wp.create');
  const typeName = meta.types.find(t => t.id === Number(typeId))?.name || 'Requirement';
  const coverage = reqs.length ? reqs.filter(r => (childrenOf.get(r.id) || []).length > 0).length : 0;

  return (
    <div className="content">
      <div className="page-head">
        <div className="grow">
          <h2>{typeName === 'Requirement' ? 'Requirements' : `${typeName}s`}</h2>
          <p>Each {typeName.toLowerCase()} with the tasks that deliver it. Progress comes from those tasks.</p>
        </div>
        <div className="head-actions">
          <div className="subtabs">{parentTypes.map(t => <button key={t.id} className={Number(typeId) === t.id ? 'active' : ''} onClick={() => setTypeId(t.id)}>{t.name}</button>)}</div>
          <label className="check small"><input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />Show done</label>
          {canCreate && <button className="btn primary" onClick={() => setModal({ type_id: Number(typeId) })}><Icon name="plus" />New {typeName.toLowerCase()}</button>}
        </div>
      </div>
      {reqs.length > 0 && (
        <div className="figures">
          <div className="figure"><div className="n">{reqs.length}</div><div className="l">{typeName}s</div></div>
          <div className="figure"><div className="n">{reqs.filter(r => r.is_closed).length}</div><div className="l">Done</div></div>
          <div className={`figure${coverage < reqs.length ? ' signal' : ''}`}><div className="n">{coverage}/{reqs.length}</div><div className="l">Broken down into tasks</div></div>
          <div className="figure"><div className="n">{reqs.filter(r => !r.is_closed && r.due_date && r.due_date < new Date().toISOString().slice(0, 10)).length}</div><div className="l">Past their finish date</div></div>
        </div>
      )}
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : !reqs.length ? (
        <div className="panel"><Empty title={`No ${typeName.toLowerCase()}s yet`} action={canCreate && <button className="btn primary" onClick={() => setModal({ type_id: Number(typeId) })}><Icon name="plus" />Add the first one</button>}>
          Capture what the application must do as {typeName.toLowerCase()}s, then add tasks under each one.
        </Empty></div>
      ) : (
        <div className="panel">
          {reqs.map(r => {
            const kids = descendants(r.id);
            const done = kids.filter(k => k.is_closed).length;
            const pct = r.is_closed ? 100 : kids.length ? (done / kids.length) * 100 : r.done_ratio;
            const isOpen = open[r.id];
            return (
              <div key={r.id} style={{ borderBottom: '1px solid var(--line-2)' }}>
                <div className="child-row" style={{ padding: '12px 14px', borderBottom: 0 }}>
                  <button className="icon-btn" onClick={() => setOpen(o => ({ ...o, [r.id]: !o[r.id] }))} aria-expanded={!!isOpen} aria-label={isOpen ? 'Collapse' : 'Expand'} disabled={!kids.length}
                    style={{ transform: isOpen ? 'rotate(90deg)' : 'none', opacity: kids.length ? 1 : 0.3 }}><Icon name="chevronRight" /></button>
                  <Key k={r.key} color={project.color} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <Link to={`/wp/${r.id}`} className="ellipsis" style={{ display: 'block', color: 'var(--ink)', fontWeight: 560 }}>{r.subject}</Link>
                    <span className="xs muted">{kids.length ? `${done} of ${kids.length} tasks done` : 'Not broken down yet'}{r.version_name ? `, ${r.version_name}` : ''}</span>
                  </div>
                  <span style={{ width: 150 }} className="hide-sm"><Progress value={pct} color={project.color} /></span>
                  <span className="hide-sm" style={{ width: 120, textAlign: 'right' }}><Due date={r.due_date} closed={r.is_closed} /></span>
                  <StatusPill name={r.status_name} color={r.status_color} />
                  {canCreate && <button className="btn sm ghost" onClick={() => setModal({ parent_id: r.id, version_id: r.version_id || '' })} title="Add a task under this"><Icon name="plus" /><span className="hide-sm">Task</span></button>}
                </div>
                {isOpen && kids.map(k => (
                  <div key={k.id} className="child-row" style={{ paddingLeft: 58, background: 'var(--surface-2)' }}>
                    <Key k={k.key} color={project.color} /><TypeLabel name={k.type_name} color={k.type_color} />
                    <Link to={`/wp/${k.id}`} className="ellipsis grow" style={{ color: 'var(--ink)' }}>{k.parent_id !== r.id && <span className="muted">↳ </span>}{k.subject}</Link>
                    <Person id={k.assignee_id} name={k.assignee_name} muted="" />
                    <span className="hide-sm" style={{ width: 110, textAlign: 'right' }}><Due date={k.due_date} closed={k.is_closed} /></span>
                    <StatusPill name={k.status_name} color={k.status_color} />
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
      {modal && <NewWpModal projectId={project.id} defaults={modal} title={modal.parent_id ? 'New task' : `New ${typeName.toLowerCase()}`} onClose={() => setModal(null)} onCreated={() => { reload(); if (modal.parent_id) setOpen(o => ({ ...o, [modal.parent_id]: true })); }} />}
    </div>
  );
}
