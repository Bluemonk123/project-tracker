// "All tasks" area: All tasks, Meetings and Time as tabs of one page.
import { NavLink } from 'react-router-dom';
import Icon from './Icon.jsx';

const TABS = [['/work-packages', 'All tasks', 'list'], ['/meetings', 'Meetings', 'chat'], ['/time', 'Time', 'clock']];
export const WORK_PATHS = TABS.map(t => t[0]);

export default function WorkTabs({ children }) {
  return (
    <div className="work-tabs-head">
      <nav className="work-tabs" aria-label="All tasks">
        {TABS.map(([to, label, icon]) => (
          <NavLink key={to} to={to} className={({ isActive }) => `work-tab${isActive ? ' active' : ''}`}><Icon name={icon} size={17} />{label}</NavLink>
        ))}
      </nav>
      {children && <div className="head-actions">{children}</div>}
    </div>
  );
}
