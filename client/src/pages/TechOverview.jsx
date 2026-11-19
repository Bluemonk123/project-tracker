import { useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, qs } from '../api.js';
import { useLoad } from '../context.jsx';
import Icon from '../components/Icon.jsx';
import { Loading, ErrorBox, Empty, useAsync, confirmDialog } from '../components/ui.jsx';
import { TechTable, TechModal } from './project/Technologies.jsx';

// Company-wide list of every technology used and which version each project runs.
export default function TechOverview() {
  const force = useRef(false);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [params, setParams] = useSearchParams();
  const project = params.get('project') || '';
  const group = params.get('group') || 'project'; // 'project' or 'none' (one list, by technology)
  const [closed, setClosed] = useState(() => new Set());
  const setParam = (k, v) => { const n = new URLSearchParams(params); if (!v) n.delete(k); else n.set(k, v); setParams(n, { replace: true }); };
  const setProject = (k) => setParam('project', k);
  const [editing, setEditing] = useState(null);
  const [, run] = useAsync();
  const { data, error, loading, reload } = useLoad(() => { const r = force.current; force.current = false; return api.get('/technologies' + qs({ refresh: r ? 1 : undefined })); }, []);
  const projects = useMemo(() => [...new Map((data?.rows || []).map(t => [t.project_identifier, t.project_name])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1])), [data]);
  const rows = useMemo(() => (data?.rows || []).filter(t =>
    (!project || t.project_identifier === project)
    && (!q || `${t.name} ${t.project_name} ${t.category}`.toLowerCase().includes(q.toLowerCase()))
    && (!status || t.assessment.status === status || (status === 'update' && ['minor', 'patch', 'major'].includes(t.assessment.status)))), [data, q, status, project]);
  const del = async (t) => {
    if (await confirmDialog({ title: `Delete ${t.name}?`, message: `${t.name} is removed from ${t.project_name}'s technologies.`, confirmLabel: 'Delete', danger: true })) {
      if (await run(() => api.del(`/technologies/${t.id}`), `${t.name} deleted`)) reload();
    }
  };
  // sections, one per project, in name order
  const groups = useMemo(() => {
    const m = new Map();
    for (const t of rows) {
      if (!m.has(t.project_id)) m.set(t.project_id, { id: t.project_id, name: t.project_name, key: t.project_identifier, color: t.project_color, rows: [] });
      m.get(t.project_id).rows.push(t);
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);
  const summary = (list) => {
    const n = (...st) => list.filter(t => st.includes(t.assessment?.status)).length;
    return [['danger', n('eol'), 'out of support'], ['signal', n('major'), 'major behind'], ['accent', n('minor', 'patch'), 'update'], ['ok', n('latest'), 'up to date']].filter(x => x[1]);
  };
  const toggle = (id) => setClosed(c => { const x = new Set(c); if (x.has(id)) x.delete(id); else x.add(id); return x; });
  const distinct = new Set((data?.rows || []).map(t => t.name.toLowerCase())).size;
  return (
    <div className="content">
      <div className="page-head">
        <div className="grow"><h1>Technologies</h1><p>Every framework, language, database and tool used across projects, and how current each version is.</p></div>
        <div className="head-actions">
          <button className="btn" disabled={loading} onClick={() => { force.current = true; reload(); }}><Icon name="activity" />{loading ? 'Checking…' : 'Check for updates'}</button>
        </div>
      </div>
      <div className="filterbar">
        <input type="search" placeholder="Filter by technology" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={project} onChange={(e) => setProject(e.target.value)} aria-label="Project">
          <option value="">All projects</option>
          {projects.map(([k, name]) => <option key={k} value={k}>{name} ({k})</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">Any status</option><option value="eol">Out of support</option><option value="update">Update available</option>
          <option value="major">Major version behind</option><option value="latest">Up to date</option><option value="unknown">Not checked</option>
        </select>
        <div className="seg" role="group" aria-label="Group by">
          <button type="button" className={group === 'project' ? 'active' : ''} onClick={() => setParam('group', '')}>By project</button>
          <button type="button" className={group === 'none' ? 'active' : ''} onClick={() => setParam('group', 'none')}>By technology</button>
        </div>
        {group === 'project' && groups.length > 1 && <button type="button" className="btn ghost sm" onClick={() => setClosed(closed.size ? new Set() : new Set(groups.map(g => g.id)))}>{closed.size ? 'Expand all' : 'Collapse all'}</button>}
        {(q || status || project) && <button type="button" className="btn ghost sm" onClick={() => { setQ(''); setStatus(''); setProject(''); }}>Reset</button>}
        {data && <span className="small muted">{project || q || status ? `${rows.length} of ${data.rows.length} shown` : `${distinct} technologies in ${new Set(data.rows.map(t => t.project_id)).size} projects`}</span>}
      </div>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : !rows.length ? (
        <div className="panel"><Empty title={data?.rows?.length ? 'Nothing matches' : 'No technologies listed yet'}>
          {data?.rows?.length ? 'Change the filters above.' : 'Open a project and use its Technologies tab to list what it is built with.'}
        </Empty></div>
      ) : group === 'project' ? (
        <div className="tech-groups">
          {groups.map(g => {
            const open = !closed.has(g.id);
            return (
              <section key={g.id} className="panel tech-group" style={{ '--pc': g.color }}>
                <div className="tech-group-head">
                  <button type="button" className="tech-group-toggle" onClick={() => toggle(g.id)} aria-expanded={open}>
                    <Icon name={open ? 'chevronDown' : 'chevronRight'} size={16} />
                    <span className="key" style={{ '--pc': g.color }}>{g.key}</span>
                    <b>{g.name}</b>
                    <span className="kb-count">{g.rows.length}</span>
                  </button>
                  <span className="tech-group-sums">{summary(g.rows).map(([tone, n, l]) => <span key={l} className={`tag ${tone}`}>{n} {l}</span>)}</span>
                  <span className="spacer" />
                  <Link className="btn sm ghost" to={`/projects/${g.key}/technologies`}>Open project list</Link>
                </div>
                {open && <TechTable rows={g.rows} canEdit={false} onSaved={reload} onEdit={setEditing} onDelete={del} />}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="panel"><TechTable rows={rows} showProject canEdit={false} onSaved={reload} onEdit={setEditing} onDelete={del} /></div>
      )}
      {editing && <TechModal tech={editing} onClose={() => setEditing(null)} onSaved={reload} />}
    </div>
  );
}
