import { useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { Field, useAsync, Avatar } from '../components/ui.jsx';

export default function Profile() {
  const { user, me, reload, projects } = useApp();
  const [f, setF] = useState({ name: user.name, job_title: user.job_title || '' });
  const [pw, setPw] = useState({ current: '', password: '', confirm: '' });
  const [busy, run] = useAsync();
  const saveProfile = async (e) => { e.preventDefault(); if (await run(() => api.patch('/auth/profile', f), 'Profile saved')) reload(); };
  const savePw = async (e) => {
    e.preventDefault();
    if (pw.password !== pw.confirm) { await run(() => Promise.reject(new Error('The new passwords do not match.'))); return; }
    if (await run(() => api.post('/auth/password', pw), 'Password changed. Other devices were signed out.')) { setPw({ current: '', password: '', confirm: '' }); reload(); }
  };
  return (
    <div className="content" style={{ maxWidth: 820 }}>
      <div className="page-head row">
        <Avatar id={user.id} name={user.name} size="lg" />
        <div className="grow"><h1>{user.name}</h1><p>{user.email}{me.user.global_role ? `, ${me.user.global_role.name}` : ''}{user.is_admin ? ', administrator' : ''}. Member of {projects.length} projects.</p></div>
      </div>
      {user.must_change_password ? <div className="warn-box" style={{ marginBottom: 16 }}>An administrator set your password. Please choose your own below.</div> : null}
      <div className="grid-2">
        <form className="panel" onSubmit={saveProfile}>
          <div className="panel-head"><h3>Profile</h3></div>
          <div className="panel-body stack">
            <Field label="Name"><input type="text" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
            <Field label="Job title"><input type="text" value={f.job_title} onChange={(e) => setF({ ...f, job_title: e.target.value })} placeholder="e.g. Backend developer" /></Field>
            <Field label="Email" hint="Ask an administrator to change your email."><input type="email" value={user.email} disabled /></Field>
          </div>
          <div className="modal-foot"><button className="btn primary" disabled={busy}>Save profile</button></div>
        </form>
        <form className="panel" onSubmit={savePw}>
          <div className="panel-head"><h3>Change password</h3></div>
          <div className="panel-body stack">
            <Field label="Current password"><input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required /></Field>
            <Field label="New password" hint="At least 8 characters."><input type="password" autoComplete="new-password" minLength={8} value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} required /></Field>
            <Field label="Repeat new password"><input type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} required /></Field>
          </div>
          <div className="modal-foot"><button className="btn primary" disabled={busy}>Change password</button></div>
        </form>
      </div>
    </div>
  );
}
