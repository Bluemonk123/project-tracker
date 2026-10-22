import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';

const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

export function AppProvider({ children }) {
  const [state, setState] = useState({ loading: true, me: null, needsSetup: false, appName: 'Project Tracker' });
  const [meta, setMeta] = useState(null);
  const [users, setUsers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [toasts, setToasts] = useState([]);

  const toast = useCallback((message, kind = 'ok') => {
    const id = Math.random();
    setToasts(t => [...t, { id, message, kind }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), kind === 'error' ? 5000 : 2800);
  }, []);

  const loadMeta = useCallback(async () => {
    const [m, u] = await Promise.all([api.get('/meta'), api.get('/users')]);
    setMeta(m); setUsers(u);
  }, []);
  const loadProjects = useCallback(async () => { setProjects(await api.get('/projects')); }, []);

  const loadMe = useCallback(async () => {
    try {
      const me = await api.get('/auth/me');
      // load reference data before rendering pages that depend on it
      await Promise.all([loadMeta(), loadProjects()]);
      setState({ loading: false, me, needsSetup: false, appName: me.appName });
      document.title = me.appName;
    } catch (e) {
      if (e.status === 401) {
        const s = await api.get('/setup-status').catch(() => ({ needsSetup: false, appName: 'Project Tracker' }));
        setState({ loading: false, me: null, needsSetup: s.needsSetup, appName: s.appName });
      } else {
        setState(s => ({ ...s, loading: false, error: e.message }));
      }
    }
  }, [loadMeta, loadProjects]);

  useEffect(() => { loadMe(); }, [loadMe]);
  useEffect(() => {
    const onOut = () => setState(s => ({ ...s, me: null }));
    window.addEventListener('pt:signed-out', onOut);
    return () => window.removeEventListener('pt:signed-out', onOut);
  }, []);

  // poll unread notifications every minute
  useEffect(() => {
    if (!state.me) return;
    const t = setInterval(async () => {
      try {
        const me = await api.get('/auth/me');
        setState(s => (s.me && s.me.unread !== me.unread ? { ...s, me } : s));
      } catch { /* ignore */ }
    }, 60000);
    return () => clearInterval(t);
  }, [state.me]);

  const value = useMemo(() => {
    const perms = new Set(state.me?.permissions || []);
    const user = state.me?.user;
    return {
      ...state, user, meta, users, projects, toast, toasts,
      reload: loadMe, reloadMeta: loadMeta, reloadProjects: loadProjects,
      can: (p) => !!user?.is_admin || perms.has(p),
      isAdmin: !!user?.is_admin,
      userById: (id) => users.find(u => u.id === Number(id)),
      activeUsers: users.filter(u => u.status === 'active'),
      setUnread: (n) => setState(s => ({ ...s, me: s.me ? { ...s.me, unread: n } : s.me })),
    };
  }, [state, meta, users, projects, toast, toasts, loadMe, loadMeta, loadProjects]);

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

// Generic data loader hook
export function useLoad(fn, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.resolve(fn()).then(d => { if (alive) { setData(d); setError(null); } })
      .catch(e => { if (alive) setError(e); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, loading, reload: () => setTick(t => t + 1), setData };
}
