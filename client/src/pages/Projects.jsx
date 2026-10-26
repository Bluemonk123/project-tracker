import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api.js';
import { useApp, useLoad } from '../context.jsx';
import Icon from '../components/Icon.jsx';
import { Loading, ErrorBox, Empty, ProjectStatus, Progress, Person } from '../components/ui.jsx';
import NewProjectModal from './NewProjectModal.jsx';
import { KeyPeopleStrip, KeyPeopleLegend } from '../components/KeyPeople.jsx';
import { fmtDate, fmtMeeting } from '../lib/format.js';

export default function Projects() {
  const { can } = useApp();
  const [archived, setArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState('');
  const { data, error, loading } = useLoad(() => api.get('/projects' + qs({ archived: archived ? 1 : undefined })), [archived]);
  const rows = (data || []).filter(p => !q || `${p.name} ${p.identifier}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="content">
      <div className="page-head">
        <div className="grow"><h1>Projects</h1><p>One project per application or product. Open one to see its work, plan and meetings.</p></div>
        <div className="head-actions">
          <Link className="btn" to="/technologies"><Icon name="layers" />Technologies</Link>
          {can('projects.create') && <button className="btn primary" onClick={() => setCreating(true)}><Icon name="plus" />New project</button>}
        </div>
      </div>
      <div className="filterbar">
        <input type="search" placeholder="Filter projects" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="spacer" /><KeyPeopleLegend />
        <div className="subtabs">
          <button className={!archived ? 'active' : ''} onClick={() => setArchived(false)}>Active</button>
          <button className={archived ? 'active' : ''} onClick={() => setArchived(true)}>Archived</button>
        </div>
      </div>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : !rows.length ? (
        <div className="panel">
          <Empty title={archived ? 'No archived projects' : 'No projects yet'}
            action={!archived && can('projects.create') && <button className="btn primary" onClick={() => setCreating(true)}><Icon name="plus" />Create the first project</button>}>
            {archived ? 'Projects you archive appear here and can be restored.' : can('projects.create') ? 'Create a project for each application your company builds.' : 'You will see projects here once someone adds you to one.'}
          </Empty>
        </div>
      ) : (
        <div className="panel table-wrap">
          <table className="table">
            <thead><tr>
              <th>Project</th><th>Status</th><th>Key people</th><th className="hide-sm">Manager</th><th style={{ width: 150 }}>Progress</th>
              <th className="num">Open</th><th className="num">Overdue</th><th className="hide-sm">Dates</th><th className="hide-sm">Next meeting</th><th className="hide-sm">My role</th>
            </tr></thead>
            <tbody>
              {rows.map(p => (
                <tr key={p.id}>
                  <td>
                    <Link to={`/projects/${p.identifier}`} className="row" style={{ color: 'var(--ink)', fontWeight: 560 }}>
                      <span className="key" style={{ '--pc': p.color }}>{p.identifier}</span>{p.name}
                    </Link>
                    {p.description && <div className="xs muted ellipsis" style={{ maxWidth: 340 }}>{p.description}</div>}
                  </td>
                  <td><ProjectStatus status={p.status} /></td>
                  <td><KeyPeopleStrip positions={p.positions} /></td>
                  <td className="hide-sm"><Person id={p.manager_id} name={p.manager_name} /></td>
                  <td><Progress value={p.stats.progress} color={p.color} /></td>
                  <td className="num">{p.stats.open}</td>
                  <td className={`num${p.stats.overdue ? ' danger-text' : ''}`}>{p.stats.overdue}</td>
                  <td className="hide-sm small soft nowrap">{p.start_date || p.end_date ? `${fmtDate(p.start_date) || '…'} to ${fmtDate(p.end_date) || '…'}` : '—'}</td>
                  <td className="hide-sm small">{p.stats.next_meeting ? fmtMeeting(p.stats.next_meeting) : <span className="muted">—</span>}</td>
                  <td className="hide-sm small soft">{p.my_role || <span className="muted">Not a member</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creating && <NewProjectModal onClose={() => setCreating(false)} />}
    </div>
  );
}
