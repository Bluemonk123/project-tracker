import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useApp, useLoad } from '../context.jsx';
import Icon from '../components/Icon.jsx';
import { Loading, ErrorBox, Empty, Modal, Field, MultiUserPicker, UserSelect, Person, useAsync, confirmDialog, MoreMenu } from '../components/ui.jsx';
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

export default function Teams() {
  const { can } = useApp();
  const { data, error, loading, reload } = useLoad(() => api.get('/teams'), []);
  const [modal, setModal] = useState(null);
  const [view, setView] = useState(null);
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
        <div className="grid-3">
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
              <ul className="list">
                {t.members.map(m => (
                  <li key={m.id}>
                    <Person id={m.id} name={m.name} />
                    {m.id === t.lead_id && <span className="tag accent">Lead</span>}
                    <span className="spacer" /><span className="xs muted ellipsis">{m.job_title}</span>
                  </li>
                ))}
                {!t.members.length && <li className="small muted">No members.</li>}
              </ul>
            </section>
          ))}
        </div>
      )}
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
