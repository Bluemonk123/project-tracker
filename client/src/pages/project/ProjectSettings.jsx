import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { useApp } from '../../context.jsx';
import Icon from '../../components/Icon.jsx';
import { Field, ColorPicker, UserSelect, useAsync, Modal, confirmDialog } from '../../components/ui.jsx';
import { VersionModal } from './Roadmap.jsx';
import { fmtDate } from '../../lib/format.js';

export default function ProjectSettings({ project, reloadProject }) {
  const { projects, reloadProjects } = useApp();
  const nav = useNavigate();
  const has = (p) => project.permissions.includes(p);
  const [f, setF] = useState({
    name: project.name, identifier: project.identifier, description: project.description || '', color: project.color,
    manager_id: project.manager_id, start_date: project.start_date || '', end_date: project.end_date || '', parent_id: project.parent_id || '',
  });
  const [category, setCategory] = useState('');
  const [modal, setModal] = useState(null);
  const [confirmKey, setConfirmKey] = useState('');
  const [busy, run] = useAsync();
  const set = (k, v) => setF(s => ({ ...s, [k]: v }));
  const save = async (e) => {
    e.preventDefault();
    if (await run(() => api.patch(`/projects/${project.id}`, f), 'Project saved')) {
      await reloadProjects();
      if (f.identifier !== project.identifier) nav(`/projects/${f.identifier}/settings`, { replace: true }); else reloadProject();
    }
  };
  const archive = async (archived) => {
    if (archived && !await confirmDialog({ message: `Archive ${project.name}? It disappears from lists but nothing is deleted. You can restore it from Projects, Archived.`, confirmLabel: 'Archive' })) return;
    if (await run(() => api.post(`/projects/${project.id}/archive`, { archived }), archived ? 'Project archived' : 'Project restored')) { await reloadProjects(); reloadProject(); }
  };
  return (
    <div className="content" style={{ maxWidth: 980 }}>
      {has('project.edit') && (
        <form className="panel" style={{ marginBottom: 20 }} onSubmit={save}>
          <div className="panel-head"><h3>Project details</h3></div>
          <div className="panel-body form-grid">
            <Field label="Name"><input type="text" value={f.name} onChange={(e) => set('name', e.target.value)} required /></Field>
            <Field label="Short key" hint="Changing it renames every work package ID, e.g. CRM-12."><input type="text" value={f.identifier} maxLength={10} onChange={(e) => set('identifier', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} required /></Field>
            <Field label="Project manager"><UserSelect value={f.manager_id} onChange={(v) => set('manager_id', v)} placeholder="Nobody" /></Field>
            <Field label="Part of">
              <select value={f.parent_id} onChange={(e) => set('parent_id', e.target.value)}>
                <option value="">None</option>{projects.filter(p => p.id !== project.id).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Start date"><input type="date" value={f.start_date} onChange={(e) => set('start_date', e.target.value)} /></Field>
            <Field label="Target end date"><input type="date" value={f.end_date} onChange={(e) => set('end_date', e.target.value)} /></Field>
            <Field label="Colour" className="span-2"><ColorPicker value={f.color} onChange={(v) => set('color', v)} /></Field>
            <Field label="Description" className="span-2" hint="Markdown works here."><textarea rows={5} value={f.description} onChange={(e) => set('description', e.target.value)} /></Field>
          </div>
          <div className="modal-foot"><button className="btn primary" disabled={busy}>Save changes</button></div>
        </form>
      )}

      {has('project.versions') && (
        <div className="grid-2" style={{ marginBottom: 20 }}>
          <section className="panel">
            <div className="panel-head"><h3>Versions</h3><div className="actions"><button className="btn sm" onClick={() => setModal({})}><Icon name="plus" />New</button></div></div>
            <ul className="list">
              {project.versions.map(v => (
                <li key={v.id}>
                  <span className="grow"><b>{v.name}</b> <span className="xs muted">{v.status}{v.due_date ? `, due ${fmtDate(v.due_date)}` : ''}</span></span>
                  <button className="btn sm ghost" onClick={() => setModal({ version: v })}>Edit</button>
                </li>
              ))}
              {!project.versions.length && <li className="small muted">No versions yet.</li>}
            </ul>
          </section>
          <section className="panel">
            <div className="panel-head"><h3>Categories</h3><div className="actions"><span className="xs muted">e.g. Frontend, Backend, Database</span></div></div>
            <ul className="list">
              {project.categories.map(c => (
                <li key={c.id}><span className="grow">{c.name}</span>
                  <button className="icon-btn" aria-label={`Delete ${c.name}`} onClick={async () => { if (await run(() => api.del(`/projects/${project.id}/categories/${c.id}`))) reloadProject(); }}><Icon name="trash" /></button>
                </li>
              ))}
              <li>
                <form className="row grow" onSubmit={async (e) => { e.preventDefault(); if (category.trim() && await run(() => api.post(`/projects/${project.id}/categories`, { name: category }))) { setCategory(''); reloadProject(); } }}>
                  <input type="text" placeholder="New category" value={category} onChange={(e) => setCategory(e.target.value)} />
                  <button className="btn" disabled={!category.trim()}>Add</button>
                </form>
              </li>
            </ul>
          </section>
        </div>
      )}

      {has('project.archive') && (
        <section className="panel" style={{ borderColor: 'color-mix(in srgb, var(--danger) 35%, var(--line))' }}>
          <div className="panel-head"><h3>Archive or delete</h3></div>
          <div className="panel-body stack">
            <div className="row wrap">
              <div className="grow"><b>{project.archived ? 'Restore this project' : 'Archive this project'}</b><div className="small soft">{project.archived ? 'Bring it back to the active project lists.' : 'Hide a finished application from lists. Everything is kept.'}</div></div>
              <button className="btn" onClick={() => archive(!project.archived)}><Icon name="archive" />{project.archived ? 'Restore' : 'Archive'}</button>
            </div>
            <div className="row wrap">
              <div className="grow"><b>Delete permanently</b><div className="small soft">Removes the project with all its work packages, meetings, time entries and wiki pages. This cannot be undone.</div></div>
              <button className="btn danger" onClick={() => setModal('delete')}><Icon name="trash" />Delete project</button>
            </div>
          </div>
        </section>
      )}
      {modal === 'delete' && (
        <Modal title={`Delete ${project.name}?`} onClose={() => setModal(null)} footer={<>
          <button className="btn" onClick={() => setModal(null)}>Cancel</button>
          <button className="btn danger solid" disabled={confirmKey !== project.identifier || busy} onClick={async () => {
            if (await run(() => api.del(`/projects/${project.id}`, { confirm: confirmKey }), 'Project deleted')) { await reloadProjects(); nav('/projects'); }
          }}>Delete for ever</button>
        </>}>
          <div className="warn-box">Consider archiving instead. Deleting removes everything in this project for every user.</div>
          <Field label={`Type ${project.identifier} to confirm`}><input type="text" value={confirmKey} onChange={(e) => setConfirmKey(e.target.value.toUpperCase())} /></Field>
        </Modal>
      )}
      {modal && modal !== 'delete' && <VersionModal project={project} version={modal.version} onClose={() => setModal(null)} onSaved={reloadProject} />}
    </div>
  );
}
