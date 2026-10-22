import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, useOutletContext, useParams } from 'react-router-dom';
import '@fontsource-variable/instrument-sans';
import './styles.css';
import { AppProvider, useApp } from './context.jsx';
import { ConfirmHost, Loading, Toasts } from './components/ui.jsx';
import Layout from './components/Layout.jsx';
import { Login, Setup } from './pages/Auth.jsx';
import MyPage from './pages/MyPage.jsx';
import Overview from './pages/Overview.jsx';
import Projects from './pages/Projects.jsx';
import ProjectLayout from './pages/project/ProjectLayout.jsx';
import ProjectOverview from './pages/project/ProjectOverview.jsx';
import WorkPackages from './pages/WorkPackages.jsx';
import WpDetail from './pages/WpDetail.jsx';
import Requirements from './pages/project/Requirements.jsx';
import Board from './pages/project/Board.jsx';
import Gantt from './pages/project/Gantt.jsx';
import Calendar from './pages/project/Calendar.jsx';
import Roadmap from './pages/project/Roadmap.jsx';
import Meetings from './pages/Meetings.jsx';
import MeetingDetail from './pages/MeetingDetail.jsx';
import Time from './pages/Time.jsx';
import Wiki from './pages/project/Wiki.jsx';
import Members from './pages/project/Members.jsx';
import ProjectSettings from './pages/project/ProjectSettings.jsx';
import Activity from './pages/project/Activity.jsx';
import Teams from './pages/Teams.jsx';
import Notifications from './pages/Notifications.jsx';
import Profile from './pages/Profile.jsx';
import Admin from './pages/Admin.jsx';

// Project tabs reuse the global pages, scoped to the current project.
function InProject({ Component }) {
  const { project, reloadProject } = useOutletContext();
  return <Component project={project} reloadProject={reloadProject} />;
}
function NotFound() {
  return <div className="content"><div className="empty"><h3>Page not found</h3><p>The link may be old, or you may not have access.</p><a className="btn" href="/">Go to my page</a></div></div>;
}
function WikiRoute() {
  const { project } = useOutletContext();
  const { pageId } = useParams();
  return <Wiki project={project} pageId={pageId} />;
}

function Root() {
  const { loading, me, meta, needsSetup, error } = useApp();
  if (loading || (me && !meta)) return <Loading />;
  if (error) return <div className="content"><div className="error-box">Cannot reach the server: {error}. Make sure the Project Tracker window is still running.</div></div>;
  if (needsSetup) return <Setup />;
  if (!me) return <Login />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<MyPage />} />
        <Route path="overview" element={<Overview />} />
        <Route path="projects" element={<Projects />} />
        <Route path="projects/:key" element={<ProjectLayout />}>
          <Route index element={<ProjectOverview />} />
          <Route path="work-packages" element={<InProject Component={WorkPackages} />} />
          <Route path="requirements" element={<InProject Component={Requirements} />} />
          <Route path="board" element={<InProject Component={Board} />} />
          <Route path="gantt" element={<InProject Component={Gantt} />} />
          <Route path="calendar" element={<InProject Component={Calendar} />} />
          <Route path="roadmap" element={<InProject Component={Roadmap} />} />
          <Route path="meetings" element={<InProject Component={Meetings} />} />
          <Route path="time" element={<InProject Component={Time} />} />
          <Route path="wiki" element={<WikiRoute />} />
          <Route path="wiki/:pageId" element={<WikiRoute />} />
          <Route path="members" element={<InProject Component={Members} />} />
          <Route path="activity" element={<InProject Component={Activity} />} />
          <Route path="settings" element={<InProject Component={ProjectSettings} />} />
        </Route>
        <Route path="work-packages" element={<WorkPackages />} />
        <Route path="wp/:id" element={<WpDetail />} />
        <Route path="meetings" element={<Meetings />} />
        <Route path="meetings/:id" element={<MeetingDetail />} />
        <Route path="time" element={<Time />} />
        <Route path="teams" element={<Teams />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="profile" element={<Profile />} />
        <Route path="admin/*" element={<Admin />} />
        <Route path="login" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppProvider>
      <BrowserRouter>
        <Root />
        <ConfirmHost />
        <Toasts />
      </BrowserRouter>
    </AppProvider>
  </StrictMode>,
);
