import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { Modal, Field, ColorPicker, UserSelect, useAsync, COLORS } from '../components/ui.jsx';

const suggestKey = (name) => {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, '').split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  const k = words.length > 1 ? words.map(w => w[0]).join('') : words[0];
  return k.slice(0, 6).replace(/^[0-9]+/, '');
};

export default function NewProjectModal({ onClose }) {
  const { projects, reloadProjects, user } = useApp();
  const nav = useNavigate();
  const [f, setF] = useState({ name: '', identifier: '', description: '', color: COLORS[projects.length % COLORS.length], manager_id: user.id, start_date: '', end_date: '', parent_id: '' });
  const [keyTouched, setKeyTouched] = useState(false);
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
            onChange={(e) => { set('name', e.target.value); if (!keyTouched) set('identifier', suggestKey(e.target.value)); }} />
        </Field>
        <Field label="Short key" hint="2–10 letters. Work items are numbered with it, like CRM-12.">
          <input type="text" value={f.identifier} required maxLength={10} style={{ textTransform: 'uppercase' }}
            onChange={(e) => { setKeyTouched(true); set('identifier', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')); }} />
        </Field>
        <Field label="Project manager"><UserSelect value={f.manager_id} onChange={(v) => set('manager_id', v)} placeholder="Nobody yet" /></Field>
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
