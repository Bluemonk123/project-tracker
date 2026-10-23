import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { Modal, Field, ColorPicker, UserSelect, MultiUserPicker, useAsync, COLORS } from '../components/ui.jsx';

export default function NewProjectModal({ onClose }) {
  const { projects, reloadProjects, user } = useApp();
  const nav = useNavigate();
  const [f, setF] = useState({ name: '', description: '', color: COLORS[projects.length % COLORS.length], manager_id: user.id, am_id: null, ba_id: null, dt_ids: [], start_date: '', end_date: '', parent_id: '' });
  const [busy, run] = useAsync();
  const set = (k, v) => setF(s => ({ ...s, [k]: v }));
  const submit = async () => {
    const r = await run(() => api.post('/projects', f), 'Project created');
    if (r) { await reloadProjects(); onClose(); nav(`/projects/${r.identifier}`); }
  };
  return (
    <Modal title="New project" onClose={onClose} onSubmit={submit} footer={<>
      <button type="button" className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy}>Create project</button>
    </>}>
      <div className="form-grid">
        <Field label="Project name" className="span-2">
          <input type="text" value={f.name} required placeholder="e.g. Customer Portal"
            onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Project Manager (PM)"><UserSelect value={f.manager_id} onChange={(v) => set('manager_id', v)} placeholder="Not mapped yet" /></Field>
        <Field label="Account Manager (AM)"><UserSelect value={f.am_id} onChange={(v) => set('am_id', v)} placeholder="Not mapped yet" /></Field>
        <Field label="Business Analyst (BA)"><UserSelect value={f.ba_id} onChange={(v) => set('ba_id', v)} placeholder="Not mapped yet" /></Field>
        <Field label="Development Team (DT)" className="span-2" hint="You can also map or change these later from the project's overview."><MultiUserPicker value={f.dt_ids} onChange={(v) => set('dt_ids', v)} /></Field>
        <Field label="Start date"><input type="date" value={f.start_date} onChange={(e) => set('start_date', e.target.value)} /></Field>
        <Field label="Target end date"><input type="date" value={f.end_date} min={f.start_date || undefined} onChange={(e) => set('end_date', e.target.value)} /></Field>
        <Field label="Part of" hint="Optional parent project, e.g. a product family.">
          <select value={f.parent_id} onChange={(e) => set('parent_id', e.target.value)}>
            <option value="">None</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Colour"><ColorPicker value={f.color} onChange={(v) => set('color', v)} /></Field>
        <Field label="Description" className="span-2"><textarea rows={3} value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="What is this application for, and who uses it?" /></Field>
      </div>
    </Modal>
  );
}
