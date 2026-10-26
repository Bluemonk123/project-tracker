import { NavLink, Outlet, useParams, Link } from 'react-router-dom';
import { api } from '../../api.js';
import { useLoad } from '../../context.jsx';
import { Loading, ErrorBox, ProjectStatus } from '../../components/ui.jsx';

export default function ProjectLayout() {
  const { key } = useParams();
  const { data: project, error, loading, reload } = useLoad(() => api.get(`/projects/${key}`), [key]);
  if (loading && !project) return <Loading />;
  if (error) return <div className="content"><ErrorBox error={error} /></div>;
  const has = (p) => project.permissions.includes(p);
  const base = `/projects/${project.identifier}`;
  const tabs = [
    ['', 'Overview', true],
    ['work-packages', 'Work packages', has('wp.view')],
    ['requirements', 'Requirements', has('wp.view')],
    ['board', 'Board', has('wp.view')],
    ['gantt', 'Gantt', has('wp.view')],
    ['calendar', 'Calendar', has('wp.view')],
    ['roadmap', 'Roadmap', has('wp.view')],
    ['meetings', 'Meetings', has('meetings.view')],
    ['time', 'Time', has('time.log') || has('time.view_all')],
    ['wiki', 'Wiki', has('wiki.view')],
    ['technologies', 'Technologies', true],
    ['members', 'Members', true],
    ['activity', 'Activity', has('wp.view')],
    ['settings', 'Settings', has('project.edit') || has('project.versions') || has('project.archive')],
  ].filter(t => t[2]);
  return (
    <div style={{ '--pc': project.color }}>
      <div className="project-head">
        <div className="crumb">
          <Link to="/projects">Projects</Link>
          {project.parent && <><span>/</span><Link to={`/projects/${project.parent.identifier}`}>{project.parent.name}</Link></>}
        </div>
        <div className="title-row">
          <h1 style={{ fontSize: 22 }}>{project.name}</h1>
          <span className="project-key">{project.identifier}</span>
          <ProjectStatus status={project.status} />
          {project.archived ? <span className="tag signal">Archived</span> : null}
        </div>
        <nav className="tabs" aria-label="Project sections">
          {tabs.map(([path, label]) => <NavLink key={path} to={path ? `${base}/${path}` : base} end={!path}>{label}</NavLink>)}
        </nav>
      </div>
      <Outlet context={{ project, reloadProject: reload }} />
    </div>
  );
}
