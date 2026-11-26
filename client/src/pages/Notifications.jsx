import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, qs } from '../api.js';
import { useApp, useLoad } from '../context.jsx';
import { Loading, ErrorBox, Empty, Avatar, useAsync } from '../components/ui.jsx';
import { timeAgo } from '../lib/format.js';

const REASONS = {
  assigned: 'Assigned', accountable: 'Accountable', mentioned: 'Mentioned', commented: 'Comment', status: 'Status',
  meeting_invite: 'Meeting', meeting_minutes: 'Minutes', meeting_moved: 'Meeting', blocker: 'Blocker', news: 'Announcement',
  member_added: 'Project', project_status: 'Project',
  remark: 'Remark',
  ticket_new: 'New ticket', ticket_assigned: 'Ticket', ticket_reply: 'Ticket reply', ticket_update: 'Ticket',
};

export default function Notifications() {
  const { me, setUnread } = useApp();
  const nav = useNavigate();
  const [unreadOnly, setUnreadOnly] = useState(true);
  const isAdmin = !!me?.user?.is_admin;
  const [everyone, setEveryone] = useState(false); // administrators: everyone's alerts, read only
  const { data, error, loading, reload } = useLoad(() => api.get('/notifications' + qs({ unread: unreadOnly ? 1 : undefined, scope: everyone ? 'all' : undefined })), [unreadOnly, everyone]);
  const reloadRef = useRef(reload); reloadRef.current = reload;
  useEffect(() => { // new alerts appear here without reloading the page
    const onNew = () => reloadRef.current();
    window.addEventListener('pt:notifications', onNew);
    const t = setInterval(() => { if (!document.hidden) reloadRef.current(); }, 30_000);
    return () => { window.removeEventListener('pt:notifications', onNew); clearInterval(t); };
  }, []);
  const [busy, run] = useAsync();
  const markAll = async () => { if (await run(() => api.post('/notifications/read', { all: true }), 'All marked as read')) { setUnread(0); reload(); } };
  const open = async (n) => {
    if (everyone && n.user_id !== me?.user?.id) { if (n.link && n.link.startsWith('/')) nav(n.link); return; } // someone else's: just open the item
    if (!n.read_at) { await api.post('/notifications/read', { ids: [n.id] }); setUnread(Math.max(0, (data || []).filter(x => !x.read_at).length - 1)); }
    if (n.link && n.link.startsWith('/')) nav(n.link);
    else if (n.wp_id) nav(`/wp/${n.wp_id}`);
    else if (n.meeting_id) nav(`/meetings/${n.meeting_id}`);
    else if (n.project_identifier) nav(`/projects/${n.project_identifier}`);
    else reload();
  };
  return (
    <div className="content" style={{ maxWidth: 900 }}>
      <div className="page-head">
        <div className="grow"><h1>Alerts</h1><p>{everyone ? "Everyone's alerts (only administrators see this). Opening one does not mark it as read for that person." : 'Your assignments, mentions, comments on things you watch, meetings and tickets.'}</p></div>
        <div className="head-actions">
          {isAdmin && <div className="subtabs"><button className={!everyone ? 'active' : ''} onClick={() => setEveryone(false)}>Mine</button><button className={everyone ? 'active' : ''} onClick={() => setEveryone(true)}>Everyone</button></div>}
          <div className="subtabs"><button className={unreadOnly ? 'active' : ''} onClick={() => setUnreadOnly(true)}>Unread</button><button className={!unreadOnly ? 'active' : ''} onClick={() => setUnreadOnly(false)}>All</button></div>
          {!everyone && <button className="btn" disabled={busy} onClick={markAll}>Mark all as read</button>}
        </div>
      </div>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : !data.length ? <div className="panel"><Empty title={unreadOnly ? "You're all caught up" : 'No alerts yet'}>New assignments, mentions and meeting invitations appear here.</Empty></div> : (
        <div className="panel">
          {data.map(n => (
            <div key={n.id} className={`notif${n.read_at ? '' : ' unread'}`} role="button" tabIndex={0} style={{ cursor: 'pointer' }}
              onClick={() => open(n)} onKeyDown={(e) => { if (e.key === 'Enter') open(n); }}>
              <span className="dot" />
              <Avatar id={n.actor_id} name={n.actor_name || 'System'} size="sm" />
              <div className="grow" style={{ minWidth: 0 }}>
                <div>{n.message}</div>
                <div className="xs muted">{everyone && n.recipient_name ? <b>To {n.recipient_name} · </b> : null}{REASONS[n.reason] || n.reason}{n.project_name ? `, ${n.project_name}` : ''}, {timeAgo(n.created_at)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
