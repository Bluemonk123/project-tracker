import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, qs } from '../api.js';
import { useApp, useLoad } from '../context.jsx';
import Icon from '../components/Icon.jsx';
import { Loading, ErrorBox, Empty, StatusPill, TypeLabel, Priority, Due, Person, Key, Progress, useAsync, Popover } from '../components/ui.jsx';
import NewWpModal from './NewWpModal.jsx';
import { fmtHours } from '../lib/format.js';

const PRESETS = [
  { id: 'open', label: 'All open', params: { status: 'open' } },
  { id: 'mine', label: 'Assigned to me', params: { status: 'open', assignee_id: 'me' } },
  { id: 'overdue', label: 'Overdue', params: { status: 'open', overdue: '1' } },
  { id: 'unassigned', label: 'Unassigned', params: { status: 'open', assignee_id: 'none' } },
  { id: 'watched', label: 'Watching', params: { status: 'open', watched: '1' } },
  { id: 'recent', label: 'Recently changed', params: { status: 'all', sort: 'updated_at:desc' } },
  { id: 'closed', label: 'Closed', params: { status: 'closed', sort: 'updated_at:desc' } },
];

const FILTER_KEYS = ['status', 'type_id', 'assignee_id', 'priority_id', 'version_id', 'project_id', 'q', 'overdue', 'watched', 'sort', 'group'];

export default function WorkPackages({ project }) {
  const { meta, projects, activeUsers, can } = useApp();
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState([]);
  const [limit, setLimit] = useState(200);
  const [busy, run] = useAsync();

  const params = Object.fromEntries(FILTER_KEYS.map(k => [k, sp.get(k) ?? undefined]));
  params.status ??= 'open';
  params.sort ??= 'id:desc';
  const group = params.group || '';
  const query = { ...params, group: undefined, project_id: project ? project.id : params.project_id, limit };
  const { data, error, loading, reload } = useLoad(() => api.get('/work-packages' + qs(query)), [JSON.stringify(query)]);

  const setParam = (k, v) => {
    const next = new URLSearchParams(sp);
    if (v === undefined || v === '' || v === null) next.delete(k); else next.set(k, v);
    setSp(next, { replace: true });
    setSelected([]);
  };
  const applyPreset = (p) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(p.params)) next.set(k, v);
    if (sp.get('group')) next.set('group', sp.get('group'));
    setSp(next, { replace: true });
    setSelected([]);
  };
  const activePreset = PRESETS.find(p => {
    const keys = new Set([...Object.keys(p.params), ...FILTER_KEYS.filter(k => k !== 'group' && sp.get(k) != null)]);
    return [...keys].every(k => (p.params[k] ?? (k === 'status' ? 'open' : k === 'sort' ? 'id:desc' : undefined)) === (sp.get(k) ?? (k === 'status' ? 'open' : k === 'sort' ? 'id:desc' : undefined)));
  });

  const sortBy = (field) => {
    const [cur, dir] = (params.sort || '').split(':');
    setParam('sort', `${field}:${cur === field && dir === 'asc' ? 'desc' : 'asc'}`);
  };
  const sortMark = (field) => { const [cur, dir] = (params.sort || '').split(':'); return cur === field ? (dir === 'asc' ? ' ↑' : ' ↓') : ''; };

  const rows = data?.rows || [];
  const groups = useMemo(() => {
    if (!group) return [{ key: 'all', label: null, rows }];
    const field = { status: 'status_name', assignee: 'assignee_name', type: 'type_name', project: 'project_name', version: 'version_name', priority: 'priority_name', parent: 'parent_subject' }[group];
    const map = new Map();
    for (const r of rows) {
      const k = r[field] || (group === 'assignee' ? 'Unassigned' : group === 'parent' ? 'No parent' : 'None');
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(r);
    }
    return [...map.entries()].map(([k, v]) => ({ key: k, label: k, rows: v }));
  }, [rows, group]);

  const projectInfo = project;
  const canCreate = project ? project.permissions.includes('wp.create') : projects.length > 0;
  const allSelected = rows.length > 0 && selected.length === rows.length;

  const bulk = async (changes) => {
    const r = await run(() => api.patch('/work-packages-bulk', { ids: selected, changes }), `${selected.length} work package(s) updated`);
    if (r) { setSelected([]); reload(); }
  };

  const exportUrl = '/api/work-packages/export.csv' + qs({ ...query, limit: undefined });
  const cols = project ? 8 : 9;

  return (
    <div className={`content${project ? '' : ''}`}>
      {!project && (
        <div className="page-head">
          <div className="grow"><h1>All work</h1><p>Work packages across every project you can see.</p></div>
        </div>
      )}
      <div className="row wrap" style={{ marginBottom: 12 }}>
        <div className="subtabs" role="tablist" aria-label="Saved views">
          {PRESETS.map(p => <button key={p.id} type="button" className={activePreset?.id === p.id ? 'active' : ''} onClick={() => applyPreset(p)}>{p.label}</button>)}
        </div>
        <span className="spacer" />
        <a className="btn sm" href={exportUrl}><Icon name="download" />Export CSV</a>
        <button type="button" className="btn sm" onClick={() => window.print()}><Icon name="printer" />Print</button>
        {canCreate && <button type="button" className="btn primary" onClick={() => setCreating(true)}><Icon name="plus" />New work package</button>}
      </div>

      <div className="filterbar" role="group" aria-label="Filters">
        <input type="search" placeholder="Filter by subject or key" defaultValue={params.q || ''} aria-label="Filter by text"
          onKeyDown={(e) => { if (e.key === 'Enter') setParam('q', e.target.value.trim()); }}
          onBlur={(e) => { if ((e.target.value.trim() || undefined) !== params.q) setParam('q', e.target.value.trim()); }} />
        <select value={params.status} onChange={(e) => setParam('status', e.target.value)} aria-label="Status">
          <option value="open">Open</option><option value="closed">Closed</option><option value="all">Any status</option>
          {meta.statuses.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={params.type_id || ''} onChange={(e) => setParam('type_id', e.target.value)} aria-label="Type">
          <option value="">Any type</option>{meta.types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select value={params.assignee_id || ''} onChange={(e) => setParam('assignee_id', e.target.value)} aria-label="Assignee">
          <option value="">Anyone</option><option value="me">Me</option><option value="none">Unassigned</option>
          {activeUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select value={params.priority_id || ''} onChange={(e) => setParam('priority_id', e.target.value)} aria-label="Priority">
          <option value="">Any priority</option>{meta.priorities.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {project ? (
          <select value={params.version_id || ''} onChange={(e) => setParam('version_id', e.target.value)} aria-label="Version">
            <option value="">Any version</option><option value="none">No version</option>
            {projectInfo.versions.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        ) : (
          <select value={params.project_id || ''} onChange={(e) => setParam('project_id', e.target.value)} aria-label="Project">
            <option value="">All projects</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        <select value={group} onChange={(e) => setParam('group', e.target.value)} aria-label="Group by">
          <option value="">No grouping</option><option value="status">Group by status</option><option value="assignee">Group by assignee</option>
          <option value="type">Group by type</option><option value="priority">Group by priority</option><option value="parent">Group by parent</option>
          {project ? <option value="version">Group by version</option> : <option value="project">Group by project</option>}
        </select>
        {[...sp.keys()].some(k => !['group'].includes(k)) && <button type="button" className="btn sm ghost" onClick={() => setSp(group ? { group } : {}, { replace: true })}>Reset filters</button>}
      </div>

      {selected.length > 0 && (
        <div className="bulkbar">
          <b className="small">{selected.length} selected</b>
          <select aria-label="Set status" value="" onChange={(e) => e.target.value && bulk({ status_id: Number(e.target.value) })} disabled={busy}>
            <option value="">Set status…</option>{meta.statuses.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select aria-label="Set assignee" value="" onChange={(e) => e.target.value && bulk({ assignee_id: e.target.value === 'none' ? null : Number(e.target.value) })} disabled={busy}>
            <option value="">Assign to…</option><option value="none">Nobody</option>{activeUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <select aria-label="Set priority" value="" onChange={(e) => e.target.value && bulk({ priority_id: Number(e.target.value) })} disabled={busy}>
            <option value="">Set priority…</option>{meta.priorities.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {project && (
            <select aria-label="Set version" value="" onChange={(e) => e.target.value && bulk({ version_id: e.target.value === 'none' ? null : Number(e.target.value) })} disabled={busy}>
              <option value="">Set version…</option><option value="none">No version</option>{project.versions.filter(v => v.status === 'open').map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          )}
          <input type="date" aria-label="Set finish date" style={{ width: 150, height: 30 }} onChange={(e) => e.target.value && bulk({ due_date: e.target.value })} disabled={busy} />
          <button type="button" className="btn sm ghost" onClick={() => setSelected([])}>Clear selection</button>
        </div>
      )}

      <ErrorBox error={error} />
      <div className="panel">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 34 }}><input type="checkbox" checked={allSelected} aria-label="Select all"
                  onChange={() => setSelected(allSelected ? [] : rows.map(r => r.id))} /></th>
                <th className="sortable" onClick={() => sortBy('key')}>ID{sortMark('key')}</th>
                <th className="sortable" onClick={() => sortBy('type')}>Type{sortMark('type')}</th>
                <th className="sortable" onClick={() => sortBy('subject')}>Subject{sortMark('subject')}</th>
                <th className="sortable" onClick={() => sortBy('status')}>Status{sortMark('status')}</th>
                <th className="sortable" onClick={() => sortBy('assignee')}>Assignee{sortMark('assignee')}</th>
                <th className="sortable hide-sm" onClick={() => sortBy('priority')}>Priority{sortMark('priority')}</th>
                <th className="sortable" onClick={() => sortBy('due_date')}>Finish{sortMark('due_date')}</th>
                {!project && <th className="sortable hide-sm" onClick={() => sortBy('project')}>Project{sortMark('project')}</th>}
                <th className="hide-sm" style={{ width: 130 }}>Progress</th>
              </tr>
            </thead>
            <tbody>
              {loading && !data && <tr><td colSpan={cols + 1}><Loading /></td></tr>}
              {groups.map(g => (
                <GroupRows key={g.key} label={g.label} rows={g.rows} colSpan={cols + 1} project={project} selected={selected}
                  onToggle={(id) => setSelected(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]))} onOpen={(id) => nav(`/wp/${id}`)} />
              ))}
            </tbody>
          </table>
        </div>
        {data && !rows.length && (
          <Empty title="No work packages match" action={canCreate && <button className="btn primary" onClick={() => setCreating(true)}><Icon name="plus" />New work package</button>}>
            Change the filters above, or create the first item for this list.
          </Empty>
        )}
        {data && (
          <div className="row between small muted" style={{ padding: '10px 14px', borderTop: '1px solid var(--line-2)' }}>
            <span>Showing {rows.length} of {data.total}{rows.length ? `, ${fmtHours(rows.reduce((s, r) => s + (r.estimated_hours || 0), 0))} estimated` : ''}</span>
            {data.total > rows.length && <button className="btn sm" onClick={() => setLimit(l => l + 300)}>Show more</button>}
          </div>
        )}
      </div>
      {creating && <NewWpModal projectId={project?.id} onClose={() => setCreating(false)} onCreated={() => reload()} />}
    </div>
  );
}

function GroupRows({ label, rows, colSpan, project, selected, onToggle, onOpen }) {
  return (
    <>
      {label && <tr className="group-row"><td colSpan={colSpan}>{label} <span className="muted">({rows.length})</span></td></tr>}
      {rows.map(r => (
        <tr key={r.id} className={selected.includes(r.id) ? 'selected' : ''} style={{ cursor: 'pointer' }}
          onClick={(e) => { if (!e.target.closest('input,a,button')) onOpen(r.id); }}>
          <td><input type="checkbox" checked={selected.includes(r.id)} onChange={() => onToggle(r.id)} aria-label={`Select ${r.key}`} /></td>
          <td><Key k={r.key} color={r.project_color} /></td>
          <td><TypeLabel name={r.type_name} color={r.type_color} /></td>
          <td className="subject">
            <Link to={`/wp/${r.id}`} style={{ color: 'var(--ink)' }} className="ellipsis" title={r.subject}>{r.subject}</Link>
            {r.parent_key && <div className="xs muted ellipsis">in {r.parent_key} {r.parent_subject}</div>}
          </td>
          <td><StatusPill name={r.status_name} color={r.status_color} /></td>
          <td><Person id={r.assignee_id} name={r.assignee_name} /></td>
          <td className="hide-sm"><Priority name={r.priority_name} color={r.priority_color} position={r.priority_position} /></td>
          <td><Due date={r.due_date} closed={r.is_closed} /></td>
          {!project && <td className="hide-sm small soft ellipsis" style={{ maxWidth: 160 }}>{r.project_name}</td>}
          <td className="hide-sm"><Progress value={r.is_closed ? 100 : r.done_ratio} color={r.status_color} /></td>
        </tr>
      ))}
    </>
  );
}
