import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api.js';
import { useApp, useLoad } from '../context.jsx';
import { Loading, ErrorBox, Empty, ProjectStatus, Person } from '../components/ui.jsx';
import Icon from '../components/Icon.jsx';
import { KeyPeopleStrip, KeyPeopleLegend } from '../components/KeyPeople.jsx';
import { fmtDate, fmtHours } from '../lib/format.js';
import { ProjectMultiSelect, idList } from './SprintPlanning.jsx';

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


const OPEN = ['new', 'design', 'develop', 'testing'];

// Segmented bar of task counts by stage (Task Board columns), with the counts in the tooltip.
function StageBar({ stages, columns, keys = OPEN, height = 8, showTotal }) {
  const cols = columns.filter(c => keys.includes(c.key));
  const total = cols.reduce((a, c) => a + (stages[c.key] || 0), 0);
  const tip = cols.map(c => `${c.name}: ${stages[c.key] || 0}`).join(' · ');
  return (
    <div className="ov-stagebar-wrap" title={tip}>
      <div className="ov-stagebar" style={{ height }} role="img" aria-label={tip}>
        {total ? cols.map(c => (stages[c.key] ? <span key={c.key} style={{ width: `${(stages[c.key] / total) * 100}%`, background: c.color }} /> : null))
          : <span className="empty" />}
      </div>
      {showTotal && <b className="num">{total}</b>}
    </div>
  );
}

function SprintCard({ s, columns, current }) {
  const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
  const timePct = s.length ? Math.round((s.elapsed / s.length) * 100) : 0;
  const behind = current && s.total && pct + 15 < timePct;
  return (
    <div className={`ov-sprint ${s.state}`}>
      <div className="ov-sprint-head">
        <span className="sp-code">{s.code}</span>
        <Link to={`/board?sprint=${s.id}`} className="ov-sprint-name ellipsis" title={s.name}>{s.name}</Link>
        <span className="spacer" />
        {current ? <span className={`ov-days${s.days_left <= 2 ? ' warn' : ''}`}>{s.days_left <= 0 ? 'Last day' : `${s.days_left + 1} days left`}</span>
          : <span className="ov-days muted">starts {fmtDate(s.start_date)}</span>}
      </div>
      <div className="xs muted ellipsis">{fmtDate(s.start_date)} – {fmtDate(s.end_date)} · {s.projects.map(p => p.name).join(', ')}</div>
      {current && (
        <div className="ov-sprint-progress">
          <div className="ov-dual">
            <div className="ov-dual-row"><span className="xs soft">Work done</span><div className="progress"><span style={{ width: `${pct}%`, '--c': behind ? 'var(--signal, #e0a020)' : 'var(--ok)' }} /></div><b className="small">{pct}%</b></div>
            <div className="ov-dual-row"><span className="xs soft">Time gone</span><div className="progress"><span style={{ width: `${timePct}%`, '--c': 'var(--ink-3)' }} /></div><b className="small">{timePct}%</b></div>
          </div>
        </div>
      )}
      <StageBar stages={s.stages} columns={columns} keys={['new', 'design', 'develop', 'testing', 'closed', 'rejected']} height={10} />
      <div className="ov-sprint-foot">
        {columns.map(c => (s.stages[c.key] ? <span key={c.key} className="ov-chip"><i style={{ background: c.color }} />{c.name} <b>{s.stages[c.key]}</b></span> : null))}
        {!s.total && <span className="xs muted">No tasks yet</span>}
        <span className="spacer" />
        {s.overdue > 0 && <span className="ov-chip danger">{s.overdue} overdue</span>}
        <span className="xs muted">{s.done}/{s.total} done</span>
      </div>
    </div>
  );
}

export default function Overview() {
  const { can } = useApp();
  const [projectIds, setProjectIds] = useState([]);
  const [teamId, setTeamId] = useState('teams');
  const [tab, setTab] = useState('team'); // Team members | Projects
  const pid = projectIds.join(',');
  const { data, error, loading } = useLoad(() => api.get('/reports/overview' + qs({ project_id: pid || undefined })), [pid]);
  const peopleRows = useMemo(() => {
    if (!data) return [];
    const byId = new Map(data.people.map(p => [p.id, p]));
    if (teamId === 'all') return [{ title: null, rows: [...data.people].filter(p => p.open_count || p.hours_week || p.closed_30).sort((a, b) => b.open_count - a.open_count) }];
    if (teamId !== 'teams') {
      const t = data.teams.find(x => String(x.id) === teamId);
      return t ? [{ title: null, rows: t.member_ids.map(id => byId.get(id)).filter(Boolean) }] : [];
    }
    const inTeam = new Set(data.teams.flatMap(t => t.member_ids));
    const groups = data.teams.filter(t => t.member_ids.length).map(t => ({ title: t.name, lead: t.lead_id, rows: t.member_ids.map(id => byId.get(id)).filter(Boolean) }));
    const others = data.people.filter(p => !inTeam.has(p.id) && p.open_count);
    if (others.length) groups.push({ title: 'Not in a team', rows: others });
    return groups;
  }, [data, teamId]);

  if (!can('reports.view')) return <div className="content"><Empty title="Managers only">Ask an administrator for a role with “View portfolio and workload reports”.</Empty></div>;
  if (loading && !data) return <div className="content"><Loading /></div>;
  if (error) return <div className="content"><ErrorBox error={error} /></div>;
  const { totals: t, columns, stages, sprints } = data;
  const projQ = pid ? `project_id=${pid}` : '';
  const openTotal = OPEN.reduce((a, k) => a + (stages[k] || 0), 0);
  const sprintPct = t.sprint_total ? Math.round((t.sprint_done / t.sprint_total) * 100) : 0;
  const typesTotal = data.types.reduce((a, x) => a + x.n, 0);

  return (
    <div className="content wide ov-page">
      <div className="page-head">
        <div className="grow"><h1>Manager overview</h1><p>Projects, tasks, sprints and team members at a glance.</p></div>
        <div className="ov-filter"><ProjectMultiSelect value={projectIds} onChange={setProjectIds} /></div>
      </div>

      <div className="figures ov-figures figures-grad">
        <Link className="figure" to="/projects"><div className="n">{t.projects}</div><div className="l">Active projects</div><Icon name="folder" className="fig-ico" /></Link>
        <div className={`figure${t.at_risk || t.off_track ? ' signal' : ''}`}><div className="n">{t.at_risk}<span className="ov-sub"> / {t.off_track}</span></div><div className="l">At risk / off track</div><Icon name="alert" className="fig-ico" /></div>
        <Link className="figure" to={`/work-packages?${projQ}`}><div className="n">{t.open}</div><div className="l">Open tasks</div><Icon name="list" className="fig-ico" /></Link>
        <Link className={`figure${t.overdue ? ' danger' : ''}`} to={`/work-packages?overdue=1${projQ ? `&${projQ}` : ''}`}><div className="n">{t.overdue}</div><div className="l">Overdue</div><Icon name="clock" className="fig-ico" /></Link>
        <Link className="figure" to={`/sprint-planning${pid ? `?project_id=${pid}` : ''}`}><div className="n">{t.unpicked}</div><div className="l">Not in a sprint</div><Icon name="inbox" className="fig-ico" /></Link>
        <Link className="figure" to="/board"><div className="n">{t.sprints_running}<span className="ov-sub"> · {sprintPct}% done</span></div><div className="l">Running sprints</div><Icon name="flag" className="fig-ico" /></Link>
        <div className="figure"><div className="n">{t.closed_30}</div><div className="l">Closed in 30 days</div><Icon name="checkSquare" className="fig-ico" /></div>
        <Link className="figure" to="/time"><div className="n">{fmtHours(t.hours_month)}</div><div className="l">Logged this month</div><Icon name="activity" className="fig-ico" /></Link>
      </div>

      <div className="ov-grid">
        <section className="panel">
          <div className="panel-head"><h3>Running sprints</h3><div className="actions"><Link className="btn sm ghost" to="/sprint-planning"><Icon name="flag" size={14} />Sprint Board</Link></div></div>
          <div className="panel-body ov-sprints">
            {!sprints.current.length && <Empty small>No sprint is running{pid ? ' for these projects' : ''}.</Empty>}
            {sprints.current.map(s => <SprintCard key={s.id} s={s} columns={columns} current />)}
            {sprints.planned.length > 0 && <>
              <h4 className="ov-subhead">Coming up</h4>
              <div className="ov-upcoming">
                {sprints.planned.map(s => (
                  <Link key={s.id} to={`/sprint-planning?sprint=${s.id}`} className="ov-up">
                    <span className="sp-code">{s.code}</span><span className="ellipsis grow">{s.name}</span>
                    <span className="xs muted">{fmtDate(s.start_date)} – {fmtDate(s.end_date)}</span><span className="xs"><b>{s.total}</b> tasks</span>
                  </Link>
                ))}
              </div>
            </>}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head"><h3>Open tasks by stage</h3><div className="actions"><span className="small muted">{openTotal} open</span></div></div>
          <div className="panel-body">
            <div className="ov-stages">
              {columns.filter(c => OPEN.includes(c.key)).map(c => {
                const n = stages[c.key] || 0;
                return (
                  <Link key={c.key} to={`/board?sprint=all${pid ? `&project=${pid}` : ''}`} className="ov-stage-row">
                    <span className="ov-stage-name"><i style={{ background: c.color }} />{c.name}</span>
                    <div className="ov-stage-bar"><span style={{ width: `${openTotal ? (n / openTotal) * 100 : 0}%`, background: c.color }} /></div>
                    <b className="num">{n}</b>
                  </Link>
                );
              })}
              <div className="ov-stage-row static">
                <span className="ov-stage-name"><i style={{ background: '#7D8796' }} />Closed (30 days)</span>
                <div className="ov-stage-bar"><span style={{ width: `${openTotal ? Math.min(100, (t.closed_30 / Math.max(openTotal, t.closed_30)) * 100) : 100}%`, background: '#7D8796' }} /></div>
                <b className="num">{t.closed_30}</b>
              </div>
            </div>
            <h4 className="ov-subhead">Open tasks by type</h4>
            <div className="ov-types">
              {data.types.map(x => (
                <Link key={x.id} to={`/work-packages?type_id=${x.id}${projQ ? `&${projQ}` : ''}`} className="ov-type" style={{ '--tc': x.color }}>
                  <span>{x.name}</span><b>{x.n}</b><small>{typesTotal ? Math.round((x.n / typesTotal) * 100) : 0}%</small>
                </Link>
              ))}
              {!data.types.length && <span className="small muted">No open tasks.</span>}
            </div>
          </div>
        </section>
      </div>

      {tab === 'team' && <section className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-head">
          <div className="ov-tabs" role="tablist" aria-label="Team members or projects">
            <button type="button" role="tab" aria-selected={tab === 'team'} className={tab === 'team' ? 'active' : ''} onClick={() => setTab('team')}>Team members</button>
            <button type="button" role="tab" aria-selected={tab === 'projects'} className={tab === 'projects' ? 'active' : ''} onClick={() => setTab('projects')}>Projects <span className="xs muted">{data.projects.length}</span></button>
          </div>
          <div className="actions">
            <select value={teamId} onChange={(e) => setTeamId(e.target.value)} style={{ width: 'auto', height: 30, fontSize: 13 }} aria-label="Team">
              <option value="teams">By team</option><option value="all">Everyone with tasks</option>
              {data.teams.map(t2 => <option key={t2.id} value={t2.id}>{t2.name}</option>)}
            </select>
          </div>
        </div>
        <div className="table-wrap">
          <table className="table ov-table">
            <thead><tr>
              <th>Person</th><th style={{ minWidth: 190 }}>Open tasks by stage</th><th className="num">In sprint</th><th className="num">Overdue</th>
              <th className="num">Due in 7 days</th><th className="num hide-sm">Closed 30d</th><th className="num hide-sm">Projects</th>
              <th className="num hide-sm">Remaining est.</th><th className="num">Logged this week</th>
            </tr></thead>
            <tbody>
              {peopleRows.map((g, gi) => [
                g.title && <tr key={`g${gi}`} className="ov-group"><td colSpan={9}>{g.title} <span className="xs muted">{g.rows.length} people</span></td></tr>,
                ...g.rows.map(r => (
                  <tr key={`${gi}-${r.id}`}>
                    <td><Person id={r.id} name={r.name} />{r.id === g.lead && <span className="tag" style={{ marginLeft: 6 }}>Lead</span>}<div className="xs muted" style={{ paddingLeft: 29 }}>{r.job_title}</div></td>
                    <td><Link to={`/board?sprint=all&member=${r.id}`} className="ov-cell-link"><StageBar stages={{ new: r.s_new, design: r.s_design, develop: r.s_develop, testing: r.s_testing }} columns={columns} showTotal /></Link></td>
                    <td className="num">{r.in_sprint || 0}</td>
                    <td className={`num${r.overdue ? ' danger-text' : ''}`}><b>{r.overdue || 0}</b></td>
                    <td className="num">{r.due_week || 0}</td>
                    <td className="num hide-sm">{r.closed_30 || 0}</td>
                    <td className="num hide-sm">{r.projects || 0}</td>
                    <td className="num hide-sm">{fmtHours(r.remaining_hours || 0)}</td>
                    <td className="num">{fmtHours(r.hours_week)}</td>
                  </tr>
                )),
              ])}
              {!peopleRows.some(g => g.rows.length) && <tr><td colSpan={9}><Empty small>No team members to show. Add people on the Teams page.</Empty></td></tr>}
            </tbody>
          </table>
        </div>
      </section>}

      {tab === 'projects' && <section className="panel">
        <div className="panel-head">
          <div className="ov-tabs" role="tablist" aria-label="Team members or projects">
            <button type="button" role="tab" aria-selected={tab === 'team'} className={tab === 'team' ? 'active' : ''} onClick={() => setTab('team')}>Team members</button>
            <button type="button" role="tab" aria-selected={tab === 'projects'} className={tab === 'projects' ? 'active' : ''} onClick={() => setTab('projects')}>Projects <span className="xs muted">{data.projects.length}</span></button>
          </div>
          <div className="actions ov-legend">{columns.filter(c => OPEN.includes(c.key)).map(c => <span key={c.key}><i style={{ background: c.color }} />{c.name}</span>)}<KeyPeopleLegend /></div>
        </div>
        {!data.projects.length ? <Empty small>No projects.</Empty> : (
          <div className="table-wrap">
            <table className="table ov-table">
              <thead><tr>
                <th>Project</th><th>Status</th><th className="hide-sm">Key people</th><th style={{ minWidth: 190 }}>Open tasks by stage</th>
                <th className="num">Overdue</th><th className="num">In sprint</th><th className="num">Not in sprint</th><th className="num hide-sm">Closed 30d</th>
                <th className="hide-sm">Running sprint</th>
              </tr></thead>
              <tbody>
                {data.projects.map(p => (
                  <tr key={p.id}>
                    <td>
                      <Link to={`/projects/${p.identifier}`} style={{ color: 'var(--ink)', fontWeight: 560 }} className="row">
                        <span className="key" style={{ '--pc': p.color }}>{p.identifier}</span><span className="ellipsis">{p.name}</span>
                      </Link>
                      <div className="xs muted ellipsis" style={{ maxWidth: 280 }} title={p.status_explanation || ''}>{p.status_explanation || (p.manager_name ? `Manager: ${p.manager_name}` : '')}</div>
                    </td>
                    <td><ProjectStatus status={p.status} /></td>
                    <td className="hide-sm"><KeyPeopleStrip positions={p.positions} /></td>
                    <td><Link to={`/board?sprint=all&project=${p.id}`} className="ov-cell-link"><StageBar stages={p.stages} columns={columns} showTotal /></Link></td>
                    <td className={`num${p.overdue ? ' danger-text' : ''}`}><b>{p.overdue}</b></td>
                    <td className="num">{p.in_sprint}</td>
                    <td className="num"><Link to={`/sprint-planning?project_id=${p.id}`}>{p.unpicked}</Link></td>
                    <td className="num hide-sm">{p.closed_30}</td>
                    <td className="hide-sm small">{p.current_sprints.length ? p.current_sprints.map(s => <Link key={s.id} to={`/board?sprint=${s.id}`} className="ov-sprint-tag" title={s.name}><span className="sp-code">SPR-{s.id}</span></Link>) : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>}
    </div>
  );
}
