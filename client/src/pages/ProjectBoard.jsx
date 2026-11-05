import { useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useApp, useLoad } from '../context.jsx';
import Icon from '../components/Icon.jsx';
import { STATUS, POSITION_ORDER } from '../components/KeyPeople.jsx';
import { Loading, ErrorBox, Empty, Field, Modal, Markdown, MarkdownEditor, Person, ProjectStatus, useAsync } from '../components/ui.jsx';
import { fmtSize, timeAgo, fmtDateTime } from '../lib/format.js';

// One tab per project: brief, customer, customer user roles and team on the left; the seven project documents on the right.
export default function ProjectBoard() {
  const { projects } = useApp();
  const [params, setParams] = useSearchParams();
  const list = projects.filter(p => !p.archived);
  const key = params.get('p');
  const current = list.find(p => p.identifier === key) || list[0];
  return (
    <div className="content">
      <div className="page-head">
        <div className="grow"><h1>Project Board</h1><p>Brief, customer, team and key documents of every project.</p></div>
      </div>
      {!list.length ? <div className="panel"><Empty title="No projects yet">Create a project to see it here.</Empty></div> : <>
        <div className="pb-tabs" role="tablist" aria-label="Projects">
          {list.map(p => (
            <button key={p.id} type="button" role="tab" aria-selected={p.id === current.id} className={p.id === current.id ? 'active' : ''}
              style={{ '--pc': p.color }} onClick={() => setParams({ p: p.identifier }, { replace: true })}>
              <span className="pb-dot" />{p.name}<span className="pb-key">{p.identifier}</span>
            </button>
          ))}
        </div>
        <ProjectSheet key={current.id} projectId={current.id} />
      </>}
    </div>
  );
}

function ProjectSheet({ projectId }) {
  const { data, error, loading, reload } = useLoad(() => api.get(`/projects/${projectId}/board-info`), [projectId]);
  const [editing, setEditing] = useState(false);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const { project: p, can } = data;
  const editBtn = can.brief && <button type="button" className="btn sm ghost" onClick={() => setEditing(true)}><Icon name="edit" size={15} />Edit</button>;
  return (
    <div className="pb-grid" style={{ '--pc': p.color }}>
      <div className="stack">
        <section className="panel">
          <div className="panel-head"><h3>Project brief</h3>
            <div className="actions"><ProjectStatus status={p.status} /><Link className="btn sm ghost" to={`/projects/${p.identifier}`}>Open project</Link>{editBtn}</div>
          </div>
          <div className="panel-body">
            {p.description ? <Markdown text={p.description} /> : <p className="muted small" style={{ margin: 0 }}>No brief written yet.{can.brief && ' Choose Edit to add one.'}</p>}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head"><h3>Customer name</h3><div className="actions">{editBtn}</div></div>
          <div className="panel-body">
            {p.customer_name ? <div className="pb-customer"><Icon name="briefcase" size={18} />{p.customer_name}</div> : <p className="muted small" style={{ margin: 0 }}>Not set.</p>}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head"><h3>Customer user roles {data.customer_roles.length > 0 && <span className="pb-count">{data.customer_roles.length}</span>}</h3><div className="actions">{editBtn}</div></div>
          <div className="panel-body">
            {data.customer_roles.length ? (
              <ul className="pb-roles">
                {data.customer_roles.map(r => <li key={r.id}><b>{r.name}</b>{r.description && <span className="soft"> — {r.description}</span>}</li>)}
              </ul>
            ) : <p className="muted small" style={{ margin: 0 }}>The kinds of users of the customer's application (e.g. Admin, Store manager, Field agent). None listed yet.</p>}
          </div>
        </section>

        <ProjectTeam data={data} />
      </div>

      <Documents data={data} reload={reload} />
      {editing && <EditBrief data={data} onClose={() => setEditing(false)} onSaved={reload} />}
    </div>
  );
}

function ProjectTeam({ data }) {
  const { positions, members, project } = data;
  const byRole = {};
  for (const m of members) (byRole[m.role_name] ||= []).push(m);
  return (
    <section className="panel">
      <div className="panel-head"><h3>Project team <span className="pb-count">{members.length}</span></h3>
        <div className="actions"><Link className="btn sm ghost" to={`/projects/${project.identifier}/members`}>Members</Link></div>
      </div>
      <div className="panel-body stack">
        <div className="pb-keypeople">
          {POSITION_ORDER.map(code => {
            const slot = positions[code];
            const st = STATUS[slot.status];
            return (
              <div key={code} className="pb-kp">
                <span className={`kp-chip ${st.tone}`} title={st.label}><b>{code}</b><Icon name={st.icon} size={14} /></span>
                <span className="xs soft pb-kp-label">{slot.label}</span>
                <span className="pb-kp-people">
                  {slot.status === 'active' ? slot.active.map(x => <Person key={x.user_id ?? x.id} id={x.user_id ?? x.id} name={x.name} />)
                    : slot.status === 'broken' ? <span className="text-danger small">{slot.removed[0]?.name} removed</span>
                    : <span className="muted small">Not mapped</span>}
                </span>
              </div>
            );
          })}
        </div>
        {Object.keys(byRole).length > 0 && (
          <div className="pb-members">
            {Object.entries(byRole).map(([role, ms]) => (
              <div key={role}>
                <div className="xs soft" style={{ fontWeight: 600, marginBottom: 4 }}>{role}</div>
                <div className="row wrap" style={{ gap: '6px 14px' }}>
                  {ms.map(m => <Person key={m.id} id={m.user_id} name={m.name} />)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function Documents({ data, reload }) {
  const done = data.documents.filter(d => d.latest).length;
  return (
    <section className="panel pb-docs">
      <div className="panel-head"><h3>Project documents</h3><span className="small soft">{done} of {data.documents.length} uploaded</span></div>
      <ul className="pb-doclist">
        {data.documents.map(d => <DocRow key={d.key} d={d} projectId={data.project.id} canUpload={data.can.documents} maxMb={data.max_mb} reload={reload} />)}
      </ul>
      <div className="panel-body xs muted" style={{ borderTop: '1px solid var(--line)' }}>
        Uploading a file again keeps the earlier one as an older version. Any file type, up to {data.max_mb} MB.
      </div>
    </section>
  );
}

function DocRow({ d, projectId, canUpload, maxMb, reload }) {
  const { toast } = useApp();
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [showOld, setShowOld] = useState(false);
  const pick = async (file) => {
    if (!file) return;
    if (file.size > maxMb * 1048576) { toast(`Files must be ${maxMb} MB or smaller.`, 'error'); return; }
    setBusy(true);
    try {
      const fd = new FormData(); fd.append('file', file);
      const res = await fetch(`/api/projects/${projectId}/documents/${d.key}`, { method: 'POST', body: fd, credentials: 'same-origin' });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || 'Upload failed.');
      toast(`${d.key} ${d.name} uploaded`);
      reload();
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
    if (input.current) input.current.value = '';
  };
  const l = d.latest;
  const older = d.versions.slice(1);
  return (
    <li className={`pb-doc${l ? '' : ' missing'}`}>
      <span className="pb-docnum">{d.key}</span>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="pb-docname">{d.name}{d.detail && <span className="soft"> ({d.detail})</span>}</div>
        {l ? (
          <div className="xs soft pb-docmeta" title={fmtDateTime(l.created_at)}>
            <Icon name="file" size={13} /><span className="pb-fname">{l.filename}</span> · {fmtSize(l.size)} · {timeAgo(l.created_at)}{l.uploaded_by_name ? ` by ${l.uploaded_by_name}` : ''}
            {older.length > 0 && <> · <button type="button" className="link-btn xs" onClick={() => setShowOld(s => !s)}>v{d.versions.length}, {older.length} older</button></>}
          </div>
        ) : <div className="xs muted">Not uploaded yet</div>}
        {showOld && (
          <ul className="pb-older">
            {older.map((v, i) => (
              <li key={v.id} className="xs">
                <a href={`/api/attachments/${v.id}/download`} download><Icon name="download" size={12} /> v{older.length - i}: {v.filename}</a>
                <span className="muted"> · {fmtSize(v.size)} · {timeAgo(v.created_at)}{v.uploaded_by_name ? ` by ${v.uploaded_by_name}` : ''}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="pb-docbtns">
        {l ? <a className="btn icon sm" href={`/api/attachments/${l.id}/download`} download title={`Download ${l.filename}`} aria-label={`Download ${d.name}`}><Icon name="download" /></a>
          : <button type="button" className="btn icon sm" disabled title="Nothing to download yet" aria-label={`Download ${d.name}`}><Icon name="download" /></button>}
        {canUpload && <>
          <button type="button" className="btn icon sm" disabled={busy} onClick={() => input.current?.click()}
            title={l ? 'Upload a new version' : 'Upload'} aria-label={`Upload ${d.name}`}>{busy ? <span className="spinner sm" /> : <Icon name="upload" />}</button>
          <input ref={input} type="file" hidden onChange={(e) => pick(e.target.files?.[0])} />
        </>}
      </div>
    </li>
  );
}

function EditBrief({ data, onClose, onSaved }) {
  const [brief, setBrief] = useState(data.project.description || '');
  const [customer, setCustomer] = useState(data.project.customer_name || '');
  const [roles, setRoles] = useState(data.customer_roles.length ? data.customer_roles.map(r => ({ name: r.name, description: r.description || '' })) : [{ name: '', description: '' }]);
  const [busy, run] = useAsync();
  const setRole = (i, k, v) => setRoles(rs => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const save = async () => {
    const ok = await run(() => api.put(`/projects/${data.project.id}/board-info`, { description: brief, customer_name: customer, customer_roles: roles.filter(r => r.name.trim()) }), 'Saved');
    if (ok) { onSaved(); onClose(); }
  };
  return (
    <Modal title={`${data.project.name}: brief and customer`} wide onClose={onClose} onSubmit={save} footer={<>
      <button type="button" className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy}>Save</button>
    </>}>
      <div className="stack">
        <Field label="Project brief" hint="What the project is, who it is for and what it must achieve. Markdown is supported.">
          <MarkdownEditor value={brief} onChange={setBrief} rows={7} placeholder="e.g. A customer portal where clients raise tickets and track orders…" />
        </Field>
        <Field label="Customer name"><input type="text" value={customer} maxLength={200} onChange={(e) => setCustomer(e.target.value)} placeholder="e.g. Acme Retail Pvt Ltd" /></Field>
        <div>
          <div className="field-label" style={{ fontWeight: 560, fontSize: 'var(--fs-sm)', marginBottom: 6 }}>Customer user roles</div>
          <div className="stack" style={{ gap: 6 }}>
            {roles.map((r, i) => (
              <div key={i} className="pb-role-row">
                <input type="text" value={r.name} maxLength={100} placeholder="Role, e.g. Store manager" aria-label={`Role ${i + 1} name`} onChange={(e) => setRole(i, 'name', e.target.value)} />
                <input type="text" value={r.description} maxLength={500} placeholder="What they do in the app (optional)" aria-label={`Role ${i + 1} description`} onChange={(e) => setRole(i, 'description', e.target.value)} />
                <button type="button" className="btn icon sm ghost" aria-label={`Remove role ${i + 1}`} onClick={() => setRoles(rs => rs.filter((_, j) => j !== i))}><Icon name="trash" size={15} /></button>
              </div>
            ))}
            <button type="button" className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => setRoles(rs => [...rs, { name: '', description: '' }])}><Icon name="plus" size={15} />Add role</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
