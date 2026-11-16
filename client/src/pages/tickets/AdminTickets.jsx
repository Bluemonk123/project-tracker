// Administration -> Ticket Board: SLA hours, groups, saved replies (macros) and the email mailbox.
import { useState } from 'react';
import { api } from '../../api.js';
import { useApp, useLoad } from '../../context.jsx';
import Icon from '../../components/Icon.jsx';
import { Loading, ErrorBox, Modal, Field, useAsync, confirmDialog, MoreMenu } from '../../components/ui.jsx';
import { STATUS, PRIORITY } from './common.jsx';

export default function AdminTickets() {
  const { isAdmin } = useApp();
  const { data, error, loading, reload } = useLoad(() => api.get('/admin/ticket-settings'), []);
  if (error) return <ErrorBox error={error} />;
  if (loading && !data) return <Loading />;
  return (
    <div className="stack" style={{ gap: 18, maxWidth: 900 }}>
      <div className="info-box">Who can use the Ticket Board is set in <b>Roles and permissions</b> (Ticket Board: Enable / Add / Edit). Engineers are the members and lead of any team whose name contains “Ticket” or “Support”; until such a team has members, everyone who can open the board.</div>
      <Sla sla={data.sla} onSaved={reload} />
      <Groups groups={data.groups} onSaved={reload} />
      <Macros macros={data.macros} groups={data.groups.filter(g => g.active).map(g => g.name)} onSaved={reload} />
      {isAdmin && <Email />}
    </div>
  );
}

function Sla({ sla, onSaved }) {
  const [f, setF] = useState(sla);
  const [busy, run] = useAsync();
  const save = async (e) => { e.preventDefault(); if (await run(() => api.put('/admin/ticket-settings/sla', f), 'SLA saved')) onSaved(); };
  return (
    <form className="panel" onSubmit={save}>
      <div className="panel-head"><h3>SLA</h3><span className="xs muted">Hours to solve a ticket, by priority. Time on hold doesn't count.</span></div>
      <div className="panel-body row wrap" style={{ gap: 16 }}>
        {Object.keys(PRIORITY).map(k => (
          <Field key={k} label={`${PRIORITY[k].label} (hours)`}>
            <input type="number" min={0.25} step={0.25} max={2160} required value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} style={{ width: 120 }} />
          </Field>
        ))}
      </div>
      <div className="modal-foot"><button className="btn primary" disabled={busy}>Save SLA</button></div>
    </form>
  );
}

function Groups({ groups, onSaved }) {
  const [name, setName] = useState('');
  const [busy, run] = useAsync();
  const add = async (e) => { e.preventDefault(); if (await run(() => api.post('/admin/ticket-groups', { name }), 'Group added')) { setName(''); onSaved(); } };
  const rename = async (g) => {
    const n = window.prompt('New name for the group', g.name);
    if (n && n.trim() && n.trim() !== g.name && await run(() => api.patch(`/admin/ticket-groups/${g.id}`, { name: n.trim() }), 'Group renamed')) onSaved();
  };
  const toggle = async (g) => { if (await run(() => api.patch(`/admin/ticket-groups/${g.id}`, { active: !g.active }), g.active ? 'Group deactivated' : 'Group activated')) onSaved(); };
  return (
    <section className="panel">
      <div className="panel-head"><h3>Groups</h3><span className="xs muted">The team a ticket belongs to. Deactivated groups stay on old tickets but can't be chosen.</span></div>
      <ul className="list">
        {groups.map(g => (
          <li key={g.id}>
            <span className="grow">{g.name}{!g.active && <span className="tag" style={{ marginLeft: 8 }}>Inactive</span>}</span>
            <span className="xs muted">{g.ticket_count} ticket{g.ticket_count === 1 ? '' : 's'}</span>
            <button type="button" className="btn sm ghost" disabled={busy} onClick={() => rename(g)}><Icon name="edit" />Rename</button>
            <button type="button" className="btn sm" disabled={busy} onClick={() => toggle(g)}>{g.active ? 'Deactivate' : 'Activate'}</button>
          </li>
        ))}
      </ul>
      <form className="panel-body row" onSubmit={add} style={{ borderTop: '1px solid var(--line-2)' }}>
        <input type="text" placeholder="New group name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} required style={{ maxWidth: 260 }} />
        <button className="btn" disabled={busy}><Icon name="plus" />Add group</button>
      </form>
    </section>
  );
}

function Macros({ macros, groups, onSaved }) {
  const [edit, setEdit] = useState(null);
  const [, run] = useAsync();
  const del = async (m) => {
    if (await confirmDialog({ title: `Delete “${m.name}”?`, message: 'Agents can no longer pick this saved reply.', confirmLabel: 'Delete', danger: true })
      && await run(() => api.del(`/admin/ticket-macros/${m.id}`), 'Saved reply deleted')) onSaved();
  };
  return (
    <section className="panel">
      <div className="panel-head"><h3>Saved replies (macros)</h3>
        <div className="actions"><button type="button" className="btn sm" onClick={() => setEdit({})}><Icon name="plus" />New saved reply</button></div>
      </div>
      {!macros.length ? <div className="panel-body small muted">No saved replies yet.</div> : (
        <ul className="list">
          {macros.map(m => (
            <li key={m.id}>
              <div className="grow" style={{ minWidth: 0 }}>
                <div>{m.name}{!m.active && <span className="tag" style={{ marginLeft: 8 }}>Off</span>}{m.is_internal ? <span className="tag signal" style={{ marginLeft: 8 }}>Internal note</span> : null}</div>
                <div className="xs muted ellipsis">{m.body_template.replace(/\s+/g, ' ')}</div>
              </div>
              <span className="xs muted">{[m.set_status && `sets ${STATUS[m.set_status]?.label}`, m.set_group && `group ${m.set_group}`].filter(Boolean).join(', ')}</span>
              <MoreMenu>
                <button type="button" className="menu-item" onClick={() => setEdit(m)}><Icon name="edit" size={16} />Edit</button>
                <button type="button" className="menu-item danger" onClick={() => del(m)}><Icon name="trash" size={16} />Delete</button>
              </MoreMenu>
            </li>
          ))}
        </ul>
      )}
      {edit && <MacroModal macro={edit} groups={groups} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); onSaved(); }} />}
    </section>
  );
}

function MacroModal({ macro, groups, onClose, onSaved }) {
  const [f, setF] = useState({ name: macro.name || '', body_template: macro.body_template || '', set_status: macro.set_status || '', set_group: macro.set_group || '', is_internal: !!macro.is_internal, active: macro.active === undefined ? true : !!macro.active });
  const [busy, run] = useAsync();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = async () => {
    const body = { ...f, set_status: f.set_status || null, set_group: f.set_group || null };
    if (await run(() => (macro.id ? api.put(`/admin/ticket-macros/${macro.id}`, body) : api.post('/admin/ticket-macros', body)), 'Saved reply saved')) onSaved();
  };
  return (
    <Modal title={macro.id ? `Edit saved reply: ${macro.name}` : 'New saved reply'} wide onClose={onClose} onSubmit={save} footer={<>
      <button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>Save</button>
    </>}>
      <Field label="Name"><input type="text" required maxLength={80} value={f.name} onChange={set('name')} /></Field>
      <Field label="Reply text" hint="Placeholders: {customer_first_name}, {agent_first_name}, {ticket_id}">
        <textarea rows={7} required maxLength={5000} value={f.body_template} onChange={set('body_template')} />
      </Field>
      <div className="grid-2" style={{ gap: 12 }}>
        <Field label="Set status"><select value={f.set_status} onChange={set('set_status')}><option value="">Leave as it is</option>{Object.entries(STATUS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}</select></Field>
        <Field label="Set group"><select value={f.set_group} onChange={set('set_group')}><option value="">Leave as it is</option>{groups.map(g => <option key={g} value={g}>{g}</option>)}</select></Field>
      </div>
      <label className="row small"><input type="checkbox" checked={f.is_internal} onChange={set('is_internal')} />Add as an internal note</label>
      <label className="row small"><input type="checkbox" checked={f.active} onChange={set('active')} />Agents can pick it</label>
    </Modal>
  );
}

const BLANK = { host: '', port: 587, secure: false, user: '', pass: '', from: '', from_name: '' };
function Email() {
  const { data, error, loading, reload } = useLoad(() => api.get('/admin/email'), []);
  if (error) return <ErrorBox error={error} />;
  if (loading && !data) return <Loading />;
  return <EmailForm key={JSON.stringify(data)} data={data} onSaved={reload} />;
}
function EmailForm({ data, onSaved }) {
  const [main, setMain] = useState({ ...BLANK, ...(data.main || {}), pass: '' });
  const [backup, setBackup] = useState({ ...BLANK, ...(data.backup || {}), pass: '' });
  const [showBackup, setShowBackup] = useState(!!data.backup);
  const [busy, run] = useAsync();
  const save = async (e) => {
    e.preventDefault();
    if (await run(() => api.put('/admin/email', { main: main.host ? main : null, backup: showBackup && backup.host ? backup : null }), 'Email settings saved')) onSaved();
  };
  const test = async () => { const r = await run(() => api.post('/admin/email/test')); if (r) window.alert(`Test email sent to ${r.to} through the ${r.via} mailbox.`); };
  return (
    <form className="panel" onSubmit={save}>
      <div className="panel-head"><h3>Email</h3><span className="xs muted">The company mailbox that sends ticket alerts to requesters. Leave empty and nothing is emailed.</span></div>
      <div className="panel-body stack">
        <MailboxFields title="Main mailbox" m={main} setM={setMain} hasPass={data.main?.has_pass} />
        {showBackup
          ? <MailboxFields title="Backup mailbox (used when the main one fails)" m={backup} setM={setBackup} hasPass={data.backup?.has_pass} />
          : <button type="button" className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setShowBackup(true)}><Icon name="plus" />Add a backup mailbox</button>}
      </div>
      <div className="modal-foot">
        {data.main && <button type="button" className="btn" disabled={busy} onClick={test}>Send a test email to me</button>}
        <button className="btn primary" disabled={busy}>Save email settings</button>
      </div>
    </form>
  );
}
function MailboxFields({ title, m, setM, hasPass }) {
  const set = (k) => (e) => setM({ ...m, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  return (
    <fieldset className="tk-mailbox">
      <legend className="small"><b>{title}</b></legend>
      <div className="grid-3" style={{ gap: 12 }}>
        <Field label="Mail server (SMTP)"><input type="text" placeholder="smtp.office365.com" value={m.host} onChange={set('host')} /></Field>
        <Field label="Port"><input type="number" min={1} max={65535} value={m.port} onChange={set('port')} /></Field>
        <Field label="Security"><label className="row small" style={{ height: 34 }}><input type="checkbox" checked={m.secure} onChange={set('secure')} />SSL/TLS from the start (port 465)</label></Field>
        <Field label="User name"><input type="text" autoComplete="off" value={m.user} onChange={set('user')} /></Field>
        <Field label="Password" hint={hasPass ? 'Saved. Leave empty to keep it.' : undefined}><input type="password" autoComplete="new-password" value={m.pass} onChange={set('pass')} /></Field>
        <Field label="Send from (address)"><input type="email" placeholder="helpdesk@company.com" value={m.from} onChange={set('from')} /></Field>
        <Field label="Sender name"><input type="text" placeholder="Helpdesk" value={m.from_name} onChange={set('from_name')} /></Field>
      </div>
    </fieldset>
  );
}
