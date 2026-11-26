// New notifications pop up at the top right (task assigned, mention, comment, stage change, meeting, ticket...),
// wherever the person is in the app. The server tells the page the moment a new alert is created (live
// connection); as a fallback it also checks every 15 seconds. Each card closes by itself after 8 seconds
// (hovering keeps it), or with ×. Clicking opens the item and marks it read. Other parts of the page (the
// Alerts page, the bell) are told through the "pt:notifications" window event.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import Icon from './Icon.jsx';

const POLL_MS = 15_000;
const SHOW_MS = 8_000;
const linkOf = (n) => (n.link && n.link.startsWith('/') ? n.link : n.wp_id ? `/wp/${n.wp_id}` : n.meeting_id ? `/meetings/${n.meeting_id}`
  : n.project_identifier ? `/projects/${n.project_identifier}` : '/notifications');

export default function NotificationPopups() {
  const { me, setUnread } = useApp();
  const nav = useNavigate();
  const [cards, setCards] = useState([]);
  const lastId = useRef(null);
  const timers = useRef(new Map());

  const close = useCallback((id) => {
    clearTimeout(timers.current.get(id)); timers.current.delete(id);
    setCards(c => c.filter(x => x.id !== id));
  }, []);
  const arm = useCallback((id) => { clearTimeout(timers.current.get(id)); timers.current.set(id, setTimeout(() => close(id), SHOW_MS)); }, [close]);

  const poll = useCallback(async (live = false) => {
    if (document.hidden && !live) return;
    try {
      const r = await api.get(`/notifications/latest${lastId.current != null ? `?after=${lastId.current}` : ''}`);
      setUnread?.(r.unread);
      if (lastId.current != null && r.items.length) {
        const fresh = r.items.slice(0, 3).reverse();
        setCards(c => [...c.filter(x => !fresh.some(f => f.id === x.id)), ...fresh].slice(-4));
        fresh.forEach(n => arm(n.id));
        window.dispatchEvent(new CustomEvent('pt:notifications'));
      }
      lastId.current = Math.max(lastId.current ?? 0, r.max_id);
    } catch { /* offline or signed out: try again next time */ }
  }, [arm, setUnread]);

  useEffect(() => {
    if (!me) return undefined;
    poll();
    const t = setInterval(poll, POLL_MS);
    const onVisible = () => { if (!document.hidden) poll(); };
    document.addEventListener('visibilitychange', onVisible);
    let es = null;
    try {
      es = new EventSource('/api/notifications/stream');
      es.addEventListener('notify', () => poll(true));
    } catch { /* polling still works */ }
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible); es?.close(); };
  }, [me?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const open = async (n) => {
    close(n.id);
    api.post('/notifications/read', { ids: [n.id] }).then(() => setUnread?.(Math.max(0, (me?.unread || 1) - 1))).catch(() => {});
    nav(linkOf(n));
  };

  if (!cards.length) return null;
  return (
    <div className="notif-pops" role="region" aria-label="New notifications" aria-live="polite">
      {cards.map(n => (
        <div key={n.id} className="notif-pop" onMouseEnter={() => clearTimeout(timers.current.get(n.id))} onMouseLeave={() => arm(n.id)}>
          <span className="notif-pop-icon" aria-hidden><Icon name="bell" /></span>
          <button type="button" className="notif-pop-body" onClick={() => open(n)}>
            <span className="notif-pop-msg">{n.actor_name && !String(n.message).startsWith(n.actor_name) && <b>{n.actor_name}: </b>}{n.message}</span>
            {n.project_name && <span className="notif-pop-meta">{n.project_name}</span>}
          </button>
          <button type="button" className="notif-pop-x" aria-label="Close" onClick={() => close(n.id)}>×</button>
        </div>
      ))}
    </div>
  );
}
