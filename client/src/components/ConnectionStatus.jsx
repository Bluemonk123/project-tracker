import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useApp } from '../context.jsx';

// Icons from the OxyPC Cloud Icons pack (currentColor versions).
function CloudConnected({ size = 18 }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <mask id={`cem${id}`}>
          <rect width="24" height="24" fill="#fff" />
          <path d="M13.4 8.6L9.3 13.9h3l-1 4.2 4.3-5.6h-3.1z" fill="#000" stroke="#000" strokeWidth="0.8" strokeLinejoin="round" />
        </mask>
      </defs>
      <path d="M7 18.5h10.5a4.5 4.5 0 0 0 .6-8.96A6 6 0 0 0 6.4 10.6 4 4 0 0 0 7 18.5z" fill="currentColor" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" mask={`url(#cem${id})`} />
    </svg>
  );
}

function CloudDisconnected({ size = 18 }) {
  const id = useId().replace(/:/g, '');
  const cloud = 'M7 18.5h10.5a4.5 4.5 0 0 0 .6-8.96A6 6 0 0 0 6.4 10.6 4 4 0 0 0 7 18.5z';
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <g transform="translate(12 12.5) scale(.86) translate(-12 -13)">
        <defs>
          <clipPath id={`csfl${id}`}><path d="M0 0H12.6L11.2 9.2L13.2 12.6L11.6 24H0Z" /></clipPath>
          <clipPath id={`csfr${id}`}><path d="M24 0H12.6L11.2 9.2L13.2 12.6L11.6 24H24Z" /></clipPath>
        </defs>
        <g fill="currentColor" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round">
          <g transform="translate(-1.3 0)"><path d={cloud} clipPath={`url(#csfl${id})`} /></g>
          <g transform="translate(1.3 0)"><path d={cloud} clipPath={`url(#csfr${id})`} /></g>
        </g>
      </g>
    </svg>
  );
}

const CHECK_EVERY_MS = 15000;
const TIMEOUT_MS = 5000;

// Shows whether this browser can reach the Project Tracker server.
export default function ConnectionStatus() {
  const { toast } = useApp();
  const [online, setOnline] = useState(true);
  const [checkedAt, setCheckedAt] = useState(null);
  const prev = useRef(true);

  const check = useCallback(async () => {
    let ok = false;
    if (navigator.onLine !== false) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      try {
        const res = await fetch('/api/health', { cache: 'no-store', signal: ctrl.signal });
        ok = res.ok;
      } catch { ok = false; } finally { clearTimeout(t); }
    }
    setOnline(ok);
    setCheckedAt(new Date());
    if (ok !== prev.current) {
      toast(ok ? 'Connected to the server again.' : 'Lost connection to the server. Changes cannot be saved until it is back.', ok ? 'ok' : 'error');
      prev.current = ok;
    }
  }, [toast]);

  useEffect(() => {
    check();
    const timer = setInterval(check, CHECK_EVERY_MS);
    const recheck = () => check();
    window.addEventListener('online', recheck);
    window.addEventListener('offline', recheck);
    document.addEventListener('visibilitychange', recheck);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', recheck);
      window.removeEventListener('offline', recheck);
      document.removeEventListener('visibilitychange', recheck);
    };
  }, [check]);

  const when = checkedAt ? checkedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
  const title = online
    ? `Connected to the Project Tracker server (checked ${when}).`
    : `Cannot reach the Project Tracker server (checked ${when}). Check the network, or that the computer running the app is on. Click to check again.`;
  return (
    <button type="button" className={`conn ${online ? 'ok' : 'down'}`} onClick={check} title={title} aria-live="polite"
      aria-label={online ? 'Connected' : 'Disconnected. Click to check again.'}>
      {online ? <CloudConnected /> : <CloudDisconnected />}
      <span className="conn-text">{online ? 'Connected' : 'Disconnected'}</span>
    </button>
  );
}
