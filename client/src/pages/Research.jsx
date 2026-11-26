// Research: requirements and research. "Add Requirement" opens the form; the table lists what is already added,
// with filters. Clicking a row opens the requirement on the right: details, solution and reference files, notes.
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, qs } from '../api.js';
import { useApp, useLoad } from '../context.jsx';
import Icon from '../components/Icon.jsx';
import { Loading, ErrorBox, Empty, Modal, Field, UserSelect, Avatar, useAsync, confirmDialog } from '../components/ui.jsx';
import { fmtDate, fmtDateTime, timeAgo } from '../lib/format.js';

const STAGES = { new: 'New', design: 'In Design', develop: 'In Develop', testing: 'In Testing', closed: 'Closed', rejected: 'Rejected' };
const STAGE_COLOR = { new: '#3B6EA8', design: '#7A4FA3', develop: '#C98A1B', testing: '#2E8A9A', closed: '#33B014', rejected: '#8A94A6' };
const ACCEPT = '.jpg,.jpeg,.png,.gif,.webp,.heic,.heif,.bmp,.svg,.pdf,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.md,.eml,.msg';
const size = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

const StagePill = ({ stage }) => <span className="kb-type-pill" style={{ '--c': STAGE_COLOR[stage] || '#5B6472' }}>{STAGES[stage] || stage}</span>;
const Who = ({ id, name }) => (name ? <span className="row" style={{ gap: 6 }}><Avatar id={id} name={name} size={20} />{name}</span> : <span className="muted">—</span>);

async function uploadFiles(id, kind, files) {
  for (let i = 0; i < files.length; i += 10) {
    const fd = new FormData();
    fd.append('kind', kind);
    files.slice(i, i + 10).forEach(f => fd.append('files', f));
    await api.post(`/research/${id}/files`, fd);
  }
}

function FilePick({ label, hint, files, onChange }) {
  const input = useRef(null);
  return (
    <Field label={label} hint={hint}>
      <div className="stack" style={{ gap: 6 }}>
        <div><button type="button" className="btn sm" onClick={() => input.current?.click()}><Icon name="paperclip" size={14} />Add files</button></div>
        <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={(e) => { onChange([...files, ...e.target.files]); e.target.value = ''; }} />
        {files.length > 0 && (
          <ul className="rs-files">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`}><Icon name="paperclip" size={13} /><span className="ellipsis">{f.name}</span><span className="xs muted">{size(f.size)}</span>
                <button type="button" className="icon-btn sm" aria-label={`Remove ${f.name}`} onClick={() => onChange(files.filter((_, j) => j !== i))}>×</button></li>
            ))}
          </ul>
        )}
      </div>
    </Field>
  );
}

function AddModal({ onClose, onDone }) {
  const { me } = useApp();
  const [f, setF] = useState({ title: '', description: '', stage: 'new', assignee_id: null, requestor_id: me?.user?.id ?? null, reviewer_id: null });
  const [solution, setSolution] = useState([]);
  const [reference, setReference] = useState([]);
  const [busy, run] = useAsync();
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const save = async () => {
    const r = await run(async () => {
      const it = await api.post('/research', f);
      if (solution.length) await uploadFiles(it.id, 'solution', solution);
      if (reference.length) await uploadFiles(it.id, 'reference', reference);
      return it;
    }, 'Requirement added');
    if (r) onDone(r.id);
  };
  return (
    <Modal title="Add Requirement" wide onClose={onClose} onSubmit={save}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Add Requirement'}</button></>}>
      <Field label="Requirement title"><input type="text" value={f.title} onChange={(e) => set('title', e.target.value)} required maxLength={200} autoFocus /></Field>
      <Field label="Requirement description"><textarea rows={5} value={f.description} onChange={(e) => set('description', e.target.value)} maxLength={20000} /></Field>
      <div className="grid-2">
        <FilePick label="Solution attachments" hint="The proposed solution: documents, designs, screenshots." files={solution} onChange={setSolution} />
        <FilePick label="Reference attachments" hint="Material it is based on: examples, emails, specs." files={reference} onChange={setReference} />
      </div>
      <div className="grid-2">
        <Field label="Current stage"><select value={f.stage} onChange={(e) => set('stage', e.target.value)}>{Object.entries(STAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Assignee"><UserSelect value={f.assignee_id} onChange={(v) => set('assignee_id', v)} /></Field>
        <Field label="Requestor"><UserSelect value={f.requestor_id} onChange={(v) => set('requestor_id', v)} placeholder="—" /></Field>
        <Field label="Reviewer"><UserSelect value={f.reviewer_id} onChange={(v) => set('reviewer_id', v)} placeholder="—" /></Field>
      </div>
      <p className="xs muted" style={{ margin: 0 }}>Notes can be added by anyone once the requirement is saved. Files: images, PDF, Office, CSV, text, email or ZIP.</p>
    </Modal>
  );
}

function Detail({ id, onClose, onChanged }) {
  const { data, error, loading, reload } = useLoad(() => api.get(`/research/${id}`), [id]);
  const [busy, run] = useAsync();
  const [note, setNote] = useState('');
  const [edit, setEdit] = useState(null);
  useEffect(() => { setEdit(null); setNote(''); }, [id]);
  if (error) return <div className="rs-drawer-body"><ErrorBox error={error} /></div>;
  if (loading && !data) return <div className="rs-drawer-body"><Loading /></div>;
  const it = data;
  const done = () => { reload(); onChanged(); };
  const patch = async (body, msg = 'Saved') => { if (await run(() => api.patch(`/research/${it.id}`, body), msg)) done(); };
  const addFiles = async (kind, list) => { if (list.length && await run(() => uploadFiles(it.id, kind, [...list]), `${list.length} file${list.length > 1 ? 's' : ''} added`)) done(); };
  const delFile = async (f) => { if (await confirmDialog({ message: `Remove ${f.filename}?`, confirmLabel: 'Remove', danger: true }) && await run(() => api.del(`/research-files/${f.id}`), 'File removed')) done(); };
  const addNote = async (e) => { e.preventDefault(); if (note.trim() && await run(() => api.post(`/research/${it.id}/notes`, { body: note }), 'Note added')) { setNote(''); done(); } };
  const delNote = async (n) => { if (await confirmDialog({ message: 'Delete this note?', confirmLabel: 'Delete', danger: true }) && await run(() => api.del(`/research-notes/${n.id}`), 'Note deleted')) done(); };
  const remove = async () => { if (await confirmDialog({ message: `Delete ${it.code} “${it.title}” with its files and notes? This cannot be undone.`, confirmLabel: 'Delete', danger: true }) && await run(() => api.del(`/research/${it.id}`), 'Requirement deleted')) { onChanged(); onClose(); } };
  const ro = !it.can_edit;
  const files = (kind) => it.files.filter(f => f.kind === kind);
  const FileList = ({ kind, title }) => (
    <section className="rs-sec">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h4>{title} <span className="xs muted">({files(kind).length})</span></h4>
        {!ro && <label className="btn sm"><Icon name="paperclip" size={14} />Add files<input type="file" multiple accept={ACCEPT} hidden onChange={(e) => { addFiles(kind, e.target.files); e.target.value = ''; }} /></label>}
      </div>
      {files(kind).length ? (
        <ul className="rs-files">
          {files(kind).map(f => (
            <li key={f.id}><Icon name="paperclip" size={13} />
              <a className="ellipsis" href={`/api/research-files/${f.id}/download`} title={`Added by ${f.uploaded_by_name || '—'} · ${fmtDateTime(f.created_at)}`}>{f.filename}</a>
              <span className="xs muted">{size(f.size)}</span>
              {f.can_delete && <button type="button" className="icon-btn sm" aria-label={`Remove ${f.filename}`} onClick={() => delFile(f)}>×</button>}
            </li>
          ))}
        </ul>
      ) : <p className="xs muted" style={{ margin: 0 }}>No files yet.</p>}
    </section>
  );
  return (
    <>
      <div className="rs-drawer-head">
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: 8 }}><span className="sp-code">{it.code}</span><StagePill stage={it.stage} /></div>
          {edit ? null : <h2 className="rs-title">{it.title}</h2>}
        </div>
        {!ro && !edit && <button type="button" className="btn sm" onClick={() => setEdit({ title: it.title, description: it.description || '' })}>Edit</button>}
        {it.can_delete && <button type="button" className="icon-btn" aria-label="Delete requirement" title="Delete" onClick={remove}><Icon name="trash" size={16} /></button>}
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="x" size={18} /></button>
      </div>
      <div className="rs-drawer-body">
        {edit ? (
          <form className="stack" onSubmit={async (e) => { e.preventDefault(); await patch(edit); setEdit(null); }}>
            <Field label="Requirement title"><input type="text" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} required maxLength={200} /></Field>
            <Field label="Requirement description"><textarea rows={7} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
            <div className="row" style={{ gap: 8 }}><button className="btn primary sm" disabled={busy}>Save</button><button type="button" className="btn sm" onClick={() => setEdit(null)}>Cancel</button></div>
          </form>
        ) : (
          <div className="rs-desc">{it.description || <span className="muted">No description.</span>}</div>
        )}
        <div className="rs-fields">
          <Field label="Current stage"><select value={it.stage} disabled={ro || busy} onChange={(e) => patch({ stage: e.target.value }, `Moved to ${STAGES[e.target.value]}`)}>{Object.entries(STAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Assignee"><UserSelect value={it.assignee_id} disabled={ro || busy} onChange={(v) => patch({ assignee_id: v })} /></Field>
          <Field label="Requestor"><UserSelect value={it.requestor_id} disabled={ro || busy} onChange={(v) => patch({ requestor_id: v })} placeholder="—" /></Field>
          <Field label="Reviewer"><UserSelect value={it.reviewer_id} disabled={ro || busy} onChange={(v) => patch({ reviewer_id: v })} placeholder="—" /></Field>
        </div>
        {ro && <p className="xs muted" style={{ margin: 0 }}>Only the assignee, requestor, reviewer, the person who added it or an administrator can change this requirement. Anyone can add a note.</p>}
        <FileList kind="solution" title="Solution attachments" />
        <FileList kind="reference" title="Reference attachments" />
        <section className="rs-sec">
          <h4>Notes <span className="xs muted">({it.notes_list.length})</span></h4>
          {it.notes_list.map(n => (
            <div key={n.id} className="rs-note">
              <Avatar id={n.user_id} name={n.user_name || '?'} size={24} />
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="xs"><b>{n.user_name || 'Someone'}</b> <span className="muted" title={fmtDateTime(n.created_at)}>{timeAgo(n.created_at)}</span>
                  {n.can_delete && <button type="button" className="link-btn xs" onClick={() => delNote(n)}>Delete</button>}</div>
                <div className="rs-note-body">{n.body}</div>
              </div>
            </div>
          ))}
          <form className="stack" style={{ gap: 6 }} onSubmit={addNote}>
            <textarea rows={3} placeholder="Add a note…" value={note} onChange={(e) => setNote(e.target.value)} maxLength={5000} />
            <div><button className="btn sm primary" disabled={busy || !note.trim()}>Add note</button></div>
          </form>
        </section>
        <p className="xs muted" style={{ margin: 0 }}>Added by {it.created_by_name || '—'} on {fmtDate(it.created_at, { year: true })} · updated {timeAgo(it.updated_at)}</p>
      </div>
    </>
  );
}

export default function Research() {
  const { activeUsers } = useApp();
  const [sp, setSp] = useSearchParams();
  const [adding, setAdding] = useState(false);
  const f = { q: sp.get('q') || '', stage: sp.get('stage') || '', assignee_id: sp.get('assignee') || '', requestor_id: sp.get('requestor') || '', reviewer_id: sp.get('reviewer') || '', open: sp.get('open') || '' };
  const setParam = (k, v) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  const { data, error, loading, reload } = useLoad(() => api.get('/research' + qs({ q: f.q || undefined, stage: f.stage || undefined, assignee_id: f.assignee_id || undefined,
    requestor_id: f.requestor_id || undefined, reviewer_id: f.reviewer_id || undefined, open: f.open || undefined })), [sp.toString().replace(/(^|&)item=\d+/, '')]);
  const open = sp.get('item');
  const filtered = ['q', 'stage', 'assignee', 'requestor', 'reviewer', 'open'].some(k => sp.get(k));
  const people = (k, label) => (
    <select value={f[k]} onChange={(e) => setParam(k.replace('_id', ''), e.target.value)} aria-label={label}>
      <option value="">{label}</option><option value="me">Me</option><option value="none">Not set</option>
      {activeUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
    </select>
  );
  return (
    <div className="content wide">
      <div className="page-head row wrap" style={{ marginBottom: 12 }}>
        <div>
          <h1 style={{ margin: 0 }}>Research</h1>
          <p className="small muted" style={{ margin: '4px 0 0' }}>Requirements and research: what is needed, the proposed solution, reference material and notes.</p>
        </div>
        <span className="spacer" />
        <button type="button" className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" />Add Requirement</button>
      </div>
      <div className="filterbar" role="group" aria-label="Filters">
        <input type="search" placeholder="Title, description or R-number" defaultValue={f.q} key={f.q} aria-label="Find"
          onKeyDown={(e) => { if (e.key === 'Enter') setParam('q', e.target.value.trim()); }} onBlur={(e) => { if (e.target.value.trim() !== f.q) setParam('q', e.target.value.trim()); }} />
        <select value={f.stage} onChange={(e) => setParam('stage', e.target.value)} aria-label="Stage">
          <option value="">Stage</option>{Object.entries(STAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {people('assignee_id', 'Assignee')}
        {people('requestor_id', 'Requestor')}
        {people('reviewer_id', 'Reviewer')}
        <select value={f.open} onChange={(e) => setParam('open', e.target.value)} aria-label="Open or all">
          <option value="">Any stage</option><option value="1">Open only (not Closed / Rejected)</option>
        </select>
        {filtered && <button type="button" className="btn sm ghost" onClick={() => setSp(open ? { item: open } : {}, { replace: true })}>Reset</button>}
      </div>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : (
        <section className="panel">
          {!data.items.length ? (
            <Empty title={filtered ? 'Nothing matches the filters' : 'No requirements yet'}>{filtered ? 'Change or reset the filters.' : 'Use Add Requirement to capture the first one.'}</Empty>
          ) : (
            <div className="table-wrap">
              <table className="table rs-table">
                <thead><tr><th>ID</th><th>Requirement title</th><th>Stage</th><th>Assignee</th><th>Requestor</th><th>Reviewer</th>
                  <th className="num" title="Solution / reference attachments">Files</th><th className="num">Notes</th><th>Updated</th></tr></thead>
                <tbody>
                  {data.items.map(it => (
                    <tr key={it.id} className={String(it.id) === open ? 'selected' : ''} tabIndex={0} role="link" style={{ cursor: 'pointer' }}
                      onClick={() => setParam('item', String(it.id))} onKeyDown={(e) => { if (e.key === 'Enter') setParam('item', String(it.id)); }}>
                      <td><span className="sp-code">{it.code}</span></td>
                      <td><div className="rs-row-title">{it.title}</div>{it.description && <div className="xs muted ellipsis" style={{ maxWidth: 520 }}>{it.description}</div>}</td>
                      <td><StagePill stage={it.stage} /></td>
                      <td className="small"><Who id={it.assignee_id} name={it.assignee_name} /></td>
                      <td className="small"><Who id={it.requestor_id} name={it.requestor_name} /></td>
                      <td className="small"><Who id={it.reviewer_id} name={it.reviewer_name} /></td>
                      <td className="num small" title={`${it.solution_files} solution, ${it.reference_files} reference`}>{it.solution_files} / {it.reference_files}</td>
                      <td className="num small">{it.notes || <span className="muted">0</span>}</td>
                      <td className="small muted" title={fmtDateTime(it.updated_at)}>{timeAgo(it.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {open && (
        <div className="tk-drawer-wrap" onMouseDown={(e) => { if (e.target === e.currentTarget) setParam('item', ''); }}>
          <div className="tk-drawer rs-drawer" role="dialog" aria-label="Requirement">
            <Detail id={open} onClose={() => setParam('item', '')} onChanged={reload} />
          </div>
        </div>
      )}
      {adding && <AddModal onClose={() => setAdding(false)} onDone={(id) => { setAdding(false); reload(); setParam('item', String(id)); }} />}
    </div>
  );
}
