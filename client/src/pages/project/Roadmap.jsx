import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../../api.js';
import { useLoad } from '../../context.jsx';
import Icon from '../../components/Icon.jsx';
import { Loading, Empty, Progress, StatusPill, Key, Person, Modal, Field, useAsync, confirmDialog, MoreMenu, TypeLabel } from '../../components/ui.jsx';
import { fmtDate, diffDays, today } from '../../lib/format.js';

export function VersionModal({ project, version, onClose, onSaved }) {
  const [f, setF] = useState({ name: version?.name || '', description: version?.description || '', status: version?.status || 'open', start_date: version?.start_date || '', due_date: version?.due_date || '' });
  const [busy, run] = useAsync();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    const r = await run(() => (version ? api.patch(`/projects/${project.id}/versions/${version.id}`, f) : api.post(`/projects/${project.id}/versions`, f)), version ? 'Version saved' : 'Version created');
    if (r) { onSaved(); onClose(); }
  };
  return (
    <Modal title={version ? `Edit ${version.name}` : 'New version'} onClose={onClose} onSubmit={save} footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>Save</button></>}>
      <div className="form-grid">
        <Field label="Name" hint="e.g. Sprint 8, Release 2.1"><input type="text" value={f.name} onChange={set('name')} required /></Field>
        <Field label="Status">
          <select value={f.status} onChange={set('status')}><option value="open">Open</option><option value="locked">Locked (no new work)</option><option value="closed">Closed</option></select>
        </Field>
        <Field label="Start date"><input type="date" value={f.start_date} onChange={set('start_date')} /></Field>
        <Field label="Due date"><input type="date" value={f.due_date} onChange={set('due_date')} /></Field>
        <Field label="Goal" className="span-2"><textarea rows={2} value={f.description} onChange={set('description')} placeholder="What should be finished in this version?" /></Field>
      </div>
    </Modal>
  );
}

export default function Roadmap({ project, reloadProject }) {
  const [showClosed, setShowClosed] = useState(false);
  const [modal, setModal] = useState(null);
  const [, run] = useAsync();
  const versions = useLoad(() => api.get(`/projects/${project.id}/versions`), [project.id]);
  const wps = useLoad(() => api.get('/work-packages' + qs({ project_id: project.id, status: 'all', limit: 2000, sort: 'type:asc' })), [project.id]);
  const canManage = project.permissions.includes('project.versions');
  if ((versions.loading && !versions.data) || (wps.loading && !wps.data)) return <div className="content"><Loading /></div>;
  const list = (versions.data || []).filter(v => showClosed || v.status !== 'closed');
  const refresh = () => { versions.reload(); reloadProject?.(); };
  return (
    <div className="content">
      <div className="page-head">
        <div className="grow"><h2>Roadmap</h2><p>Releases and sprints, with what is planned in each.</p></div>
        <div className="head-actions">
          <label className="check small"><input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />Show closed versions</label>
          {canManage && <button className="btn primary" onClick={() => setModal({})}><Icon name="plus" />New version</button>}
        </div>
      </div>
      {!list.length ? (
        <div className="panel"><Empty title="No versions yet" action={canManage && <button className="btn primary" onClick={() => setModal({})}><Icon name="plus" />Create a version</button>}>
          Versions group work into releases or sprints, so everyone can see what ships when.
        </Empty></div>
      ) : (
        <div className="stack" style={{ gap: 18 }}>
          {list.map(v => {
            const items = (wps.data?.rows || []).filter(w => w.version_id === v.id);
            const left = v.due_date ? diffDays(v.due_date, today()) : null;
            return (
              <section key={v.id} className="panel">
                <div className="panel-head">
                  <Icon name="flag" size={16} />
                  <h3>{v.name}</h3>
                  {v.status !== 'open' && <span className="tag">{v.status === 'locked' ? 'Locked' : 'Closed'}</span>}
                  <span className="small muted">
                    {v.start_date && `${fmtDate(v.start_date)} to `}{v.due_date ? fmtDate(v.due_date, { year: true }) : 'No due date'}
                    {left != null && v.status !== 'closed' && <span className={left < 0 ? 'danger-text' : left <= 3 ? 'signal-text' : ''}>{left < 0 ? `, ${-left} days late` : left === 0 ? ', due today' : `, ${left} days left`}</span>}
                  </span>
                  <div className="actions">
                    <Link className="btn sm ghost" to={`/projects/${project.identifier}/work-packages?version_id=${v.id}&status=all`}>Open list</Link>
                    {canManage && (
                      <MoreMenu>
                        <button className="menu-item" onClick={() => setModal({ version: v })}><Icon name="edit" size={16} />Edit</button>
                        <button className="menu-item danger" onClick={async () => {
                          if (await confirmDialog({ message: `Delete version ${v.name}? Its work packages stay but lose the version.`, confirmLabel: 'Delete', danger: true })) {
                            await run(() => api.del(`/projects/${project.id}/versions/${v.id}`)); refresh(); wps.reload();
                          }
                        }}><Icon name="trash" size={16} />Delete</button>
                      </MoreMenu>
                    )}
                  </div>
                </div>
                <div className="panel-body stack tight">
                  {v.description && <p className="soft small" style={{ margin: 0 }}>{v.description}</p>}
                  <Progress value={v.progress || 0} color={project.color} />
                  <span className="xs muted">{v.closed} of {v.total} work packages done</span>
                </div>
                {items.length > 0 && (
                  <div style={{ borderTop: '1px solid var(--line-2)' }}>
                    {items.map(w => (
                      <div key={w.id} className="child-row" style={{ paddingLeft: 16 }}>
                        <Key k={w.key} color={project.color} /><TypeLabel name={w.type_name} color={w.type_color} />
                        <Link to={`/wp/${w.id}`} className="ellipsis grow" style={{ color: w.is_closed ? 'var(--ink-3)' : 'var(--ink)', textDecoration: w.is_closed ? 'line-through' : undefined }}>{w.subject}</Link>
                        <span className="hide-sm"><Person id={w.assignee_id} name={w.assignee_name} muted="" /></span>
                        <StatusPill name={w.status_name} color={w.status_color} />
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
      {modal && <VersionModal project={project} version={modal.version} onClose={() => setModal(null)} onSaved={refresh} />}
    </div>
  );
}
