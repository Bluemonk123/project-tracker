import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, qs } from '../api.js';
import { useApp } from '../context.jsx';
import { Modal, Field, MarkdownEditor, UserSelect, useAsync, ErrorBox } from '../components/ui.jsx';

// Loads members / versions / categories for a project (used by forms)
export function useProjectInfo(projectId) {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    if (!projectId) { setInfo(null); return; }
    let alive = true;
    api.get(`/projects/${projectId}`).then(p => { if (alive) setInfo(p); }).catch(() => alive && setInfo(null));
    return () => { alive = false; };
  }, [projectId]);
  return info;
}

export function WpSearchSelect({ projectId, value, onChange, excludeId, placeholder = 'Search by subject or key' }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [label, setLabel] = useState('');
  useEffect(() => {
    if (value && !label) api.get(`/work-packages/${value}`).then(w => setLabel(`${w.key} ${w.subject}`)).catch(() => {});
  }, [value, label]);
  useEffect(() => {
    if (q.length < 1) { setRows([]); return; }
    const t = setTimeout(() => api.get('/work-packages' + qs({ project_id: projectId, q, status: 'all', limit: 8, sort: 'updated_at:desc' }))
      .then(r => setRows(r.rows.filter(x => x.id !== excludeId))).catch(() => {}), 200);
    return () => clearTimeout(t);
  }, [q, projectId, excludeId]);
  if (value) {
    return (
      <div className="row">
        <span className="ellipsis grow small">{label || `#${value}`}</span>
        <button type="button" className="btn sm ghost" onClick={() => { onChange(null); setLabel(''); }}>Clear</button>
      </div>
    );
  }
  return (
    <div style={{ position: 'relative' }}>
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} />
      {rows.length > 0 && (
        <div className="popover left" style={{ width: '100%' }}>
          {rows.map(r => (
            <button type="button" key={r.id} className="menu-item" onClick={() => { onChange(r.id); setLabel(`${r.key} ${r.subject}`); setQ(''); setRows([]); }}>
              <span className="key" style={{ '--pc': r.project_color }}>{r.key}</span><span className="ellipsis">{r.subject}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function NewWpModal({ projectId: fixedProject, defaults = {}, onClose, onCreated, title = 'New work package' }) {
  const { meta, projects, user } = useApp();
  const nav = useNavigate();
  const writable = projects.filter(p => !p.archived);
  const [projectId, setProjectId] = useState(fixedProject || defaults.project_id || writable[0]?.id || '');
  const info = useProjectInfo(projectId);
  const defStatus = meta.statuses.find(s => s.is_default)?.id || meta.statuses[0]?.id;
  const defPrio = meta.priorities.find(p => p.is_default)?.id || meta.priorities[0]?.id;
  const [f, setF] = useState({
    type_id: meta.types[0]?.id, subject: '', description: '', status_id: defStatus, priority_id: defPrio,
    assignee_id: null, responsible_id: null, parent_id: null, version_id: '', start_date: '', due_date: '', estimated_hours: '',
    ...defaults,
  });
  const [busy, run] = useAsync();
  const [error, setError] = useState(null);
  const set = (k, v) => setF(s => ({ ...s, [k]: v }));
  const perms = new Set(info?.permissions || []);
  const canAssign = perms.has('wp.assign') || perms.has('wp.edit');
  const memberUsers = (info?.members || []).filter(m => m.status === 'active').map(m => ({ id: m.user_id, name: m.name }));
  const isMilestone = meta.types.find(t => t.id === Number(f.type_id))?.is_milestone;

  const submit = async (another) => {
    setError(null);
    if (!f.subject.trim()) { setError(new Error('Subject is required.')); return; }
    const body = { ...f, project_id: projectId, version_id: f.version_id || null, estimated_hours: f.estimated_hours || null };
    if (isMilestone) body.start_date = body.due_date;
    const wp = await run(() => api.post('/work-packages', body), 'Work package created');
    if (!wp) return;
    onCreated?.(wp);
    if (another) setF(s => ({ ...s, subject: '', description: '' }));
    else { onClose(); if (!onCreated) nav(`/wp/${wp.id}`); }
  };

  return (
    <Modal title={title} wide onClose={onClose} onSubmit={() => submit(false)} footer={<>
      <span className="xs muted" style={{ marginRight: 'auto' }}>Ctrl + Enter saves</span>
      <button type="button" className="btn" onClick={onClose}>Cancel</button>
      <button type="button" className="btn" disabled={busy} onClick={() => submit(true)}>Create and add another</button>
      <button className="btn primary" disabled={busy}>Create</button>
    </>}>
      <ErrorBox error={error} />
      <div className="form-grid three">
        {!fixedProject && (
          <Field label="Project">
            <select value={projectId} onChange={(e) => { setProjectId(Number(e.target.value)); set('version_id', ''); set('parent_id', null); }}>
              {writable.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Type">
          <select value={f.type_id} onChange={(e) => set('type_id', Number(e.target.value))}>
            {meta.types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
        <Field label="Status">
          <select value={f.status_id} onChange={(e) => set('status_id', Number(e.target.value))}>
            {meta.statuses.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        {fixedProject && (
          <Field label="Priority">
            <select value={f.priority_id} onChange={(e) => set('priority_id', Number(e.target.value))}>
              {meta.priorities.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
        )}
      </div>
      <Field label="Subject">
        <input type="text" value={f.subject} onChange={(e) => set('subject', e.target.value)} placeholder="What needs to be done?" required
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(false); }} />
      </Field>
      <Field label="Description">
        <MarkdownEditor value={f.description} onChange={(v) => set('description', v)} rows={5} placeholder="Details, acceptance criteria, links…" onSubmitShortcut={() => submit(false)} />
      </Field>
      <div className="form-grid three">
        <Field label="Assignee" hint={!canAssign && info ? 'You can assign work to yourself only.' : undefined}>
          {canAssign ? <UserSelect value={f.assignee_id} onChange={(v) => set('assignee_id', v)} users={memberUsers} />
            : (
              <select value={f.assignee_id ?? ''} onChange={(e) => set('assignee_id', e.target.value ? Number(e.target.value) : null)}>
                <option value="">Unassigned</option><option value={user.id}>Me</option>
              </select>
            )}
        </Field>
        <Field label="Accountable">
          {canAssign ? <UserSelect value={f.responsible_id} onChange={(v) => set('responsible_id', v)} users={memberUsers} placeholder="Nobody" />
            : <select disabled><option>Nobody</option></select>}
        </Field>
        {!fixedProject && (
          <Field label="Priority">
            <select value={f.priority_id} onChange={(e) => set('priority_id', Number(e.target.value))}>
              {meta.priorities.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Version">
          <select value={f.version_id || ''} onChange={(e) => set('version_id', e.target.value ? Number(e.target.value) : '')}>
            <option value="">None</option>
            {(info?.versions || []).filter(v => v.status === 'open').map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </Field>
        {!isMilestone && <Field label="Start date"><input type="date" value={f.start_date || ''} onChange={(e) => set('start_date', e.target.value)} /></Field>}
        <Field label={isMilestone ? 'Date' : 'Finish date'}><input type="date" value={f.due_date || ''} min={f.start_date || undefined} onChange={(e) => set('due_date', e.target.value)} /></Field>
        {!isMilestone && <Field label="Estimated hours"><input type="number" min="0" step="0.5" value={f.estimated_hours} onChange={(e) => set('estimated_hours', e.target.value)} /></Field>}
        <Field label="Parent" className="span-2">
          <WpSearchSelect projectId={projectId} value={f.parent_id} onChange={(v) => set('parent_id', v)} placeholder="Optional: put this under a requirement or epic" />
        </Field>
      </div>
    </Modal>
  );
}
