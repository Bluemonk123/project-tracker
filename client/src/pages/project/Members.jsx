import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { useApp, useLoad } from '../../context.jsx';
import Icon from '../../components/Icon.jsx';
import { Modal, Field, MultiUserPicker, Person, Empty, useAsync, confirmDialog } from '../../components/ui.jsx';
import { timeAgo } from '../../lib/format.js';

function AddMembers({ project, onClose, onSaved }) {
  const { meta, activeUsers } = useApp();
  const teams = useLoad(() => api.get('/teams'), []);
  const roles = meta.roles.filter(r => r.scope === 'project');
  const [mode, setMode] = useState('people');
  const [ids, setIds] = useState([]);
  const [teamId, setTeamId] = useState('');
  const [roleId, setRoleId] = useState(roles.find(r => r.name === 'Developer')?.id || roles[0]?.id);
  const [busy, run] = useAsync();
  const existing = new Set(project.members.map(m => m.user_id));
  const save = async () => {
    const body = mode === 'team' ? { team_id: Number(teamId), role_id: roleId } : { user_ids: ids, role_id: roleId };
    const r = await run(() => api.post(`/projects/${project.id}/members`, body));
    if (r) { onSaved(r.added); onClose(); }
  };
  return (
    <Modal title="Add members" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || (mode === 'team' ? !teamId : !ids.length)} onClick={save}>Add</button></>}>
      <div className="subtabs" style={{ alignSelf: 'flex-start' }}>
        <button className={mode === 'people' ? 'active' : ''} onClick={() => setMode('people')}>People</button>
        <button className={mode === 'team' ? 'active' : ''} onClick={() => setMode('team')}>A whole team</button>
      </div>
      {mode === 'people' ? (
        <Field label="People"><MultiUserPicker value={ids} onChange={setIds} users={activeUsers.filter(u => !existing.has(u.id))} /></Field>
      ) : (
        <Field label="Team" hint="Everyone in the team is added. People added later to the team are not added automatically.">
          <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            <option value="">Choose a team</option>{(teams.data || []).map(t => <option key={t.id} value={t.id}>{t.name} ({t.members.length})</option>)}
          </select>
        </Field>
      )}
      <Field label="Role in this project" hint="Roles decide what members can do. Administrators can create custom roles.">
        <select value={roleId} onChange={(e) => setRoleId(Number(e.target.value))}>{roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
      </Field>
      {roles.find(r => r.id === roleId)?.description && <p className="small soft" style={{ margin: 0 }}>{roles.find(r => r.id === roleId).description}</p>}
    </Modal>
  );
}

export default function Members({ project, reloadProject }) {
  const { meta, user, toast } = useApp();
  const [adding, setAdding] = useState(false);
  const [, run] = useAsync();
  const canManage = project.permissions.includes('project.members');
  const roles = meta.roles.filter(r => r.scope === 'project');
  const members = project.members;
  return (
    <div className="content">
      <div className="page-head">
        <div className="grow"><h2>Members</h2><p>People working on {project.name} and what they are allowed to do.</p></div>
        {canManage && <div className="head-actions"><button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" />Add members</button></div>}
      </div>
      <div className="panel">
        {!members.length ? <Empty title="No members yet">Add people or a whole team so they can see and work on this project.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Name</th><th className="hide-sm">Job title</th><th>Role</th><th className="num">Open work</th><th className="hide-sm">Added</th>{canManage && <th />}</tr></thead>
              <tbody>
                {members.map(m => (
                  <tr key={m.id}>
                    <td><Person id={m.user_id} name={m.name} />{m.status === 'locked' && <span className="tag" style={{ marginLeft: 8 }}>Locked</span>}<div className="xs muted" style={{ paddingLeft: 29 }}>{m.email}</div></td>
                    <td className="hide-sm soft">{m.job_title || '—'}</td>
                    <td>
                      {canManage ? (
                        <select value={m.role_id} style={{ width: 'auto', minWidth: 160, height: 30 }} aria-label={`Role for ${m.name}`}
                          onChange={async (e) => { if (await run(() => api.patch(`/projects/${project.id}/members/${m.id}`, { role_id: Number(e.target.value) }), 'Role changed')) reloadProject(); }}>
                          {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                        </select>
                      ) : m.role_name}
                    </td>
                    <td className="num"><Link to={`/projects/${project.identifier}/work-packages?assignee_id=${m.user_id}`}>{m.open_wps}</Link></td>
                    <td className="hide-sm small muted">{timeAgo(m.created_at)}</td>
                    {canManage && (
                      <td className="num">
                        <button className="icon-btn" aria-label={`Remove ${m.name}`} onClick={async () => {
                          if (await confirmDialog({ message: `Remove ${m.name} from ${project.name}? Their work stays assigned to them.${m.user_id === user.id ? ' You may lose access to this project.' : ''}`, confirmLabel: 'Remove', danger: true })) {
                            if (await run(() => api.del(`/projects/${project.id}/members/${m.id}`), 'Member removed')) reloadProject();
                          }
                        }}><Icon name="trash" /></button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {adding && <AddMembers project={project} onClose={() => setAdding(false)} onSaved={(n) => { toast(`${n} member(s) added`); reloadProject(); }} />}
    </div>
  );
}
