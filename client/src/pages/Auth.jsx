import { useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { Field, ErrorBox } from '../components/ui.jsx';

function Art({ appName }) {
  const lanes = [
    { k: 'CRM', c: '#2E9BEA', a: 4, w: 58 },
    { k: 'HRMS', c: '#33B014', a: 18, w: 40 },
    { k: 'SALES', c: '#F39219', a: 30, w: 52 },
    { k: 'OPS', c: '#A3B9D8', a: 10, w: 34 },
  ];
  return (
    <div className="auth-art">
      <div className="row" style={{ fontWeight: 650, color: '#fff', gap: 12, fontSize: 16 }}><img src="/logo-tile.png" alt="" width="40" height="40" />{appName}</div>
      <div>
        <div className="lanes" aria-hidden="true">
          {lanes.map(l => (
            <div key={l.k} className="lane">
              <span className="k">{l.k}</span>
              <span className="track"><span style={{ left: `${l.a}%`, width: `${l.w}%`, background: l.c }} /></span>
            </div>
          ))}
        </div>
        <h1>Every application, every task and every meeting in one place.</h1>
        <p style={{ color: 'var(--on-spruce-2)', marginTop: 12, maxWidth: 420 }}>
          Runs on your office network. Your data stays on your own computer.
        </p>
      </div>
      <div className="xs" style={{ color: 'var(--on-spruce-2)' }}>Projects, tasks, boards, timelines, meetings and timesheets.</div>
    </div>
  );
}

export function Login() {
  const { reload, appName } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await api.post('/auth/login', { email, password }); await reload(); }
    catch (err) { setError(err); setBusy(false); }
  };
  return (
    <div className="auth">
      <Art appName={appName} />
      <div className="auth-form">
        <form onSubmit={submit}>
          <h2>Sign in</h2>
          <ErrorBox error={error} />
          <Field label="Email" htmlFor="email"><input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Field>
          <Field label="Password" htmlFor="password"><input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
          <button className="btn primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <p className="small muted">Forgot your password? Ask your administrator to set a new one for you.</p>
        </form>
      </div>
    </div>
  );
}

export function Setup() {
  const { reload, appName } = useApp();
  const [f, setF] = useState({ app_name: appName || 'Project Tracker', name: '', email: '', password: '', confirm: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    if (f.password !== f.confirm) { setError(new Error('The two passwords do not match.')); return; }
    setBusy(true); setError(null);
    try { await api.post('/setup', f); await reload(); }
    catch (err) { setError(err); setBusy(false); }
  };
  return (
    <div className="auth">
      <Art appName={f.app_name || 'Project Tracker'} />
      <div className="auth-form">
        <form onSubmit={submit}>
          <div>
            <h2>Set up your tracker</h2>
            <p className="soft" style={{ marginTop: 6 }}>Create the administrator account. You can add everyone else afterwards.</p>
          </div>
          <ErrorBox error={error} />
          <Field label="Name for this app" hint="Shown in the sidebar and browser tab, e.g. your company name."><input type="text" value={f.app_name} onChange={set('app_name')} required /></Field>
          <Field label="Your name"><input type="text" value={f.name} onChange={set('name')} required autoFocus /></Field>
          <Field label="Your email"><input type="email" value={f.email} onChange={set('email')} required autoComplete="username" /></Field>
          <Field label="Password" hint="At least 8 characters."><input type="password" value={f.password} onChange={set('password')} required minLength={8} autoComplete="new-password" /></Field>
          <Field label="Repeat password"><input type="password" value={f.confirm} onChange={set('confirm')} required autoComplete="new-password" /></Field>
          <button className="btn primary" disabled={busy}>{busy ? 'Creating…' : 'Create administrator and continue'}</button>
        </form>
      </div>
    </div>
  );
}
