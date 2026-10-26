import { useMemo, useRef, useState } from 'react';
import { api, qs } from '../api.js';
import { useLoad } from '../context.jsx';
import Icon from '../components/Icon.jsx';
import { Loading, ErrorBox, Empty } from '../components/ui.jsx';
import { TechTable } from './project/Technologies.jsx';

// Company-wide list of every technology used and which version each project runs.
export default function TechOverview() {
  const force = useRef(false);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const { data, error, loading, reload } = useLoad(() => { const r = force.current; force.current = false; return api.get('/technologies' + qs({ refresh: r ? 1 : undefined })); }, []);
  const rows = useMemo(() => (data?.rows || []).filter(t =>
    (!q || `${t.name} ${t.project_name} ${t.category}`.toLowerCase().includes(q.toLowerCase()))
    && (!status || t.assessment.status === status || (status === 'update' && ['minor', 'patch', 'major'].includes(t.assessment.status)))), [data, q, status]);
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
        <input type="search" placeholder="Filter by technology or project" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">Any status</option><option value="eol">Out of support</option><option value="update">Update available</option>
          <option value="major">Major version behind</option><option value="latest">Up to date</option><option value="unknown">Not checked</option>
        </select>
        {data && <span className="small muted">{distinct} technologies in {new Set(data.rows.map(t => t.project_id)).size} projects</span>}
      </div>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : !rows.length ? (
        <div className="panel"><Empty title={data?.rows?.length ? 'Nothing matches' : 'No technologies listed yet'}>
          {data?.rows?.length ? 'Change the filters above.' : 'Open a project and use its Technologies tab to list what it is built with.'}
        </Empty></div>
      ) : (
        <div className="panel"><TechTable rows={rows} showProject canEdit={false} /></div>
      )}
    </div>
  );
}
