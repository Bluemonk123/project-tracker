import { useState } from 'react';
import { api, qs } from '../../api.js';
import { useApp, useLoad } from '../../context.jsx';
import { Loading, ErrorBox, Empty } from '../../components/ui.jsx';
import { ActivityItem } from '../MyPage.jsx';
import { fmtDay, utc, isoDate } from '../../lib/format.js';

export default function Activity({ project }) {
  const { activeUsers } = useApp();
  const [userId, setUserId] = useState('');
  const { data, error, loading } = useLoad(() => api.get('/activity' + qs({ project_id: project.id, user_id: userId, limit: 300 })), [project.id, userId]);
  const groups = [];
  for (const a of data || []) {
    const d = isoDate(utc(a.created_at));
    if (!groups.length || groups[groups.length - 1].d !== d) groups.push({ d, items: [] });
    groups[groups.length - 1].items.push(a);
  }
  return (
    <div className="content">
      <div className="page-head">
        <div className="grow"><h2>Activity</h2><p>Everything that changed in {project.name}, newest first.</p></div>
        <div className="head-actions">
          <select value={userId} onChange={(e) => setUserId(e.target.value)} style={{ width: 'auto' }} aria-label="Person">
            <option value="">Everyone</option>{activeUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
      </div>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : !groups.length ? <div className="panel"><Empty title="No activity yet" /></div> : (
        <div className="panel">
          {groups.map(g => (
            <div key={g.d}>
              <div className="day-divider">{fmtDay(g.d)}</div>
              <ul className="list">{g.items.map(a => <ActivityItem key={a.id} a={a} />)}</ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
