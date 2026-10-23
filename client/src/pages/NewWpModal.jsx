import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, qs } from '../api.js';
import { useApp } from '../context.jsx';
import { Modal, Field, MarkdownEditor, UserSelect, ErrorBox } from '../components/ui.jsx';
import Icon from '../components/Icon.jsx';
import { fmtSize } from '../lib/format.js';

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

export const MAX_FILES = 5;
export const FILE_ACCEPT = '.jpg,.jpeg,.png,.gif,.webp,.heic,.heif,.bmp,.pdf,.zip,image/*,application/pdf,application/zip';
const FILE_OK = /\.(jpe?g|png|gif|webp|heic|heif|bmp|pdf|zip)$/i;
const MAX_MB = 25;

// Pick up to `max` photos / PDF / ZIP files (drag and drop or click)
export function FilePicker({ files, onChange, max = MAX_FILES, onError }) {
  const [over, setOver] = useState(false);
  const add = (list) => {
    const next = [...files];
    for (const f of list) {
      if (!FILE_OK.test(f.name)) { onError?.(`${f.name}: only photos, PDF and ZIP files can be attached.`); continue; }
      if (f.size > MAX_MB * 1024 * 1024) { onError?.(`${f.name} is larger than ${MAX_MB} MB.`); continue; }
      if (next.length >= max) { onError?.(`You can attach at most ${max} files.`); break; }
      next.push(f);
    }
    onChange(next);
  };
  const full = files.length >= max;
  return (
    <div className="stack tight">
      {!full && (
        <label className={`dropzone${over ? ' over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); add([...e.dataTransfer.files]); }}>
          <Icon name="paperclip" size={18} />
          <span><b>Choose files</b> or drop them here<br /><span className="xs muted">Photos, PDF or ZIP, up to {max} files, {MAX_MB} MB each</span></span>
          <input type="file" multiple accept={FILE_ACCEPT} hidden onChange={(e) => { add([...e.target.files]); e.target.value = ''; }} />
        </label>
      )}
      {files.length > 0 && (
        <ul className="file-list">
          {files.map((f, i) => (
            <li key={`${f.name}${i}`}>
              <Icon name={/\.(pdf|zip)$/i.test(f.name) ? 'paperclip' : 'eye'} size={14} />
              <span className="ellipsis grow">{f.name}</span><span className="xs muted">{fmtSize(f.size)}</span>
              <button type="button" className="icon-btn" aria-label={`Remove ${f.name}`} onClick={() => onChange(files.filter((_, j) => j !== i))}><Icon name="x" size={14} /></button>
            </li>
          ))}
          <li className="xs muted">{files.length} of {max} files</li>
        </ul>
      )}
    </div>
  );
}

// Add web links (URL plus optional title)
export function LinkEditor({ links, onChange }) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const add = () => {
    const u = url.trim();
    if (!u) return;
    onChange([...links, { url: /^https?:\/\//i.test(u) ? u : `https://${u}`, title: title.trim() || null }]);
    setUrl(''); setTitle('');
  };
  return (
    <div className="stack tight">
      <div className="row">
        <input type="text" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… (design, document, test build)"
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} style={{ flex: 2 }} aria-label="Link address" />
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)"
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} style={{ flex: 1 }} aria-label="Link title" />
        <button type="button" className="btn" onClick={add} disabled={!url.trim()}><Icon name="plus" />Add link</button>
      </div>
      {links.length > 0 && (
        <ul className="file-list">
          {links.map((l, i) => (
            <li key={i}>
              <Icon name="link" size={14} />
              <span className="ellipsis grow">{l.title ? <><b>{l.title}</b> <span className="muted">{l.url}</span></> : l.url}</span>
              <button type="button" className="icon-btn" aria-label="Remove link" onClick={() => onChange(links.filter((_, j) => j !== i))}><Icon name="x" size={14} /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function NewWpModal({ projectId: fixedProject, defaults = {}, onClose, onCreated, title = 'New task' }) {
  const { meta, projects, user, activeUsers, toast } = useApp();
  const nav = useNavigate();
  const writable = projects.filter(p => !p.archived);
  const [projectId, setProjectId] = useState(fixedProject || defaults.project_id || writable[0]?.id || '');
  const info = useProjectInfo(projectId);
  const defStatus = meta.statuses.find(s => s.is_default)?.id || meta.statuses[0]?.id;
  const defPrio = meta.priorities.find(p => p.is_default)?.id || meta.priorities[0]?.id;
  const taskType = meta.types.find(t => t.name === 'Task')?.id || meta.types[0]?.id;
  const [f, setF] = useState({
    type_id: taskType, subject: '', description: '', status_id: defStatus, priority_id: defPrio,
    assignee_id: null, responsible_id: null, parent_id: null, version_id: '', start_date: '', due_date: '', estimated_hours: '',
    ...defaults,
  });
  const [files, setFiles] = useState([]);
  const [links, setLinks] = useState([]);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k, v) => setF(s => ({ ...s, [k]: v }));
  const perms = new Set(info?.permissions || []);
  const canAssign = perms.has('wp.assign') || perms.has('wp.edit');
  const canUpload = perms.has('files.upload');
  const memberIds = new Set((info?.members || []).map(m => m.user_id));
  const members = activeUsers.filter(u => memberIds.has(u.id));
  const others = activeUsers.filter(u => !memberIds.has(u.id));
  const isMilestone = meta.types.find(t => t.id === Number(f.type_id))?.is_milestone;

  const submit = async (another) => {
    setError(null);
    if (!f.subject.trim()) { setError(new Error('Task headline is required.')); return; }
    const body = { ...f, project_id: projectId, version_id: f.version_id || null, estimated_hours: f.estimated_hours || null, links };
    if (isMilestone) body.start_date = body.due_date;
    setBusy(true);
    let wp;
    try { wp = await api.post('/work-packages', body); }
    catch (e) { setError(e); setBusy(false); return; }
    const failed = [];
    for (const file of files) {
      try { await api.upload(file, 'wp', wp.id); } catch (e) { failed.push(`${file.name}: ${e.message}`); }
    }
    setBusy(false);
    toast(`${wp.key} created${files.length ? ` with ${files.length - failed.length} file(s)` : ''}`);
    if (failed.length) toast(failed.join(' '), 'error');
    onCreated?.(wp);
    if (another) { setF(s => ({ ...s, subject: '', description: '' })); setFiles([]); setLinks([]); }
    else { onClose(); if (!onCreated) nav(`/wp/${wp.id}`); }
  };

  return (
    <Modal title={title} wide onClose={onClose} onSubmit={() => submit(false)} footer={<>
      <span className="xs muted" style={{ marginRight: 'auto' }}>Ctrl + Enter saves</span>
      <button type="button" className="btn" onClick={onClose}>Cancel</button>
      <button type="button" className="btn" disabled={busy} onClick={() => submit(true)}>Create and add another</button>
      <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Create task'}</button>
    </>}>
      <ErrorBox error={error} />
      <div className="form-grid three">
        <Field label="Project">
          <select value={projectId} disabled={!!fixedProject} onChange={(e) => { setProjectId(Number(e.target.value)); set('version_id', ''); set('parent_id', null); }}>
            {writable.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Type">
          <select value={f.type_id} onChange={(e) => set('type_id', Number(e.target.value))}>
            {meta.types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
        <Field label="Priority">
          <select value={f.priority_id} onChange={(e) => set('priority_id', Number(e.target.value))}>
            {meta.priorities.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Task headline">
        <input type="text" value={f.subject} onChange={(e) => set('subject', e.target.value)} placeholder="Short summary, e.g. Add OTP login to the customer app" required
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(false); }} />
      </Field>
      <Field label="Task description">
        <MarkdownEditor value={f.description} onChange={(v) => set('description', v)} rows={5} placeholder="What needs to be done, acceptance criteria, steps to reproduce…" onSubmitShortcut={() => submit(false)} />
      </Field>
      {canUpload && (
        <Field label={`Attach photos, PDF or ZIP (max ${MAX_FILES})`}>
          <FilePicker files={files} onChange={setFiles} onError={(m) => toast(m, 'error')} />
        </Field>
      )}
      <Field label="Links">
        <LinkEditor links={links} onChange={setLinks} />
      </Field>
      <div className="form-grid three">
        <Field label="Assign employee" hint={!canAssign && info ? 'You can assign tasks to yourself only.' : others.length && canAssign ? 'People outside the project are added to it when assigned.' : undefined}>
          {canAssign ? (
            <select value={f.assignee_id ?? ''} onChange={(e) => set('assignee_id', e.target.value ? Number(e.target.value) : null)}>
              <option value="">Unassigned</option>
              <optgroup label="Project members">{members.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</optgroup>
              {others.length > 0 && <optgroup label="Other employees">{others.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</optgroup>}
            </select>
          ) : (
            <select value={f.assignee_id ?? ''} onChange={(e) => set('assignee_id', e.target.value ? Number(e.target.value) : null)}>
              <option value="">Unassigned</option><option value={user.id}>Me</option>
            </select>
          )}
        </Field>
        {!isMilestone && <Field label="Start date"><input type="date" value={f.start_date || ''} onChange={(e) => set('start_date', e.target.value)} /></Field>}
        <Field label={isMilestone ? 'Date' : 'Due date'}><input type="date" value={f.due_date || ''} min={f.start_date || undefined} onChange={(e) => set('due_date', e.target.value)} /></Field>
      </div>
      <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setMore(m => !m)} aria-expanded={more}>
        <Icon name="chevronDown" />{more ? 'Fewer options' : 'More options (status, accountable, version, estimate, parent)'}
      </button>
      {more && (
        <div className="form-grid three">
          <Field label="Status">
            <select value={f.status_id} onChange={(e) => set('status_id', Number(e.target.value))}>
              {meta.statuses.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Accountable">
            {canAssign ? <UserSelect value={f.responsible_id} onChange={(v) => set('responsible_id', v)} placeholder="Nobody" />
              : <select disabled><option>Nobody</option></select>}
          </Field>
          <Field label="Version">
            <select value={f.version_id || ''} onChange={(e) => set('version_id', e.target.value ? Number(e.target.value) : '')}>
              <option value="">None</option>
              {(info?.versions || []).filter(v => v.status === 'open').map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </Field>
          {!isMilestone && <Field label="Estimated hours"><input type="number" min="0" step="0.5" value={f.estimated_hours} onChange={(e) => set('estimated_hours', e.target.value)} /></Field>}
          <Field label="Parent" className="span-2">
            <WpSearchSelect projectId={projectId} value={f.parent_id} onChange={(v) => set('parent_id', v)} placeholder="Optional: put this under a requirement or epic" />
          </Field>
        </div>
      )}
    </Modal>
  );
}
