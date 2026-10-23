import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api.js';
import { useApp, useLoad } from '../context.jsx';
import { Loading, ErrorBox, Empty, ProjectStatus, Progress, Person } from '../components/ui.jsx';
import { KeyPeopleStrip, KeyPeopleLegend } from '../components/KeyPeople.jsx';
import { fmtDate, fmtHours, fmtMeeting, timeAgo } from '../lib/format.js';

export function WorkloadTable({ projectId, teamId }) {
  const { data, loading, error } = useLoad(() => api.get('/reports/workload' + qs({ project_id: projectId, team_id: teamId })), [projectId, teamId]);
  if (loading && !data) return <Loading />;
  if (error) return <div className="panel-body"><ErrorBox error={error} /></div>;
  if (!data.length) return <Empty small>No people to show.</Empty>;
  const max = Math.max(1, ...data.map(r => r.open_count));
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr>
          <th>Person</th><th>Open work</th><th className="num">In progress</th><th className="num">Overdue</th><th className="num">Due in 7 days</th>
          <th className="num hide-sm">High priority</th><th className="num">Remaining estimate</th><th className="num">Logged this week</th>
        </tr></thead>
        <tbody>
          {data.map(r => (
            <tr key={r.id}>
              <td><Person id={r.id} name={r.name} /><div className="xs muted" style={{ paddingLeft: 29 }}>{r.job_title}</div></td>
              <td style={{ minWidth: 160 }}>
                <Link to={`/work-packages?assignee_id=${r.id}${projectId ? `&project_id=${projectId}` : ''}`} className="progress-row" style={{ color: 'var(--ink)' }}>
                  <span className="progress" style={{ flex: 1 }}><span style={{ width: `${(r.open_count / max) * 100}%`, '--c': r.overdue ? 'var(--danger)' : 'var(--accent)' }} /></span>
                  <b className="num" style={{ width: 28, textAlign: 'right' }}>{r.open_count}</b>
                </Link>
              </td>
              <td className="num">{r.in_progress || 0}</td>
              <td className={`num${r.overdue ? ' danger-text' : ''}`}><b>{r.overdue || 0}</b></td>
              <td className="num">{r.due_week || 0}</td>
              <td className="num hide-sm">{r.high_priority || 0}</td>
              <td className="num">{fmtHours(r.remaining_hours || 0)}</td>
              <td className="num">{fmtHours(r.hours_week)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Overview() {
  const { can } = useApp();
  const [teamId, setTeamId] = useState('');
  const { data, error, loading } = useLoad(() => api.get('/reports/portfolio'), []);
  const teams = useLoad(() => api.get('/teams'), []);
  if (!can('reports.view')) return <div className="content"><Empty title="Managers only">Ask an administrator for a role with “View portfolio and workload reports”.</Empty></div>;
  if (loading && !data) return <div className="content"><Loading /></div>;
  if (error) return <div className="content"><ErrorBox error={error} /></div>;
  const t = data.totals;
  return (
    <div className="content">
      <div className="page-head">
        <div className="grow"><h1>Manager overview</h1><p>How every application is doing, and who is carrying the work.</p></div>
      </div>
      <div className="figures">
        <div className="figure"><div className="n">{t.projects}</div><div className="l">Active projects</div></div>
        <div className={`figure${t.at_risk ? ' signal' : ''}`}><div className="n">{t.at_risk}</div><div className="l">At risk</div></div>
        <div className={`figure${t.off_track ? ' danger' : ''}`}><div className="n">{t.off_track}</div><div className="l">Off track</div></div>
        <div className={`figure${t.team_gaps ? ' danger' : ''}`}><div className="n">{t.team_gaps}</div><div className="l">Missing key people</div></div>
        <Link className="figure" to="/work-packages"><div className="n">{t.open}</div><div className="l">Open work packages</div></Link>
        <Link className={`figure${t.overdue ? ' danger' : ''}`} to="/work-packages?overdue=1"><div className="n">{t.overdue}</div><div className="l">Overdue</div></Link>
        <Link className="figure" to="/time"><div className="n">{fmtHours(t.hours_month)}</div><div className="l">Logged this month</div></Link>
      </div>

      <section className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-head"><h3>Projects</h3><div className="actions"><KeyPeopleLegend /></div></div>
        {!data.projects.length ? <Empty small>No projects yet.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr>
                <th>Project</th><th>Status</th><th>Key people</th><th className="hide-sm">Manager</th><th style={{ width: 150 }}>Progress</th>
                <th className="num">Open</th><th className="num">Overdue</th><th className="num hide-sm">People</th>
                <th className="hide-sm">Next release</th><th className="hide-sm">Next meeting</th><th className="hide-sm">Last activity</th>
              </tr></thead>
              <tbody>
                {data.projects.map(p => (
                  <tr key={p.id}>
                    <td>
                      <Link to={`/projects/${p.identifier}`} style={{ color: 'var(--ink)', fontWeight: 560 }} className="row">
                        <span className="key" style={{ '--pc': p.color }}>{p.identifier}</span>{p.name}
                      </Link>
                      {p.status_explanation && <div className="xs muted ellipsis" style={{ maxWidth: 300 }} title={p.status_explanation}>{p.status_explanation}</div>}
                    </td>
                    <td><ProjectStatus status={p.status} /></td>
                    <td><KeyPeopleStrip positions={p.positions} /></td>
                    <td className="hide-sm"><Person id={p.manager_id} name={p.manager_name} /></td>
                    <td><Progress value={p.stats.progress} color={p.color} /></td>
                    <td className="num"><Link to={`/projects/${p.identifier}/work-packages`}>{p.stats.open}</Link></td>
                    <td className={`num${p.stats.overdue ? ' danger-text' : ''}`}><b>{p.stats.overdue}</b></td>
                    <td className="num hide-sm">{p.stats.members}</td>
                    <td className="hide-sm small">{p.next_version ? <>{p.next_version.name} <span className="muted">{fmtDate(p.next_version.due_date)}</span></> : <span className="muted">—</span>}</td>
                    <td className="hide-sm small">{p.stats.next_meeting ? fmtMeeting(p.stats.next_meeting) : <span className="muted">—</span>}</td>
                    <td className="hide-sm small muted">{p.stats.last_activity ? timeAgo(p.stats.last_activity) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>Team workload</h3>
          <div className="actions">
            <select value={teamId} onChange={(e) => setTeamId(e.target.value)} style={{ width: 'auto', height: 30, fontSize: 13 }} aria-label="Team">
              <option value="">Everyone</option>{(teams.data || []).map(t2 => <option key={t2.id} value={t2.id}>{t2.name}</option>)}
            </select>
          </div>
        </div>
        <WorkloadTable teamId={teamId || undefined} />
      </section>
    </div>
  );
}
