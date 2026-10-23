import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useApp, useLoad } from '../context.jsx';
import Icon from '../components/Icon.jsx';
import {
  Loading, ErrorBox, StatusPill, TypeLabel, Due, Person, Key, Progress, Avatar, Markdown, MarkdownEditor,
  UserSelect, useAsync, confirmDialog, MoreMenu, Modal, Field,
} from '../components/ui.jsx';
import NewWpModal, { useProjectInfo, WpSearchSelect, LinkEditor, FILE_ACCEPT } from './NewWpModal.jsx';
import { LogTimeModal } from './Time.jsx';
import { fmtDate, fmtDateTime, fmtHours, fmtSize, timeAgo } from '../lib/format.js';

const FIELD_LABELS = {
  type_id: 'Type', subject: 'Subject', description: 'Description', status_id: 'Status', priority_id: 'Priority',
  assignee_id: 'Assignee', responsible_id: 'Accountable', parent_id: 'Parent', version_id: 'Version', category_id: 'Category',
  start_date: 'Start date', due_date: 'Due date', estimated_hours: 'Estimated hours', done_ratio: '% done', project_id: 'Project',
  relation_added: 'Relation', attachment: 'File', link_added: 'Link',
};
const REL_LABEL = {
  out: { relates: 'Related to', blocks: 'Blocks', precedes: 'Precedes', duplicates: 'Duplicates' },
  in: { relates: 'Related to', blocks: 'Blocked by', precedes: 'Follows', duplicates: 'Duplicated by' },
};

function useLabeler(info) {
  const { meta, userById, projects } = useApp();
  return (field, v) => {
    if (v === null || v === undefined || v === '') return '(empty)';
    switch (field) {
      case 'type_id': return meta.types.find(t => t.id === v)?.name ?? v;
      case 'status_id': return meta.statuses.find(t => t.id === v)?.name ?? v;
      case 'priority_id': return meta.priorities.find(t => t.id === v)?.name ?? v;
      case 'assignee_id': case 'responsible_id': return userById(v)?.name ?? `user ${v}`;
      case 'version_id': return info?.versions.find(x => x.id === v)?.name ?? `version ${v}`;
      case 'category_id': return info?.categories.find(x => x.id === v)?.name ?? `category ${v}`;
      case 'parent_id': return `#${v}`;
      case 'project_id': return projects.find(p => p.id === v)?.name ?? `project ${v}`;
      case 'start_date': case 'due_date': return fmtDate(v, { year: true });
      case 'done_ratio': return `${v}%`;
      case 'estimated_hours': return fmtHours(v);
      default: return String(v);
    }
  };
}

function Journal({ j, label, canEditOwn, onSaved }) {
  const { user } = useApp();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(j.notes || '');
  const [busy, run] = useAsync();
  let changes = {};
  try { changes = JSON.parse(j.changes || '{}') || {}; } catch { changes = {}; }
  const created = changes.created;
  const save = async () => { if (await run(() => api.patch(`/journals/${j.id}`, { notes: text }))) { setEditing(false); onSaved(); } };
  return (
    <div className="journal" id={`j${j.id}`}>
      <Avatar id={j.user_id} name={j.user_name || 'Someone'} size="sm" />
      <div className="body">
        <div className="meta"><b>{j.user_name || 'Someone'}</b> {created ? 'created this work package' : j.notes && !Object.keys(changes).length ? 'commented' : 'made changes'} <span title={fmtDateTime(j.created_at)}>{timeAgo(j.created_at)}</span>
          {canEditOwn && j.user_id === user.id && j.notes && !editing && <button className="btn sm ghost" style={{ height: 22, marginLeft: 6 }} onClick={() => setEditing(true)}>Edit</button>}
        </div>
        {!created && Object.keys(changes).length > 0 && (
          <ul className="changes">
            {Object.entries(changes).map(([k, [from, to]]) => (
              <li key={k}>
                {k === 'description' ? <><b>Description</b> updated</>
                  : k === 'relation_added' ? <>Added relation <b>{to}</b></>
                  : k === 'attachment' ? <>Attached <b>{to}</b></>
                  : k === 'link_added' ? <>Added link <b>{to}</b></>
                  : <><b>{FIELD_LABELS[k] || k}</b> {from == null ? 'set to' : <>changed from {label(k, from)} to</>} <b>{label(k, to)}</b></>}
              </li>
            ))}
          </ul>
        )}
        {j.notes && (editing ? (
          <div className="stack tight" style={{ marginTop: 6 }}>
            <MarkdownEditor value={text} onChange={setText} rows={3} />
            <div className="row"><button className="btn sm primary" disabled={busy} onClick={save}>Save</button><button className="btn sm" onClick={() => setEditing(false)}>Cancel</button></div>
          </div>
        ) : <div className="comment"><Markdown text={j.notes} /></div>)}
      </div>
    </div>
  );
}

function AddRelation({ wp, onDone, onClose }) {
  const [type, setType] = useState('relates');
  const [to, setTo] = useState(null);
  const [busy, run] = useAsync();
  const save = async () => { if (await run(() => api.post(`/work-packages/${wp.id}/relations`, { to_id: to, type }), 'Relation added')) { onDone(); onClose(); } };
  return (
    <Modal title="Add relation" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!to || busy} onClick={save}>Add relation</button></>}>
      <Field label="This work package">
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="relates">is related to</option><option value="blocks">blocks</option><option value="blocked_by">is blocked by</option>
          <option value="precedes">precedes (must finish before)</option><option value="follows">follows (starts after)</option><option value="duplicates">duplicates</option>
        </select>
      </Field>
      <Field label="Other work package"><WpSearchSelect value={to} onChange={setTo} excludeId={wp.id} /></Field>
    </Modal>
  );
}

function MoveModal({ wp, onClose, onDone }) {
  const { projects } = useApp();
  const [pid, setPid] = useState('');
  const [busy, run] = useAsync();
  const save = async () => { const r = await run(() => api.patch(`/work-packages/${wp.id}`, { project_id: Number(pid) }), 'Moved'); if (r) { onDone(r); onClose(); } };
  return (
    <Modal title={`Move ${wp.key} to another project`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!pid || busy} onClick={save}>Move</button></>}>
      <p className="soft small" style={{ margin: 0 }}>The work package gets a new ID in the target project. Version and category are cleared.</p>
      <Field label="Target project">
        <select value={pid} onChange={(e) => setPid(e.target.value)}>
          <option value="">Choose a project</option>
          {projects.filter(p => p.id !== wp.project_id).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </Field>
    </Modal>
  );
}

export default function WpDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { meta, user, toast } = useApp();
  const { data: wp, error, loading, reload, setData } = useLoad(() => api.get(`/work-packages/${id}`), [id]);
  const info = useProjectInfo(wp?.project_id);
  const label = useLabeler(info);
  const [subject, setSubject] = useState('');
  const [editingDesc, setEditingDesc] = useState(false);
  const [desc, setDesc] = useState('');
  const [comment, setComment] = useState('');
  const [modal, setModal] = useState(null);
  const [busy, run] = useAsync();
  useEffect(() => { if (wp) { setSubject(wp.subject); setDesc(wp.description || ''); } }, [wp]);
  useEffect(() => { if (wp) document.title = `${wp.key} ${wp.subject}`; }, [wp]);

  if (loading && !wp) return <div className="content"><Loading /></div>;
  if (error) return <div className="content"><ErrorBox error={error} /></div>;
  if (!wp) return null;

  const can = wp.can;
  const members = (info?.members || []).filter(m => m.status === 'active').map(m => ({ id: m.user_id, name: m.name }));
  const update = async (changes, msg) => {
    const r = await run(() => api.patch(`/work-packages/${wp.id}`, changes), msg);
    if (r) reload();
    return r;
  };
  const saveSubject = () => { if (subject.trim() && subject !== wp.subject) update({ subject }); else setSubject(wp.subject); };
  const postComment = async () => {
    if (!comment.trim()) return;
    if (await run(() => api.post(`/work-packages/${wp.id}/comments`, { notes: comment }))) { setComment(''); reload(); }
  };
  const del = async () => {
    if (!await confirmDialog({ title: `Delete ${wp.key}?`, message: `“${wp.subject}” and its comments and time links will be removed. Child items stay but lose their parent.`, confirmLabel: 'Delete', danger: true })) return;
    if (await run(() => api.del(`/work-packages/${wp.id}`), 'Work package deleted')) nav(`/projects/${wp.project_identifier}/work-packages`);
  };
  const toggleWatch = async () => {
    if (wp.watching) await run(() => api.del(`/work-packages/${wp.id}/watchers/${user.id}`));
    else await run(() => api.post(`/work-packages/${wp.id}/watchers`, {}));
    reload();
  };
  const upload = async (files) => {
    for (const f of files) await run(() => api.upload(f, 'wp', wp.id), `Uploaded ${f.name}`);
    reload();
  };
  const sel = (field, list, opts = {}) => (
    <select value={wp[field] ?? ''} disabled={!can.edit || busy || (opts.assign && !can.assign)} aria-label={FIELD_LABELS[field]}
      onChange={(e) => update({ [field]: e.target.value === '' ? null : Number(e.target.value) })}>
      {opts.empty && <option value="">{opts.empty}</option>}
      {list.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
    </select>
  );
  const isMilestone = !!wp.is_milestone;
  const comments = wp.journals;

  return (
    <div className="content" style={{ '--pc': wp.project_color }}>
      <div className="breadcrumbs">
        <Link to={`/projects/${wp.project_identifier}`}><span className="key" style={{ '--pc': wp.project_color }}>{wp.project_name}</span></Link>
        <span>/</span><Link to={`/projects/${wp.project_identifier}/work-packages`}>Work packages</Link>
        {wp.ancestors.map(a => <span key={a.id} className="row" style={{ gap: 6 }}><span>/</span><Link to={`/wp/${a.id}`} title={a.subject}>{a.key}</Link></span>)}
      </div>
      <div className="wp-layout">
        <div style={{ minWidth: 0 }}>
          <div className="row" style={{ marginBottom: 8 }}>
            <Key k={wp.key} color={wp.project_color} />
            {can.edit ? (
              <select value={wp.type_id} onChange={(e) => update({ type_id: Number(e.target.value) })} aria-label="Type"
                style={{ width: 'auto', height: 26, fontSize: 12, fontWeight: 650, color: wp.type_color, borderColor: 'transparent', paddingLeft: 6 }}>
                {meta.types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            ) : <TypeLabel name={wp.type_name} color={wp.type_color} />}
            <span className="spacer" />
            <button className="btn sm" onClick={toggleWatch} title="Watchers get notified about changes"><Icon name="eye" />{wp.watching ? 'Unwatch' : 'Watch'}</button>
            <MoreMenu>
              <button className="menu-item" onClick={() => { navigator.clipboard?.writeText(window.location.href); toast('Link copied'); }}><Icon name="link" size={16} />Copy link</button>
              {can.create && <button className="menu-item" onClick={() => setModal('copy')}><Icon name="copy" size={16} />Duplicate</button>}
              {can.edit && <button className="menu-item" onClick={() => setModal('move')}><Icon name="folder" size={16} />Move to project</button>}
              {can.delete && <><div className="menu-sep" /><button className="menu-item danger" onClick={del}><Icon name="trash" size={16} />Delete</button></>}
            </MoreMenu>
          </div>
          {can.edit ? (
            <input className="wp-title" value={subject} onChange={(e) => setSubject(e.target.value)} onBlur={saveSubject}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setSubject(wp.subject); e.currentTarget.blur(); } }} aria-label="Subject" />
          ) : <h1 style={{ fontSize: 22 }}>{wp.subject}</h1>}
          <div className="small muted" style={{ marginTop: 6 }}>
            Created by {wp.author_name || 'someone'} {timeAgo(wp.created_at)}, updated {timeAgo(wp.updated_at)}
          </div>

          <div className="section-title">Description
            {can.edit && !editingDesc && <span className="actions"><button className="btn sm ghost" onClick={() => setEditingDesc(true)}><Icon name="edit" />Edit</button></span>}
          </div>
          {editingDesc ? (
            <div className="stack tight">
              <MarkdownEditor value={desc} onChange={setDesc} rows={10} autoFocus onSubmitShortcut={async () => { if (await update({ description: desc })) setEditingDesc(false); }} />
              <div className="row">
                <button className="btn primary sm" disabled={busy} onClick={async () => { if (await update({ description: desc })) setEditingDesc(false); }}>Save description</button>
                <button className="btn sm" onClick={() => { setDesc(wp.description || ''); setEditingDesc(false); }}>Cancel</button>
              </div>
            </div>
          ) : wp.description ? <Markdown text={wp.description} /> : <p className="muted small">{can.edit ? 'No description yet. Add details, acceptance criteria or links.' : 'No description.'}</p>}

          <div className="section-title">Child work packages <span className="muted">({wp.children.length})</span>
            {can.create && <span className="actions"><button className="btn sm ghost" onClick={() => setModal('child')}><Icon name="plus" />Add child</button></span>}
          </div>
          {wp.children.length > 0 ? (
            <div className="panel">
              {wp.children.map(c => (
                <div key={c.id} className="child-row">
                  <Key k={c.key} color={c.project_color} /><TypeLabel name={c.type_name} color={c.type_color} />
                  <Link to={`/wp/${c.id}`} className="ellipsis grow" style={{ color: 'var(--ink)' }}>{c.subject}</Link>
                  <Person id={c.assignee_id} name={c.assignee_name} muted="" />
                  <StatusPill name={c.status_name} color={c.status_color} />
                </div>
              ))}
              <div className="child-row"><span className="small muted">Children done</span><span className="grow"><Progress value={wp.children.length ? (wp.children.filter(c => c.is_closed).length / wp.children.length) * 100 : 0} /></span></div>
            </div>
          ) : <p className="small muted">Break this down into smaller tasks to track progress.</p>}

          <div className="section-title">Relations
            {can.edit && <span className="actions"><button className="btn sm ghost" onClick={() => setModal('relation')}><Icon name="link" />Add relation</button></span>}
          </div>
          {wp.relations.length ? (
            <div className="panel">
              {wp.relations.map(r => (
                <div key={r.id} className="child-row">
                  <span className="small soft" style={{ width: 96 }}>{REL_LABEL[r.direction][r.type]}</span>
                  <Link to={`/wp/${r.other_id}`} className="key plain">{r.other_key}</Link>
                  <span className="ellipsis grow">{r.other_subject}</span>
                  <StatusPill name={r.other_status} color={r.other_status_color} />
                  {can.edit && <button className="icon-btn" aria-label="Remove relation" onClick={async () => { await run(() => api.del(`/relations/${r.id}`)); reload(); }}><Icon name="x" /></button>}
                </div>
              ))}
            </div>
          ) : <p className="small muted">Link work that blocks, follows or duplicates this one.</p>}

          <div className="section-title">Photos, PDF and ZIP files <span className="muted">({wp.attachments.length} of {wp.max_files})</span>
            {can.upload && wp.attachments.length < wp.max_files && (
              <span className="actions">
                <label className="btn sm ghost" style={{ cursor: 'pointer' }}><Icon name="paperclip" />Attach files
                  <input type="file" multiple hidden accept={FILE_ACCEPT} onChange={(e) => { upload([...e.target.files].slice(0, wp.max_files - wp.attachments.length)); e.target.value = ''; }} />
                </label>
              </span>
            )}
          </div>
          {!wp.attachments.length && <p className="small muted">{can.upload ? `Attach up to ${wp.max_files} photos, PDF or ZIP files.` : 'No files.'}</p>}
          {wp.attachments.length > 0 && (
            <div className="panel">
              {wp.attachments.map(a => (
                <div key={a.id} className="child-row">
                  <Icon name="paperclip" size={15} />
                  <a href={`/api/attachments/${a.id}/download?inline=1`} target="_blank" rel="noreferrer" className="ellipsis grow">{a.filename}</a>
                  <span className="xs muted">{fmtSize(a.size)}, {a.uploaded_by_name}, {timeAgo(a.created_at)}</span>
                  <a className="icon-btn" href={`/api/attachments/${a.id}/download`} aria-label="Download"><Icon name="download" /></a>
                  {(a.uploaded_by === user.id || can.edit) && <button className="icon-btn" aria-label="Delete file" onClick={async () => {
                    if (await confirmDialog({ message: `Delete ${a.filename}?`, confirmLabel: 'Delete', danger: true })) { await run(() => api.del(`/attachments/${a.id}`)); reload(); }
                  }}><Icon name="trash" /></button>}
                </div>
              ))}
            </div>
          )}

          <div className="section-title">Links <span className="muted">({wp.links.length})</span></div>
          {wp.links.length > 0 && (
            <div className="panel" style={{ marginBottom: 8 }}>
              {wp.links.map(l => (
                <div key={l.id} className="child-row">
                  <Icon name="link" size={15} />
                  <a href={l.url} target="_blank" rel="noopener noreferrer" className="ellipsis grow">{l.title || l.url}</a>
                  {l.title && <span className="xs muted ellipsis hide-sm" style={{ maxWidth: 260 }}>{l.url}</span>}
                  {(l.created_by === user.id || can.edit) && <button className="icon-btn" aria-label="Remove link" onClick={async () => { await run(() => api.del(`/links/${l.id}`)); reload(); }}><Icon name="x" /></button>}
                </div>
              ))}
            </div>
          )}
          {(can.edit || can.comment) && <LinkEditor links={[]} onChange={async (ls) => { const l = ls[ls.length - 1]; if (l && await run(() => api.post(`/work-packages/${wp.id}/links`, l), 'Link added')) reload(); }} />}

          <div className="section-title">Activity</div>
          <div>
            {comments.map(j => <Journal key={j.id} j={j} label={label} canEditOwn onSaved={reload} />)}
          </div>
          {can.comment && (
            <div className="stack tight" style={{ marginTop: 12 }}>
              <MarkdownEditor value={comment} onChange={setComment} rows={3} placeholder="Write a comment. Type @ to notify someone." onSubmitShortcut={postComment} mentionUsers={members.length ? members : undefined} />
              <div className="row"><button className="btn primary sm" disabled={busy || !comment.trim()} onClick={postComment}>Comment</button><span className="xs muted">Ctrl + Enter to send</span></div>
            </div>
          )}
        </div>

        <aside className="panel" style={{ position: 'sticky', top: 72 }}>
          <div className="panel-body">
            <div className="attr-list">
              <span className="k">Status</span>
              <span className="v">{sel('status_id', meta.statuses)}</span>
              <span className="k">Assignee</span>
              <span className="v">{can.assign || !can.edit
                ? <UserSelect value={wp.assignee_id} disabled={!can.edit || !can.assign} onChange={(v) => update({ assignee_id: v })} />
                : <select value={wp.assignee_id ?? ''} onChange={(e) => update({ assignee_id: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">Unassigned</option><option value={user.id}>{user.name}</option>
                    {wp.assignee_id && wp.assignee_id !== user.id && <option value={wp.assignee_id}>{wp.assignee_name}</option>}
                  </select>}
              </span>
              <span className="k">Accountable</span>
              <span className="v"><UserSelect value={wp.responsible_id} disabled={!can.edit || !can.assign} placeholder="Nobody" users={members.length ? members : undefined} onChange={(v) => update({ responsible_id: v })} /></span>
              <span className="k">Priority</span>
              <span className="v">{sel('priority_id', meta.priorities)}</span>
              <span className="k">Version</span>
              <span className="v">{sel('version_id', (info?.versions || []).filter(v => v.status !== 'closed' || v.id === wp.version_id), { empty: 'None' })}</span>
              {(info?.categories?.length > 0 || wp.category_id) && <>
                <span className="k">Category</span>
                <span className="v">{sel('category_id', info?.categories || [], { empty: 'None' })}</span>
              </>}
              {!isMilestone && <>
                <span className="k">Start date</span>
                <span className="v"><input type="date" value={wp.start_date || ''} disabled={!can.edit} max={wp.due_date || undefined} onChange={(e) => update({ start_date: e.target.value || null })} /></span>
              </>}
              <span className="k">{isMilestone ? 'Date' : 'Due date'}</span>
              <span className="v">
                <input type="date" value={wp.due_date || ''} disabled={!can.edit} min={wp.start_date || undefined}
                  onChange={(e) => update(isMilestone ? { start_date: e.target.value || null, due_date: e.target.value || null } : { due_date: e.target.value || null })} />
              </span>
              {wp.due_date && <><span className="k" /><span className="v" style={{ paddingLeft: 8 }}><Due date={wp.due_date} closed={wp.is_closed} /></span></>}
              {!isMilestone && <>
                <span className="k">Estimated</span>
                <span className="v"><input type="number" min="0" step="0.5" defaultValue={wp.estimated_hours ?? ''} key={`e${wp.estimated_hours}`} disabled={!can.edit} placeholder="hours"
                  onBlur={(e) => { const v = e.target.value === '' ? null : Number(e.target.value); if (v !== wp.estimated_hours) update({ estimated_hours: v }); }} /></span>
                <span className="k">Spent</span>
                <span className="v row" style={{ paddingLeft: 8 }}>
                  <span className="num">{fmtHours(wp.spent_hours)}</span>
                  {can.log_time && <button className="btn sm ghost" onClick={() => setModal('time')}><Icon name="clock" />Log time</button>}
                </span>
                <span className="k">% done</span>
                <span className="v">
                  <select value={wp.done_ratio} disabled={!can.edit} onChange={(e) => update({ done_ratio: Number(e.target.value) })}>
                    {[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map(n => <option key={n} value={n}>{n}%</option>)}
                  </select>
                </span>
              </>}
              <span className="k">Parent</span>
              <span className="v" style={{ paddingLeft: 8 }}>
                {can.edit ? <WpSearchSelect projectId={wp.project_id} value={wp.parent_id} excludeId={wp.id} onChange={(v) => update({ parent_id: v })} placeholder="None" />
                  : wp.parent_id ? <Link to={`/wp/${wp.parent_id}`}>{wp.parent_key}</Link> : <span className="muted">None</span>}
              </span>
            </div>
          </div>
          <div className="panel-body" style={{ borderTop: '1px solid var(--line-2)' }}>
            <div className="small soft" style={{ marginBottom: 6 }}>Watchers</div>
            <div className="row wrap">{wp.watchers.map(w => <Avatar key={w.id} id={w.id} name={w.name} size="sm" />)}{!wp.watchers.length && <span className="small muted">Nobody</span>}</div>
            {wp.time.length > 0 && <>
              <div className="small soft" style={{ margin: '14px 0 6px' }}>Time logged</div>
              {wp.time.slice(0, 6).map(t => <div key={t.id} className="row small" style={{ padding: '2px 0' }}><span className="grow ellipsis">{t.user_name}, {fmtDate(t.spent_on)}</span><span className="num">{fmtHours(t.hours)}</span></div>)}
              {wp.time.length > 6 && <div className="xs muted">and {wp.time.length - 6} more entries</div>}
            </>}
            {wp.meetings.length > 0 && <>
              <div className="small soft" style={{ margin: '14px 0 6px' }}>Discussed in meetings</div>
              {wp.meetings.map(m => <div key={m.id} className="small"><Link to={`/meetings/${m.id}`}>{m.title}</Link> <span className="muted">{fmtDate(m.starts_at.slice(0, 10))}</span></div>)}
            </>}
          </div>
        </aside>
      </div>
      {modal === 'child' && <NewWpModal projectId={wp.project_id} title={`New child of ${wp.key}`} defaults={{ parent_id: wp.id, version_id: wp.version_id || '' }} onClose={() => setModal(null)} onCreated={() => reload()} />}
      {modal === 'copy' && <NewWpModal projectId={wp.project_id} title={`Duplicate ${wp.key}`} onClose={() => setModal(null)}
        defaults={{ type_id: wp.type_id, subject: `${wp.subject} (copy)`, description: wp.description || '', priority_id: wp.priority_id, assignee_id: wp.assignee_id, responsible_id: wp.responsible_id, parent_id: wp.parent_id, version_id: wp.version_id || '', start_date: wp.start_date || '', due_date: wp.due_date || '', estimated_hours: wp.estimated_hours ?? '' }} />}
      {modal === 'relation' && <AddRelation wp={wp} onDone={reload} onClose={() => setModal(null)} />}
      {modal === 'move' && <MoveModal wp={wp} onClose={() => setModal(null)} onDone={(r) => { setData(null); nav(`/wp/${r.id}`); reload(); }} />}
      {modal === 'time' && <LogTimeModal wp={wp} onClose={() => setModal(null)} onSaved={reload} />}
    </div>
  );
}
