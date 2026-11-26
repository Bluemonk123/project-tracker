import { useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { Field, ErrorBox, Modal } from '../components/ui.jsx';
import { FilePicker, toForm } from './tickets/common.jsx';

function Art({ appName }) {
  const lanes = [
    { k: 'CRM', c: '#2E9BEA', a: 4, w: 58 },
    { k: 'HRMS', c: '#33B014', a: 18, w: 40 },
    { k: 'SALES', c: '#F39219', a: 30, w: 52 },
    { k: 'OPS', c: '#A3B9D8', a: 10, w: 34 },
  ];
  return (
    <div className="auth-art">
      <div className="row" style={{ fontWeight: 650, color: '#fff', gap: 12, fontSize: 16 }}><img src="/logo-mark.svg" alt="" width="40" height="40" />{appName}</div>
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

// Two-step sign-in: email first; then the password, or — for a new account — choosing one.
export function Login() {
  const { reload, appName } = useApp();
  const [step, setStep] = useState('email'); // email | password | set_password
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [contact, setContact] = useState(false);
  const run = async (fn) => { setBusy(true); setError(null); try { await fn(); } catch (err) { setError(err); } finally { setBusy(false); } };
  const submit = (e) => {
    e.preventDefault();
    if (step === 'email') return run(async () => { const r = await api.post('/auth/lookup', { email }); setStep(r.next); setPassword(''); setPassword2(''); });
    if (step === 'password') return run(async () => { await api.post('/auth/login', { email, password }); await reload(); });
    if (password !== password2) { setError(new Error('The two passwords are not the same.')); return undefined; }
    return run(async () => { await api.post('/auth/first-password', { email, password }); await reload(); });
  };
  const back = () => { setStep('email'); setError(null); setPassword(''); setPassword2(''); };
  return (
    <div className="auth">
      <Art appName={appName} />
      <div className="auth-form">
        <form onSubmit={submit}>
          <h2>{step === 'set_password' ? 'Set your password' : 'Sign in'}</h2>
          <ErrorBox error={error} />
          {step === 'email' ? (
            <Field label="Email" htmlFor="email"><input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Field>
          ) : (
            <div className="auth-email-chip"><span className="ellipsis">{email}</span><button type="button" className="link-btn small" onClick={back}>Change</button></div>
          )}
          {step === 'password' && (
            <Field label="Password" htmlFor="password"><input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus /></Field>
          )}
          {step === 'set_password' && <>
            <p className="small soft" style={{ margin: 0 }}>Welcome! This is your first sign-in. Choose a password for your account.</p>
            <Field label="New password" htmlFor="npw" hint="At least 8 characters."><input id="npw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoFocus /></Field>
            <Field label="Repeat new password" htmlFor="npw2"><input id="npw2" type="password" autoComplete="new-password" value={password2} onChange={(e) => setPassword2(e.target.value)} required minLength={8} /></Field>
          </>}
          <button className="btn primary" disabled={busy}>
            {busy ? 'Please wait…' : step === 'email' ? 'Continue' : step === 'password' ? 'Sign in' : 'Save password and sign in'}
          </button>
          {step !== 'set_password' && <p className="small muted">Forgot your password? Contact your administrator.</p>}
          <button type="button" className="btn ghost tk-contact-link" onClick={() => setContact(true)}>Contact admin for access/issues</button>
        </form>
      </div>
      {contact && <ContactAdminModal onClose={() => setContact(false)} />}
    </div>
  );
}

// First sign-in with a password an administrator set: choose your own before using the app (no current password asked).
export function FirstPassword() {
  const { reload, appName, user } = useApp();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (pw !== pw2) { setError(new Error('The two passwords are not the same.')); return; }
    setBusy(true); setError(null);
    try { await api.post('/auth/password', { password: pw }); await reload(); }
    catch (err) { setError(err); setBusy(false); }
  };
  const signOut = async () => { try { await api.post('/auth/logout'); } finally { reload(); } };
  return (
    <div className="auth">
      <Art appName={appName} />
      <div className="auth-form">
        <form onSubmit={submit}>
          <h2>Set your password</h2>
          <p className="small soft" style={{ marginTop: 0 }}>Welcome{user?.name ? `, ${String(user.name).split(' ')[0]}` : ''}! You signed in with a temporary password from your administrator. Choose your own password to continue.</p>
          <ErrorBox error={error} />
          <input type="email" autoComplete="username" value={user?.email || ''} readOnly hidden />
          <Field label="New password" htmlFor="npw" hint="At least 8 characters."><input id="npw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={8} autoFocus /></Field>
          <Field label="Repeat new password" htmlFor="npw2"><input id="npw2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required minLength={8} /></Field>
          <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save password and continue'}</button>
          <button type="button" className="btn ghost" onClick={signOut}>Sign out</button>
        </form>
      </div>
    </div>
  );
}

// For people who can't sign in: raises a ticket for the administrators (no account needed).
function ContactAdminModal({ onClose }) {
  const [f, setF] = useState({ name: '', email: '', description: '' });
  const [files, setFiles] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async () => {
    if (f.name.trim().startsWith('[')) { setError(new Error('A name cannot start with "[".')); return; }
    if (f.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) { setError(new Error('That email address is not valid.')); return; }
    setBusy(true); setError(null);
    try { setDone(await api.post('/public/contact', toForm(f, files))); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  if (done) {
    return (
      <Modal title="Message sent" onClose={onClose} footer={<button type="button" className="btn primary" onClick={onClose}>Done</button>}>
        <div className="tk-done">
          <div className="xs muted">Your ticket number</div>
          <div className="tk-done-no">{done.ticket_no}</div>
          <p className="small muted">{f.email.trim() ? `The administrators have been told. Replies and changes are emailed to ${f.email.trim()}.` : 'The administrators have been told. Keep this number to ask about it later.'}</p>
        </div>
        {done.warnings?.length > 0 && <div className="warn-box">{done.warnings.map(w => <div key={w}>{w}</div>)}</div>}
      </Modal>
    );
  }
  return (
    <Modal title="Contact admin for access/issues" onClose={onClose} onSubmit={submit} footer={<>
      <button type="button" className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy}>{busy ? 'Sending…' : 'Send'}</button>
    </>}>
      <ErrorBox error={error} />
      <Field label="Your name"><input type="text" maxLength={100} required value={f.name} onChange={set('name')} autoComplete="name" /></Field>
      <Field label="Email" hint="Optional. Replies and changes to your ticket are emailed here.">
        <input type="email" maxLength={254} value={f.email} onChange={set('email')} autoComplete="email" />
      </Field>
      <Field label="Describe the problem"><textarea rows={5} maxLength={5000} required value={f.description} onChange={set('description')} placeholder="e.g. I can't sign in with my email, or I need access to a project." /></Field>
      <FilePicker files={files} onChange={setFiles} onError={(m) => setError(new Error(m))} />
    </Modal>
  );
}

function SetupDataDir() {
  const { dataDir } = useApp();
  if (!dataDir) return null;
  return <p className="xs muted" style={{ marginTop: 18, maxWidth: 380, wordBreak: 'break-all' }}>Data folder: <code>{dataDir}</code><br />Expected your existing data here? Then the server setting DATA_DIR is wrong or missing: fix it and restart instead of creating a new administrator.</p>;
}

// Moving from another computer: load its full backup instead of starting empty.
function RestoreBackup() {
  const { reload } = useApp();
  const [file, setFile] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const go = async () => {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const fd = new FormData(); fd.append('file', file);
      const r = await api.post('/setup/restore', fd);
      setDone(r);
      setTimeout(() => { reload(); }, 2500);
    } catch (err) { setError(err); setBusy(false); }
  };
  return (
    <div className="setup-restore">
      <h3>Moving from another computer?</h3>
      <p className="small soft">Instead of creating an administrator, load the <b>full backup</b> downloaded from your current Project Tracker (Administration → Backups → Download full backup). All projects, tasks, people and files come across, and everyone signs in with their usual email and password.</p>
      <ErrorBox error={error} />
      {done ? <p className="setup-restore-ok">Backup loaded: {done.people} people and {done.files} files. Opening the sign-in page…</p> : (
        <div className="setup-restore-row">
          <input type="file" accept=".zip,.db" onChange={(e) => setFile(e.target.files?.[0] || null)} disabled={busy} />
          <button type="button" className="btn" disabled={!file || busy} onClick={go}>{busy ? 'Loading… (this can take a minute)' : 'Load backup'}</button>
        </div>
      )}
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
        <RestoreBackup />
        <SetupDataDir />
      </div>
    </div>
  );
}
