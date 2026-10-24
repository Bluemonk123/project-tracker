import { useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { api } from '../api.js';
import { useApp, useLoad } from '../context.jsx';
import Icon from '../components/Icon.jsx';
import { Loading, ErrorBox, Empty, Modal, Field, Person, useAsync, confirmDialog, MoreMenu, ColorPicker, Pill } from '../components/ui.jsx';
import { timeAgo, fmtSize, fmtDateTime } from '../lib/format.js';

const BOARD_COLUMN_NAMES = { new: 'New', design: 'In Design', develop: 'In Develop', testing: 'In Testing', closed: 'Closed' };

// ---------------- users ----------------
function UserModal({ user, onClose, onSaved }) {
  const { meta, isAdmin } = useApp();
  const teams = useLoad(() => api.get('/teams'), []);
  const globalRoles = meta.roles.filter(r => r.scope === 'global');
  const [f, setF] = useState({
    name: user?.name || '', email: user?.email || '', job_title: user?.job_title || '', password: '',
    global_role_id: user?.global_role_id ?? globalRoles.find(r => r.name === 'Employee')?.id ?? '', is_admin: !!user?.is_admin,
    team_ids: null,
  });
  const [busy, run] = useAsync();
  const set = (k, v) => setF(s => ({ ...s, [k]: v }));
  const currentTeams = f.team_ids ?? (teams.data || []).filter(t => user && t.members.some(m => m.id === user.id)).map(t => t.id);
  const gen = () => set('password', Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 6).toUpperCase());
  const save = async () => {
    const body = { ...f, team_ids: f.team_ids ?? undefined, password: f.password || undefined, global_role_id: f.global_role_id || null };
    const r = await run(() => (user ? api.patch(`/admin/users/${user.id}`, body) : api.post('/admin/users', body)), user ? 'User saved' : 'User created');
    if (r) { onSaved(); onClose(); }
  };
  return (
    <Modal title={user ? `Edit ${user.name}` : 'New user'} wide onClose={onClose} onSubmit={save} footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>{user ? 'Save' : 'Create user'}</button></>}>
      <div className="form-grid">
        <Field label="Full name"><input type="text" value={f.name} onChange={(e) => set('name', e.target.value)} required /></Field>
        <Field label="Email" hint="Used to sign in."><input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} required /></Field>
        <Field label="Job title"><input type="text" value={f.job_title} onChange={(e) => set('job_title', e.target.value)} placeholder="e.g. QA engineer" /></Field>
        <Field label="Global role" hint="Managers see every project. Employees see only projects they are members of.">
          <select value={f.global_role_id} onChange={(e) => set('global_role_id', e.target.value ? Number(e.target.value) : '')}>
            <option value="">None</option>{globalRoles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </Field>
        <Field label={user ? 'Set a new password' : 'Password'} hint={user ? 'Leave empty to keep the current password. They will be asked to change it.' : 'At least 8 characters. Share it with the person; they can change it later.'}>
          <div className="row"><input type="text" value={f.password} onChange={(e) => set('password', e.target.value)} required={!user} minLength={8} autoComplete="off" /><button type="button" className="btn" onClick={gen}>Generate</button></div>
        </Field>
        {isAdmin && <Field label="Administrator"><label className="check"><input type="checkbox" checked={f.is_admin} onChange={(e) => set('is_admin', e.target.checked)} />Full access to everything, including this page</label></Field>}
        <Field label="Teams" className="span-2">
          <div className="row wrap">
            {(teams.data || []).map(t => (
              <label key={t.id} className="check small" style={{ padding: '4px 8px', border: '1px solid var(--line)', borderRadius: 6 }}>
                <input type="checkbox" checked={currentTeams.includes(t.id)} onChange={(e) => set('team_ids', e.target.checked ? [...currentTeams, t.id] : currentTeams.filter(x => x !== t.id))} />{t.name}
              </label>
            ))}
            {!teams.data?.length && <span className="small muted">No teams yet.</span>}
          </div>
        </Field>
      </div>
    </Modal>
  );
}

function Users() {
  const { user: me, reloadMeta } = useApp();
  const { data, error, loading, reload } = useLoad(() => api.get('/admin/users'), []);
  const [modal, setModal] = useState(null);
  const [q, setQ] = useState('');
  const [, run] = useAsync();
  const refresh = () => { reload(); reloadMeta(); };
  const rows = (data || []).filter(u => !q || `${u.name} ${u.email} ${u.job_title || ''} ${u.teams || ''}`.toLowerCase().includes(q.toLowerCase()));
  if (loading && !data) return <Loading />;
  return (
    <>
      <div className="filterbar">
        <input type="search" placeholder="Filter people" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="small muted">{data.filter(u => u.status === 'active').length} active, {data.filter(u => u.status === 'locked').length} locked</span>
        <span className="spacer" />
        <button className="btn primary" onClick={() => setModal({})}><Icon name="plus" />New user</button>
      </div>
      <ErrorBox error={error} />
      <div className="panel table-wrap">
        <table className="table">
          <thead><tr><th>Name</th><th className="hide-sm">Job title</th><th>Global role</th><th className="hide-sm">Teams</th><th className="num">Projects</th><th className="hide-sm">Last sign-in</th><th>Status</th><th /></tr></thead>
          <tbody>
            {rows.map(u => (
              <tr key={u.id}>
                <td><Person id={u.id} name={u.name} /><div className="xs muted" style={{ paddingLeft: 29 }}>{u.email}</div></td>
                <td className="hide-sm soft">{u.job_title || '—'}</td>
                <td>{u.global_role_name || <span className="muted">None</span>}{u.is_admin ? <span className="tag accent" style={{ marginLeft: 6 }}>Admin</span> : null}</td>
                <td className="hide-sm small soft">{u.teams || '—'}</td>
                <td className="num">{u.project_count}</td>
                <td className="hide-sm small muted">{u.last_login_at ? timeAgo(u.last_login_at) : 'Never'}</td>
                <td>{u.status === 'locked' ? <span className="tag danger">Locked</span> : <span className="tag ok">Active</span>}</td>
                <td className="num">
                  <MoreMenu>
                    <button className="menu-item" onClick={() => setModal({ user: u })}><Icon name="edit" size={16} />Edit</button>
                    {u.id !== me.id && <button className="menu-item" onClick={async () => { await run(() => api.patch(`/admin/users/${u.id}`, { status: u.status === 'locked' ? 'active' : 'locked' }), u.status === 'locked' ? 'User unlocked' : 'User locked and signed out'); refresh(); }}>
                      <Icon name="shield" size={16} />{u.status === 'locked' ? 'Unlock' : 'Lock (block sign-in)'}</button>}
                    {u.id !== me.id && <button className="menu-item danger" onClick={async () => {
                      if (await confirmDialog({ message: `Delete ${u.name}? Their comments and history stay, shown without a name. Locking is usually better.`, confirmLabel: 'Delete user', danger: true })) { await run(() => api.del(`/admin/users/${u.id}`), 'User deleted'); refresh(); }
                    }}><Icon name="trash" size={16} />Delete</button>}
                  </MoreMenu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {modal && <UserModal user={modal.user} onClose={() => setModal(null)} onSaved={refresh} />}
    </>
  );
}

// ---------------- roles ----------------
function RoleModal({ role, scope, catalogue, onClose, onSaved }) {
  const [f, setF] = useState({ name: role?.name || '', description: role?.description || '', permissions: role?.permissions || [], scope: role?.scope || scope });
  const [busy, run] = useAsync();
  const perms = f.scope === 'global' ? [...catalogue.global, ...catalogue.project] : catalogue.project;
  const groups = [...new Set(perms.map(p => p.group))];
  const toggle = (k) => setF(s => ({ ...s, permissions: s.permissions.includes(k) ? s.permissions.filter(x => x !== k) : [...s.permissions, k] }));
  const save = async () => {
    const r = await run(() => (role ? api.patch(`/admin/roles/${role.id}`, f) : api.post('/admin/roles', f)), role ? 'Role saved' : 'Role created');
    if (r) { onSaved(); onClose(); }
  };
  return (
    <Modal title={role ? `Edit role: ${role.name}` : `New ${f.scope === 'global' ? 'global' : 'project'} role`} wide onClose={onClose} onSubmit={save}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>Save role</button></>}>
      <div className="form-grid">
        <Field label="Role name"><input type="text" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required placeholder="e.g. Business analyst" /></Field>
        <Field label="Description"><input type="text" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      </div>
      {f.scope === 'global' && <div className="info-box">Project permissions in a global role apply to <b>every</b> project. Use this for managers who monitor all applications.</div>}
      {groups.map(g => (
        <div key={g} className="perm-group">
          <h4>{g}</h4>
          <div className="perm-grid">
            {perms.filter(p => p.group === g).map(p => (
              <label key={p.key} className="check small"><input type="checkbox" checked={f.permissions.includes(p.key)} onChange={() => toggle(p.key)} />{p.label}</label>
            ))}
          </div>
        </div>
      ))}
    </Modal>
  );
}

function Roles() {
  const { reloadMeta, reload: reloadMe } = useApp();
  const { data, error, loading, reload } = useLoad(() => Promise.all([api.get('/admin/roles'), api.get('/admin/permissions')]), []);
  const [modal, setModal] = useState(null);
  const [, run] = useAsync();
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const [roles, catalogue] = data;
  const refresh = () => { reload(); reloadMeta(); reloadMe(); };
  const section = (scope, title, help) => (
    <section className="panel" style={{ marginBottom: 20 }}>
      <div className="panel-head"><h3>{title}</h3><span className="small muted hide-sm">{help}</span>
        <div className="actions"><button className="btn sm" onClick={() => setModal({ scope })}><Icon name="plus" />New role</button></div>
      </div>
      <ul className="list">
        {roles.filter(r => r.scope === scope).map(r => (
          <li key={r.id}>
            <div className="grow" style={{ minWidth: 0 }}>
              <b>{r.name}</b>{r.builtin ? <span className="tag" style={{ marginLeft: 6 }}>Built in</span> : null}
              <div className="small soft">{r.description || ' '}</div>
              <div className="xs muted">{r.permissions.length} permissions, used by {scope === 'global' ? `${r.user_count} people` : `${r.member_count} memberships`}</div>
            </div>
            <button className="btn sm" onClick={() => setModal({ role: r })}>Edit permissions</button>
            {!r.builtin && <button className="icon-btn" aria-label={`Delete ${r.name}`} onClick={async () => {
              if (await confirmDialog({ message: `Delete the role ${r.name}?`, confirmLabel: 'Delete role', danger: true })) { await run(() => api.del(`/admin/roles/${r.id}`), 'Role deleted'); refresh(); }
            }}><Icon name="trash" /></button>}
          </li>
        ))}
      </ul>
    </section>
  );
  return (
    <>
      {section('global', 'Global roles', 'Given to each person for the whole system.')}
      {section('project', 'Project roles', 'Given to each person per project when they become a member.')}
      {modal && <RoleModal role={modal.role} scope={modal.scope} catalogue={catalogue} onClose={() => setModal(null)} onSaved={refresh} />}
    </>
  );
}

// ---------------- types / statuses / priorities ----------------
function EnumEditor({ table, title, help, extra }) {
  const { meta, reloadMeta } = useApp();
  const rows = meta[table];
  const [modal, setModal] = useState(null);
  const [, run] = useAsync();
  const move = async (r, dir) => {
    const i = rows.findIndex(x => x.id === r.id), j = i + dir;
    if (j < 0 || j >= rows.length) return;
    await run(() => Promise.all([api.patch(`/admin/${table}/${r.id}`, { position: rows[j].position }), api.patch(`/admin/${table}/${rows[j].id}`, { position: r.position })]));
    reloadMeta();
  };
  return (
    <section className="panel" style={{ marginBottom: 20 }}>
      <div className="panel-head"><h3>{title}</h3><span className="small muted hide-sm">{help}</span>
        <div className="actions"><button className="btn sm" onClick={() => setModal({ row: null })}><Icon name="plus" />Add</button></div>
      </div>
      <ul className="list">
        {rows.map((r, i) => (
          <li key={r.id}>
            <Pill color={r.color}>{r.name}</Pill>
            <span className="small muted grow">{extra(r)}</span>
            <button className="icon-btn" disabled={i === 0} onClick={() => move(r, -1)} aria-label="Move up" style={{ transform: 'rotate(180deg)' }}><Icon name="chevronDown" /></button>
            <button className="icon-btn" disabled={i === rows.length - 1} onClick={() => move(r, 1)} aria-label="Move down"><Icon name="chevronDown" /></button>
            <button className="btn sm ghost" onClick={() => setModal({ row: r })}>Edit</button>
            <button className="icon-btn" aria-label={`Delete ${r.name}`} onClick={async () => {
              if (await confirmDialog({ message: `Delete “${r.name}”?`, confirmLabel: 'Delete', danger: true })) { if (await run(() => api.del(`/admin/${table}/${r.id}`), 'Deleted')) reloadMeta(); }
            }}><Icon name="trash" /></button>
          </li>
        ))}
      </ul>
      {modal && <EnumModal table={table} row={modal.row} onClose={() => setModal(null)} onSaved={reloadMeta} />}
    </section>
  );
}

function EnumModal({ table, row, onClose, onSaved }) {
  const [f, setF] = useState({ name: row?.name || '', color: row?.color || '#5B6B85', is_closed: !!row?.is_closed, is_default: !!row?.is_default, is_milestone: !!row?.is_milestone, done_ratio: row?.done_ratio ?? '', board_column: row?.board_column || '' });
  const [busy, run] = useAsync();
  const save = async () => {
    const body = { name: f.name, color: f.color };
    if (table === 'statuses') Object.assign(body, { is_closed: f.is_closed, is_default: f.is_default, done_ratio: f.done_ratio === '' ? null : Number(f.done_ratio), board_column: f.board_column || undefined });
    if (table === 'priorities') body.is_default = f.is_default;
    if (table === 'types') body.is_milestone = f.is_milestone;
    const r = await run(() => (row ? api.patch(`/admin/${table}/${row.id}`, body) : api.post(`/admin/${table}`, body)), 'Saved');
    if (r) { onSaved(); onClose(); }
  };
  return (
    <Modal title={row ? `Edit ${row.name}` : 'Add'} onClose={onClose} onSubmit={save} footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>Save</button></>}>
      <Field label="Name"><input type="text" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
      <Field label="Colour"><ColorPicker value={f.color} onChange={(v) => setF({ ...f, color: v })} /></Field>
      {table === 'statuses' && <>
        <label className="check"><input type="checkbox" checked={f.is_closed} onChange={(e) => setF({ ...f, is_closed: e.target.checked })} />Counts as closed (finished or rejected)</label>
        <label className="check"><input type="checkbox" checked={f.is_default} onChange={(e) => setF({ ...f, is_default: e.target.checked })} />Default for new work packages</label>
        <Field label="Project Board column" hint="Which column of the Project Board shows work in this status. Dragging a card into a column sets it to the first status of that column.">
          <select value={f.board_column || (f.is_closed ? 'closed' : 'develop')} onChange={(e) => setF({ ...f, board_column: e.target.value })}>
            {Object.entries(BOARD_COLUMN_NAMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Set % done to" hint="Optional. When a work package moves into this status its % done is set to this value."><input type="number" min="0" max="100" value={f.done_ratio} onChange={(e) => setF({ ...f, done_ratio: e.target.value })} /></Field>
      </>}
      {table === 'priorities' && <label className="check"><input type="checkbox" checked={f.is_default} onChange={(e) => setF({ ...f, is_default: e.target.checked })} />Default priority</label>}
      {table === 'types' && <label className="check"><input type="checkbox" checked={f.is_milestone} onChange={(e) => setF({ ...f, is_milestone: e.target.checked })} />Milestone (a single date, shown as a diamond in Gantt)</label>}
    </Modal>
  );
}

// ---------------- general ----------------
function General() {
  const { meta, appName, reload, reloadMeta } = useApp();
  const [name, setName] = useState(appName);
  const [acts, setActs] = useState(meta.activities.join('\n'));
  const [busy, run] = useAsync();
  const save = async (e) => {
    e.preventDefault();
    if (await run(() => api.patch('/admin/settings', { app_name: name, time_activities: acts.split('\n') }), 'Settings saved')) { reload(); reloadMeta(); }
  };
  return (
    <form className="panel" onSubmit={save} style={{ maxWidth: 640 }}>
      <div className="panel-head"><h3>General</h3></div>
      <div className="panel-body stack">
        <Field label="Application name" hint="Shown in the sidebar, sign-in page and browser tab."><input type="text" value={name} onChange={(e) => setName(e.target.value)} required /></Field>
        <Field label="Time tracking activities" hint="One per line. People pick one when logging time."><textarea rows={8} value={acts} onChange={(e) => setActs(e.target.value)} /></Field>
      </div>
      <div className="modal-foot"><button className="btn primary" disabled={busy}>Save settings</button></div>
    </form>
  );
}

function Backups() {
  const { data, error, loading, reload } = useLoad(() => api.get('/admin/backups'), []);
  const [busy, run] = useAsync();
  return (
    <section className="panel" style={{ maxWidth: 820 }}>
      <div className="panel-head"><h3>Backups</h3>
        <div className="actions"><button className="btn primary sm" disabled={busy} onClick={async () => { if (await run(() => api.post('/admin/backups'), 'Backup created')) reload(); }}><Icon name="database" />Back up now</button></div>
      </div>
      <div className="panel-body stack tight">
        <p className="small soft" style={{ margin: 0 }}>A copy of the database is made automatically once a day while the app is running, and the last 14 daily copies are kept in the <code>data/backups</code> folder. Download a copy now and then and keep it somewhere else, such as a USB drive or shared drive.</p>
        <p className="small soft" style={{ margin: 0 }}>To restore, stop the app, replace <code>data/tracker.db</code> with a backup file renamed to <code>tracker.db</code>, and start the app again. Uploaded files live in <code>data/uploads</code>; copy that folder too when moving computers.</p>
      </div>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : !data?.length ? <Empty small>No backups yet. The first automatic one is made a few seconds after start-up.</Empty> : (
        <ul className="list">
          {data.map(b => (
            <li key={b.name}>
              <Icon name="database" size={16} />
              <span className="grow ellipsis">{b.name}<div className="xs muted">{fmtDateTime(b.created_at.replace('T', ' ').slice(0, 19))}, {fmtSize(b.size)}</div></span>
              <a className="btn sm" href={`/api/admin/backups/${encodeURIComponent(b.name)}`}><Icon name="download" />Download</a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function Admin() {
  const { can, isAdmin } = useApp();
  const tabs = [
    ['users', 'Users', can('admin.users')],
    ['roles', 'Roles and permissions', can('admin.roles')],
    ['work', 'Types, statuses, priorities', can('admin.settings')],
    ['general', 'General', can('admin.settings')],
    ['backups', 'Backups', isAdmin],
  ].filter(t => t[2]);
  if (!tabs.length) return <div className="content"><Empty title="Administrators only">You do not have access to administration.</Empty></div>;
  return (
    <div className="content">
      <div className="page-head"><div className="grow"><h1>Administration</h1><p>People, roles, workflow settings and backups.</p></div></div>
      <nav className="tabs" style={{ marginTop: -8, marginBottom: 18, borderBottom: '1px solid var(--line)' }}>
        {tabs.map(([p, l]) => <NavLink key={p} to={`/admin/${p}`}>{l}</NavLink>)}
      </nav>
      <Routes>
        <Route index element={<Navigate to={tabs[0][0]} replace />} />
        <Route path="users" element={<Users />} />
        <Route path="roles" element={<Roles />} />
        <Route path="work" element={<>
          <EnumEditor table="types" title="Work package types" help="What kinds of work you track." extra={(r) => (r.is_milestone ? 'Milestone' : '')} />
          <EnumEditor table="statuses" title="Statuses" help="The steps work moves through, and the Kanban column each one appears in." extra={(r) => [BOARD_COLUMN_NAMES[r.board_column] ? `Board: ${BOARD_COLUMN_NAMES[r.board_column]}` : null, r.is_closed ? 'Closed' : 'Open', r.is_default ? 'Default' : null, r.done_ratio != null ? `sets ${r.done_ratio}% done` : null].filter(Boolean).join(', ')} />
          <EnumEditor table="priorities" title="Priorities" help="Lowest first." extra={(r) => (r.is_default ? 'Default' : '')} />
        </>} />
        <Route path="general" element={<General />} />
        <Route path="backups" element={<Backups />} />
      </Routes>
    </div>
  );
}
