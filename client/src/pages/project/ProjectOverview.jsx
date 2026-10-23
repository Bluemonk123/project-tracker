import { useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { api, qs } from '../../api.js';
import { useApp, useLoad } from '../../context.jsx';
import Icon from '../../components/Icon.jsx';
import { Markdown, Avatar, Progress, Empty, Modal, Field, useAsync, MarkdownEditor, confirmDialog, ProjectStatus } from '../../components/ui.jsx';
import { WorkloadTable } from '../Overview.jsx';
import { ActivityItem } from '../MyPage.jsx';
import { KeyPeoplePanel } from '../../components/KeyPeople.jsx';
import { fmtDate, fmtMeeting, MEETING_KINDS, PROJECT_STATUS, timeAgo } from '../../lib/format.js';

function StatusModal({ project, onClose, onSaved }) {
  const [status, setStatus] = useState(project.status);
  const [why, setWhy] = useState(project.status_explanation || '');
  const [busy, run] = useAsync();
  const save = async () => { if (await run(() => api.patch(`/projects/${project.id}`, { status, status_explanation: why }), 'Project status updated')) { onSaved(); onClose(); } };
  return (
    <Modal title="Update project status" onClose={onClose} onSubmit={save} footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>Save status</button></>}>
      <div className="row wrap">
        {Object.entries(PROJECT_STATUS).map(([k, v]) => (
          <label key={k} className="check" style={{ padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 7, borderColor: status === k ? v.color : undefined }}>
            <input type="radio" name="st" checked={status === k} onChange={() => setStatus(k)} />{v.label}
          </label>
        ))}
      </div>
      <Field label="What's the situation?" hint="Shown to managers on the overview page. Members get a notification."><textarea rows={3} value={why} onChange={(e) => setWhy(e.target.value)} /></Field>
    </Modal>
  );
}

function NewsModal({ project, onClose, onSaved }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, run] = useAsync();
  const save = async () => { if (await run(() => api.post(`/projects/${project.id}/news`, { title, body }), 'Announcement posted')) { onSaved(); onClose(); } };
  return (
    <Modal title="Post an announcement" wide onClose={onClose} onSubmit={save} footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !title.trim()}>Post to members</button></>}>
      <Field label="Title"><input type="text" value={title} onChange={(e) => setTitle(e.target.value)} required /></Field>
      <Field label="Message"><MarkdownEditor value={body} onChange={setBody} rows={5} /></Field>
    </Modal>
  );
}

export default function ProjectOverview() {
  const { project, reloadProject } = useOutletContext();
  const { meta } = useApp();
  const [modal, setModal] = useState(null);
  const [, run] = useAsync();
  const activity = useLoad(() => api.get('/activity' + qs({ project_id: project.id, limit: 12 })), [project.id]);
  const has = (p) => project.permissions.includes(p);
  const s = project.stats;
  const totalWp = project.statusCounts.reduce((a, b) => a + b.n, 0);
  const requirements = project.typeCounts.find(t => t.name === 'Requirement');
  const base = `/projects/${project.identifier}`;

  return (
    <div className="content">
      <div className="figures">
        <Link className="figure" to={`${base}/work-packages`}><div className="n">{s.open}</div><div className="l">Open work packages</div></Link>
        <Link className={`figure${s.overdue ? ' danger' : ''}`} to={`${base}/work-packages?overdue=1`}><div className="n">{s.overdue}</div><div className="l">Overdue</div></Link>
        <div className="figure"><div className="n">{s.closed}</div><div className="l">Done</div></div>
        <div className="figure"><div className="n">{Math.round(s.progress)}%</div><div className="l">Overall progress</div></div>
        {requirements && requirements.n > 0 && <Link className="figure" to={`${base}/requirements`}><div className="n">{requirements.closed || 0}/{requirements.n}</div><div className="l">Requirements done</div></Link>}
        <Link className="figure" to={`${base}/members`}><div className="n">{s.members}</div><div className="l">Members</div></Link>
      </div>

      <div className="split">
        <div className="stack" style={{ gap: 20 }}>
          <section className="panel">
            <div className="panel-head"><h3>About</h3>
              <div className="actions">{has('project.edit') && <button className="btn sm" onClick={() => setModal('status')}>Update status</button>}</div>
            </div>
            <div className="panel-body stack">
              <div className="row wrap">
                <ProjectStatus status={project.status} />
                {project.status_explanation && <span className="soft">{project.status_explanation}</span>}
              </div>
              {project.description ? <Markdown text={project.description} /> : <p className="muted small" style={{ margin: 0 }}>No description yet.</p>}
              <div className="row wrap small soft" style={{ gap: 18 }}>
                {project.manager && <span>Manager <b style={{ color: 'var(--ink)' }}>{project.manager.name}</b></span>}
                {(project.start_date || project.end_date) && <span>Runs {fmtDate(project.start_date) || '…'} to {fmtDate(project.end_date, { year: true }) || '…'}</span>}
                {project.children.length > 0 && <span>Sub-projects {project.children.map(c => <Link key={c.id} to={`/projects/${c.identifier}`} style={{ marginLeft: 6 }}>{c.name}</Link>)}</span>}
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head"><h3>Work by status</h3><div className="actions"><Link to={`${base}/board`} className="small">Open board</Link></div></div>
            <div className="panel-body">
              {!totalWp ? <p className="muted small" style={{ margin: 0 }}>No work packages yet.</p> : <>
                <div className="stacked-bar" aria-hidden="true">
                  {project.statusCounts.filter(x => x.n).map(x => <span key={x.id} style={{ width: `${(x.n / totalWp) * 100}%`, background: x.color }} title={`${x.name}: ${x.n}`} />)}
                </div>
                <div className="row wrap" style={{ marginTop: 12, gap: '6px 16px' }}>
                  {project.statusCounts.filter(x => x.n).map(x => (
                    <Link key={x.id} to={`${base}/work-packages?status=${x.id}`} className="pill" style={{ '--c': x.color }}>{x.name} <b className="num">{x.n}</b></Link>
                  ))}
                </div>
                <div className="row wrap" style={{ marginTop: 14, gap: '6px 16px' }}>
                  {project.typeCounts.filter(x => x.n).map(x => (
                    <Link key={x.id} to={`${base}/work-packages?type_id=${x.id}&status=all`} className="small" style={{ color: 'var(--ink-2)' }}>
                      <span className="type-label" style={{ '--c': x.color }}>{x.name}</span> {x.closed || 0} of {x.n} done
                    </Link>
                  ))}
                </div>
              </>}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head"><h3>Who is working on what</h3></div>
            <WorkloadTable projectId={project.id} />
          </section>

          <section className="panel">
            <div className="panel-head"><h3>Latest activity</h3><div className="actions"><Link to={`${base}/activity`} className="small">All activity</Link></div></div>
            {activity.data?.length ? <ul className="list">{activity.data.map(a => <ActivityItem key={a.id} a={a} />)}</ul> : <Empty small>Nothing has happened yet.</Empty>}
          </section>
        </div>

        <div className="stack" style={{ gap: 20 }}>
          <KeyPeoplePanel key={JSON.stringify(project.positions)} project={project} onChanged={reloadProject} />
          <section className="panel">
            <div className="panel-head"><h3>Announcements</h3>
              <div className="actions">{has('news.manage') && <button className="btn sm" onClick={() => setModal('news')}><Icon name="megaphone" />Post</button>}</div>
            </div>
            {!project.news.length ? <Empty small>No announcements.</Empty> : (
              <ul className="list">
                {project.news.map(n => (
                  <li key={n.id} style={{ display: 'block' }}>
                    <div className="row"><b className="grow">{n.title}</b>
                      {has('news.manage') && <button className="icon-btn" aria-label="Delete announcement" onClick={async () => {
                        if (await confirmDialog({ message: `Delete “${n.title}”?`, confirmLabel: 'Delete', danger: true })) { await run(() => api.del(`/projects/${project.id}/news/${n.id}`)); reloadProject(); }
                      }}><Icon name="trash" /></button>}
                    </div>
                    <div className="xs muted">{n.author_name}, {timeAgo(n.created_at)}</div>
                    {n.body && <div className="small" style={{ marginTop: 6 }}><Markdown text={n.body} /></div>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {has('meetings.view') && (
            <section className="panel">
              <div className="panel-head"><h3>Upcoming meetings</h3><div className="actions"><Link to={`${base}/meetings`} className="small">All</Link></div></div>
              {!project.upcomingMeetings.length ? <Empty small>None scheduled.</Empty> : (
                <ul className="list">
                  {project.upcomingMeetings.map(m => (
                    <li key={m.id}>
                      <div className="grow" style={{ minWidth: 0 }}>
                        <Link to={`/meetings/${m.id}`} className="ellipsis" style={{ display: 'block', color: 'var(--ink)' }}>{m.title}</Link>
                        <span className="xs muted">{MEETING_KINDS[m.kind]}</span>
                      </div>
                      <span className="small nowrap">{fmtMeeting(m.starts_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <section className="panel">
            <div className="panel-head"><h3>Versions</h3><div className="actions"><Link to={`${base}/roadmap`} className="small">Roadmap</Link></div></div>
            {!project.versions.filter(v => v.status !== 'closed').length ? <Empty small>No open versions. Versions group work into releases or sprints.</Empty> : (
              <ul className="list">
                {project.versions.filter(v => v.status !== 'closed').map(v => (
                  <li key={v.id} style={{ display: 'block' }}>
                    <div className="row"><b className="grow">{v.name}</b><span className="xs muted">{v.due_date ? `due ${fmtDate(v.due_date)}` : 'no date'}</span></div>
                    <Progress value={v.progress || 0} color={project.color} />
                    <div className="xs muted">{v.closed} of {v.total} done</div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel">
            <div className="panel-head"><h3>Members</h3><div className="actions"><Link to={`${base}/members`} className="small">Manage</Link></div></div>
            <div className="panel-body row wrap" style={{ gap: 6 }}>
              {project.members.map(m => <Avatar key={m.id} id={m.user_id} name={m.name} />)}
              {!project.members.length && <span className="small muted">No members yet.</span>}
            </div>
          </section>
        </div>
      </div>
      {modal === 'status' && <StatusModal project={project} onClose={() => setModal(null)} onSaved={reloadProject} />}
      {modal === 'news' && <NewsModal project={project} onClose={() => setModal(null)} onSaved={reloadProject} />}
      {meta && null}
    </div>
  );
}
