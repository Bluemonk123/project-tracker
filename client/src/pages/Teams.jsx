import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useApp, useLoad } from '../context.jsx';
import Icon from '../components/Icon.jsx';
import { Loading, ErrorBox, Empty, Modal, Field, MultiUserPicker, UserSelect, Person, useAsync, confirmDialog, MoreMenu, Popover } from '../components/ui.jsx';
import { WorkloadTable } from './Overview.jsx';

function TeamModal({ team, onClose, onSaved }) {
  const [f, setF] = useState({ name: team?.name || '', description: team?.description || '', lead_id: team?.lead_id || null, member_ids: team?.members.map(m => m.id) || [] });
  const [busy, run] = useAsync();
  const save = async () => {
    const r = await run(() => (team ? api.patch(`/teams/${team.id}`, f) : api.post('/teams', f)), team ? 'Team saved' : 'Team created');
    if (r) { onSaved(); onClose(); }
  };
  return (
    <Modal title={team ? `Edit ${team.name}` : 'New team'} onClose={onClose} onSubmit={save} footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>Save team</button></>}>
      <div className="form-grid">
        <Field label="Team name"><input type="text" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required placeholder="e.g. Mobile team" /></Field>
        <Field label="Team lead"><UserSelect value={f.lead_id} onChange={(v) => setF({ ...f, lead_id: v })} placeholder="Nobody" /></Field>
        <Field label="What the team does" className="span-2"><input type="text" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      </div>
      <Field label="Members"><MultiUserPicker value={f.member_ids} onChange={(v) => setF({ ...f, member_ids: v })} /></Field>
    </Modal>
  );
}

// Multi-select dropdown of team roles.
function RolePicker({ value, options, onChange, disabled, label, placeholder = 'Choose roles' }) {
  if (disabled) return value.length ? <span className="tm-chips">{value.map(r => <span key={r} className="tm-chip">{r}</span>)}</span> : <span className="xs muted">Not set</span>;
  return (
    <Popover align="left" trigger={({ toggle, open }) => (
      <button type="button" className={`tm-multi${open ? ' open' : ''}`} onClick={toggle} aria-label={label} aria-expanded={open}>
        {value.length ? <span className="tm-chips">{value.map(r => <span key={r} className="tm-chip">{r}</span>)}</span> : <span className="muted">{placeholder}</span>}
        <Icon name="chevronDown" size={13} />
      </button>
    )}>
      {options.map(o => (
        <label key={o} className="menu-item check">
          <input type="checkbox" checked={value.includes(o)} onChange={(e) => onChange(e.target.checked ? options.filter(x => x === o || value.includes(x)) : value.filter(x => x !== o))} />{o}
        </label>
      ))}
    </Popover>
  );
}

// A team's members as a table, one row per person. Drag the handle to move someone above or below others (within this team only).
function MemberList({ team, roles, canManage, reload, onProjects }) {
  const [order, setOrder] = useState(null); // optimistic order while saving
  const [dragId, setDragId] = useState(null);
  const [overAt, setOverAt] = useState(null); // { id, after }
  const [, run] = useAsync();
  const members = order ? order.map(id => team.members.find(m => m.id === id)).filter(Boolean) : team.members;
  const DND = `application/x-pt-team-${team.id}`;
  const save = async (ids) => {
    setOrder(ids);
    await run(() => api.put(`/teams/${team.id}/order`, { user_ids: ids }));
    await reload(); setOrder(null);
  };
  const move = (fromId, toId, after) => {
    const ids = members.map(m => m.id).filter(id => id !== fromId);
    let at = ids.indexOf(toId);
    if (at < 0) return;
    if (after) at += 1;
    ids.splice(at, 0, fromId);
    if (ids.join() !== members.map(m => m.id).join()) save(ids);
  };
  const nudge = (id, dir) => {
    const ids = members.map(m => m.id);
    const i = ids.indexOf(id), j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    save(ids);
  };
  const setRoles = async (m, key, v) => {
    await run(() => api.patch(`/teams/${team.id}/members/${m.id}`, { [key]: v }));
    reload();
  };
  if (!members.length) return <div className="panel-body small muted">No members.</div>;
  return (
    <div className="table-wrap">
      <table className="table tm-table" onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOverAt(null); }}>
        <thead><tr>
          {canManage && <th className="tm-hcell" aria-label="Order" />}
          <th>Name</th><th>Job title</th><th className="tm-rolecol">Current role</th><th aria-hidden="true" /><th className="tm-rolecol">Future role</th>
          <th className="num">Occupancy</th><th className="num">Projects</th>
        </tr></thead>
        <tbody>
          {members.map(m => {
            const changed = m.proposed_roles.length > 0 && m.proposed_roles.join() !== m.current_roles.join();
            const cls = ['tm-item', dragId === m.id ? 'dragging' : '', overAt?.id === m.id ? (overAt.after ? 'drop-after' : 'drop-before') : ''].join(' ');
            const occ = m.occupancy;
            return (
              <tr key={m.id} className={cls}
                onDragOver={(e) => {
                  if (!canManage || !e.dataTransfer.types.includes(DND)) return; // only members of this same team
                  e.preventDefault(); e.dataTransfer.dropEffect = 'move';
                  const r = e.currentTarget.getBoundingClientRect();
                  const after = e.clientY > r.top + r.height / 2;
                  if (overAt?.id !== m.id || overAt.after !== after) setOverAt({ id: m.id, after });
                }}
                onDrop={(e) => {
                  if (!e.dataTransfer.types.includes(DND)) return;
                  e.preventDefault();
                  const from = Number(e.dataTransfer.getData(DND));
                  const after = overAt?.after;
                  setOverAt(null); setDragId(null);
                  if (from && from !== m.id) move(from, m.id, after);
                }}>
                {canManage && (
                  <td className="tm-hcell">
                    <span className="tm-handle" draggable title="Drag to move up or down (or use the arrow keys)" role="button" tabIndex={0}
                      aria-label={`Move ${m.name}. Use the up and down arrow keys.`}
                      onDragStart={(e) => { e.dataTransfer.setData(DND, String(m.id)); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setDragImage(e.currentTarget.closest('tr'), 20, 20); setDragId(m.id); }}
                      onDragEnd={() => { setDragId(null); setOverAt(null); }}
                      onKeyDown={(e) => { if (e.key === 'ArrowUp') { e.preventDefault(); nudge(m.id, -1); } if (e.key === 'ArrowDown') { e.preventDefault(); nudge(m.id, 1); } }}>
                      <Icon name="grip" size={16} />
                    </span>
                  </td>
                )}
                <td className="tm-name"><Person id={m.id} name={m.name} />{m.id === team.lead_id && <span className="tag accent" style={{ marginLeft: 6 }}>Lead</span>}</td>
                <td className="small soft">{m.job_title || '—'}</td>
                <td className="tm-rolecol"><RolePicker value={m.current_roles} options={roles} disabled={!canManage} label={`${m.name}: current role`} onChange={(v) => setRoles(m, 'current_roles', v)} /></td>
                <td className={`tm-arrow${changed ? ' changed' : ''}`} title={changed ? 'Role change planned' : undefined} aria-hidden="true">→</td>
                <td className="tm-rolecol"><RolePicker value={m.proposed_roles} options={roles} disabled={!canManage} label={`${m.name}: future role`} onChange={(v) => setRoles(m, 'proposed_roles', v)} /></td>
                <td className="num">
                  {occ == null ? <span className="muted">—</span> : <span className={`tm-occ${occ > 100 ? ' over' : occ < 50 ? ' low' : ''}`} title={`Total occupancy across ${m.project_count} project${m.project_count === 1 ? '' : 's'} (from each project's team)`}>{occ}%</span>}
                </td>
                <td className="num">
                  {m.project_count ? <button type="button" className="link-btn tm-count" onClick={() => onProjects(m)} aria-label={`${m.name}: ${m.project_count} projects`}>{m.project_count}</button> : <span className="muted">0</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// The projects a person is in, with their Project Manager and Account Manager.
function UserProjects({ member, onClose }) {
  const { data, error, loading } = useLoad(() => api.get(`/users/${member.id}/projects`), [member.id]);
  const who = (list) => (list?.length ? list.map(x => (
    <div key={x.id} className="tm-pm"><Person id={x.id} name={x.name} /><a className="xs" href={`mailto:${x.email}`}>{x.email}</a></div>
  )) : <span className="muted small">Not mapped</span>);
  return (
    <Modal title={`${member.name}: projects`} wide onClose={onClose} footer={<button type="button" className="btn primary" onClick={onClose}>Close</button>}>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : !data?.projects.length ? <Empty title="No projects">{member.name} is not a member of any project you can see.</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Project</th><th>Role</th><th className="num">Occupancy</th><th>Project Manager</th><th>Account Manager</th></tr></thead>
            <tbody>
              {data.projects.map(p => (
                <tr key={p.id}>
                  <td><Link to={`/project-board?p=${p.identifier}`} onClick={onClose}><span className="pb-dot" style={{ '--pc': p.color, display: 'inline-block', marginRight: 6 }} />{p.name}</Link></td>
                  <td className="small">{p.role_name}</td>
                  <td className="num">{p.occupancy == null ? <span className="muted">—</span> : `${p.occupancy}%`}</td>
                  <td>{who(p.pm)}</td>
                  <td>{who(p.am)}</td>
                </tr>
              ))}
              <tr className="group-row"><td colSpan={2}>Total</td><td className="num">{data.projects.reduce((t, p) => t + (p.occupancy || 0), 0)}%</td><td colSpan={2} /></tr>
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

export default function Teams() {
  const { can } = useApp();
  const { data, error, loading, reload } = useLoad(() => api.get('/teams'), []);
  const { data: roles } = useLoad(() => api.get('/team-roles'), []);
  const [modal, setModal] = useState(null);
  const [view, setView] = useState(null);
  const [projectsOf, setProjectsOf] = useState(null);
  const [, run] = useAsync();
  const canManage = can('teams.manage');
  return (
    <div className="content">
      <div className="page-head">
        <div className="grow"><h1>Teams</h1><p>Groups of people. Add a whole team to a project in one step, and compare workload by team.</p></div>
        {canManage && <div className="head-actions"><button className="btn primary" onClick={() => setModal({})}><Icon name="plus" />New team</button></div>}
      </div>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : !data.length ? (
        <div className="panel"><Empty title="No teams yet" action={canManage && <button className="btn primary" onClick={() => setModal({})}><Icon name="plus" />Create a team</button>}>
          For example: Web team, Mobile team, QA, Support.
        </Empty></div>
      ) : (
        <div className="stack">
          {data.map(t => (
            <section key={t.id} className="panel">
              <div className="panel-head">
                <h3>{t.name}</h3><span className="small muted">{t.members.length} people</span>
                <div className="actions">
                  {can('reports.view') && <button className="btn sm ghost" onClick={() => setView(t)}>Workload</button>}
                  {canManage && (
                    <MoreMenu>
                      <button className="menu-item" onClick={() => setModal({ team: t })}><Icon name="edit" size={16} />Edit</button>
                      <button className="menu-item danger" onClick={async () => {
                        if (await confirmDialog({ message: `Delete the team ${t.name}? People and project memberships are not affected.`, confirmLabel: 'Delete team', danger: true })) { await run(() => api.del(`/teams/${t.id}`), 'Team deleted'); reload(); }
                      }}><Icon name="trash" size={16} />Delete</button>
                    </MoreMenu>
                  )}
                </div>
              </div>
              {t.description && <div className="panel-body small soft" style={{ paddingBottom: 0 }}>{t.description}</div>}
              <MemberList team={t} roles={roles || []} canManage={canManage} reload={reload} onProjects={setProjectsOf} />
            </section>
          ))}
        </div>
      )}
      {projectsOf && <UserProjects member={projectsOf} onClose={() => setProjectsOf(null)} />}
      {modal && <TeamModal team={modal.team} onClose={() => setModal(null)} onSaved={reload} />}
      {view && (
        <Modal title={`${view.name} workload`} wide onClose={() => setView(null)}>
          <WorkloadTable teamId={view.id} />
          <Link to="/overview" className="small">Open the manager overview</Link>
        </Modal>
      )}
    </div>
  );
}
