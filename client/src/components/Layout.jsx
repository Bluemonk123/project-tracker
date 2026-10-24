import { useEffect, useRef, useState } from 'react';
import { NavLink, Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import Icon from './Icon.jsx';
import { Avatar, Popover } from './ui.jsx';
import { useApp } from '../context.jsx';
import { api, qs } from '../api.js';
import NewProjectModal from '../pages/NewProjectModal.jsx';

function BrandMark() {
  return <img className="brand-mark" src="/logo-tile.png" alt="" width="30" height="30" />;
}

function GlobalSearch() {
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const box = useRef(null);
  useEffect(() => {
    if (q.trim().length < 2) { setRes(null); return; }
    const t = setTimeout(() => api.get('/search' + qs({ q })).then(setRes).catch(() => {}), 180);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    const onDoc = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) { e.preventDefault(); box.current?.querySelector('input')?.focus(); } };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, []);
  const go = (to) => { setOpen(false); setQ(''); nav(to); };
  const empty = res && !res.projects.length && !res.workPackages.length && !res.wiki.length && !res.meetings.length;
  return (
    <div className="search-box" ref={box}>
      <Icon name="search" />
      <input type="search" placeholder="Search work, projects, wiki, meetings   ( / )" value={q} aria-label="Search"
        onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && res?.workPackages?.[0]) go(`/wp/${res.workPackages[0].id}`);
          if (e.key === 'Escape') setOpen(false);
        }} />
      {open && res && (
        <div className="search-results">
          {empty && <div className="small muted" style={{ padding: 10 }}>Nothing matches “{q}”.</div>}
          {res.workPackages.length > 0 && <h5>Work packages</h5>}
          {res.workPackages.map((w, i) => (
            <a key={w.id} href={`/wp/${w.id}`} className={i === 0 ? 'hl' : ''} onClick={(e) => { e.preventDefault(); go(`/wp/${w.id}`); }}>
              <span className="key" style={{ '--pc': w.project_color }}>{w.key}</span><span className="ellipsis grow">{w.subject}</span>
              <span className="pill" style={{ '--c': w.status_color }}>{w.status_name}</span>
            </a>
          ))}
          {res.projects.length > 0 && <h5>Projects</h5>}
          {res.projects.map(p => (
            <a key={p.id} href={`/projects/${p.identifier}`} onClick={(e) => { e.preventDefault(); go(`/projects/${p.identifier}`); }}>
              <span className="key" style={{ '--pc': p.color }}>{p.identifier}</span>{p.name}
            </a>
          ))}
          {res.wiki.length > 0 && <h5>Wiki pages</h5>}
          {res.wiki.map(w => (
            <a key={w.id} href={`/projects/${w.identifier}/wiki/${w.id}`} onClick={(e) => { e.preventDefault(); go(`/projects/${w.identifier}/wiki/${w.id}`); }}>
              <Icon name="book" size={15} />{w.title}<span className="xs muted">{w.identifier}</span>
            </a>
          ))}
          {res.meetings.length > 0 && <h5>Meetings</h5>}
          {res.meetings.map(m => (
            <a key={m.id} href={`/meetings/${m.id}`} onClick={(e) => { e.preventDefault(); go(`/meetings/${m.id}`); }}>
              <Icon name="chat" size={15} />{m.title}<span className="xs muted">{m.starts_at.slice(0, 10)}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem('pt-theme') || 'auto'; } catch { return 'auto'; } });
  useEffect(() => {
    if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('pt-theme', theme); } catch { /* ignore */ }
  }, [theme]);
  const next = theme === 'auto' ? 'light' : theme === 'light' ? 'dark' : 'auto';
  return (
    <button type="button" className="menu-item" onClick={() => setTheme(next)}>
      <Icon name={theme === 'dark' ? 'moon' : 'sun'} size={16} />Theme: {theme === 'auto' ? 'Match system' : theme === 'light' ? 'Light' : 'Dark'}
    </button>
  );
}

export default function Layout() {
  const { user, me, projects, can, isAdmin, appName, reload } = useApp();
  const [navOpen, setNavOpen] = useState(false);
  // Desktop: collapse the sidebar to an icon rail (remembered per browser). Phone: slide-in menu.
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('pt-sidebar') === 'collapsed'; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem('pt-sidebar', collapsed ? 'collapsed' : 'expanded'); } catch { /* ignore */ } }, [collapsed]);
  const isPhone = () => window.matchMedia('(max-width: 860px)').matches;
  const toggleMenu = () => (isPhone() ? setNavOpen(o => !o) : setCollapsed(c => !c));
  const menuOpen = typeof window !== 'undefined' && isPhone() ? navOpen : !collapsed;
  const [newProject, setNewProject] = useState(false);
  const loc = useLocation();
  const nav = useNavigate();
  useEffect(() => { setNavOpen(false); }, [loc.pathname]);
  const logout = async () => { await api.post('/auth/logout'); await reload(); nav('/'); };
  const showReports = can('reports.view');

  return (
    <div className={`shell${collapsed ? ' collapsed' : ''}`}>
      <aside className={`sidebar${navOpen ? ' open' : ''}`} aria-label="Main navigation">
        <Link to="/" className="brand" style={{ textDecoration: 'none' }} title={appName}><BrandMark /><span className="nav-text">{appName}</span></Link>
        <nav className="nav-group">
          <NavLink to="/" end className="nav-link" title="My page"><Icon name="home" /><span className="nav-text">My page</span></NavLink>
          {showReports && <NavLink to="/overview" className="nav-link" title="Manager overview"><Icon name="chart" /><span className="nav-text">Manager overview</span></NavLink>}
          <NavLink to="/board" className="nav-link" title="Project Board"><Icon name="board" /><span className="nav-text">Project Board</span></NavLink>
          <NavLink to="/work-packages" className="nav-link" title="All work"><Icon name="list" /><span className="nav-text">All work</span></NavLink>
          <NavLink to="/meetings" className="nav-link" title="Meetings"><Icon name="chat" /><span className="nav-text">Meetings</span></NavLink>
          <NavLink to="/time" className="nav-link" title="Time"><Icon name="clock" /><span className="nav-text">Time</span></NavLink>
          <NavLink to="/teams" className="nav-link" title="Teams"><Icon name="users" /><span className="nav-text">Teams</span></NavLink>
        </nav>
        <nav className="nav-group" aria-label="Projects">
          <div className="nav-heading">
            <span>Projects</span>
            {can('projects.create') && <button type="button" onClick={() => setNewProject(true)} aria-label="New project" title="New project"><Icon name="plus" size={14} /></button>}
          </div>
          {projects.map(p => (
            <NavLink key={p.id} to={`/projects/${p.identifier}`} className="nav-link nav-project" title={p.name}>
              <span className="stripe" style={{ background: p.color }} />
              <span className="ellipsis nav-text">{p.name}</span>
              <span className="pkey">{p.identifier}</span>
            </NavLink>
          ))}
          <NavLink to="/projects" end className="nav-link quiet" title="All projects"><Icon name="folder" /><span className="nav-text">All projects</span></NavLink>
        </nav>
        <div className="sidebar-foot">
          {isAdmin || can('admin.users') || can('admin.roles') || can('admin.settings') ? (
            <NavLink to="/admin" className="nav-link" title="Administration"><Icon name="settings" /><span className="nav-text">Administration</span></NavLink>
          ) : null}
        </div>
      </aside>
      {navOpen && <div className="modal-backdrop" style={{ zIndex: 80, background: 'rgba(0,0,0,.3)' }} onClick={() => setNavOpen(false)} />}
      <div className="main">
        <header className="topbar">
          <button type="button" className="icon-btn menu-btn" onClick={toggleMenu} aria-expanded={menuOpen}
            aria-label={menuOpen ? 'Collapse menu' : 'Expand menu'} title={menuOpen ? 'Collapse menu' : 'Expand menu'}><Icon name="menu" /></button>
          <GlobalSearch />
          <div className="topbar-actions">
            <Link to="/notifications" className="icon-btn" aria-label={`Alerts${me?.unread ? `, ${me.unread} unread` : ''}`}>
              <Icon name="bell" />{me?.unread > 0 && <span className="badge-dot">{me.unread > 99 ? '99+' : me.unread}</span>}
            </Link>
            <Popover trigger={({ toggle }) => (
              <button type="button" className="icon-btn" onClick={toggle} aria-label="Account menu"><Avatar id={user.id} name={user.name} /></button>
            )}>
              <div style={{ padding: '6px 10px 8px' }}>
                <div style={{ fontWeight: 600 }}>{user.name}</div>
                <div className="xs muted">{user.email}</div>
              </div>
              <div className="menu-sep" />
              <Link to="/profile" className="menu-item"><Icon name="user" size={16} />My profile and password</Link>
              <ThemeToggle />
              <div className="menu-sep" />
              <button type="button" className="menu-item" onClick={logout}><Icon name="logout" size={16} />Sign out</button>
            </Popover>
          </div>
        </header>
        <Outlet />
      </div>
      {newProject && <NewProjectModal onClose={() => setNewProject(false)} />}
    </div>
  );
}
