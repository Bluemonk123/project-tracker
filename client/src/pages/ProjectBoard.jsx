import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useApp, useLoad } from '../context.jsx';
import Icon from '../components/Icon.jsx';
import { STATUS, POSITION_ORDER } from '../components/KeyPeople.jsx';
import { Loading, ErrorBox, Empty, Field, Modal, Markdown, MarkdownEditor, Person, ProjectStatus, Popover, MoreMenu, UserSelect, confirmDialog, useAsync } from '../components/ui.jsx';
import { fmtSize, timeAgo, fmtDateTime, fmtDate } from '../lib/format.js';

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
              <span className="pb-dot" />{p.name}
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
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  return (
    <div className="pb-grid" style={{ '--pc': data.project.color }}>
      <ProjectDetails data={data} reload={reload} />
      <div className="stack">
        <Approvals data={data} reload={reload} />
        <Documents data={data} reload={reload} />
        <ReleaseNotes data={data} reload={reload} />
        <ProjectTeam data={data} />
      </div>
    </div>
  );
}

const TONE = { Yes: 'ok', No: 'danger', Pending: 'warn', Scheduled: 'warn', 'In Process': 'warn' };

// One card: Go live, Delivery, Customer, Tech stack.
function ProjectDetails({ data, reload }) {
  const { project: p, board, delivery, stack, can } = data;
  const [modal, setModal] = useState(null);
  const [, run] = useAsync();
  const save = async (patch, msg = 'Saved') => { if (await run(() => api.put(`/projects/${p.id}/board-info`, patch), msg)) reload(); };
  const saveBoard = (b, msg) => save({ board: b }, msg);
  const edit = (kind, label = 'Edit') => can.brief && (
    <button type="button" className="btn sm ghost pb-edit" onClick={() => setModal(kind)} aria-label={`${label}`}><Icon name="edit" size={14} />{label}</button>
  );
  const status = (key, options, label) => (can.brief ? (
    <select className={`pb-select ${TONE[board[key]] || ''}`} value={board[key] || ''} aria-label={label}
      onChange={(e) => saveBoard({ [key]: e.target.value || null }, `${label}: ${e.target.value || 'not set'}`)}>
      <option value="">Not set</option>{options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  ) : <span className={`pb-tag ${TONE[board[key]] || 'muted'}`}>{board[key] || 'Not set'}</span>);
  const testingLink = `/projects/${p.identifier}/work-packages?status=${delivery.testing_status_ids.join(',') || 'open'}`;
  const r = delivery.release;
  const latestNote = data.release_notes[0];
  return (
    <section className="panel pb-card">
      <div className="panel-head">
        <h3>{p.name}</h3>
        <div className="actions"><ProjectStatus status={p.status} /><Link className="btn sm ghost" to={`/projects/${p.identifier}`}>Open project</Link></div>
      </div>
      <div className="pb-brief">
        {p.description ? <Markdown text={p.description} /> : <span className="muted small">No project brief yet.</span>}
        {edit('brief', p.description ? 'Edit brief' : 'Add brief')}
      </div>

      <PbGroup title="Go live">
        <PbRow label="Live version" action={edit('golive')}>
          <div className="pb-pair">
            <span><span className="xs soft">Delivered version</span><b className={board.live_version ? '' : 'muted'}>{board.live_version || 'Not Yet'}</b></span>
            <span><span className="xs soft">Delivered phase</span><b className={board.live_phase ? '' : 'muted'}>{board.live_phase || 'Not Yet'}</b></span>
          </div>
        </PbRow>
      </PbGroup>

      <PbGroup title="Delivery">
        <PbRow label="Task management">
          <Link className="pb-count-link" to={`/projects/${p.identifier}/work-packages?status=all`}>{delivery.tasks}<span> task{delivery.tasks === 1 ? '' : 's'}</span></Link>
          <span className="xs soft">{delivery.open} open</span>
        </PbRow>
        <PbRow label="Hours">
          <HoursSummary hrs={data.hours} link={`/projects/${p.identifier}/time`} />
        </PbRow>
        <PbRow label="UAT testing">
          <Link className="pb-count-link" to={testingLink}>{delivery.testing}<span> in testing</span></Link>
        </PbRow>
        <PbRow label="Release notes">
          {latestNote ? <>
            <button type="button" className="pb-count-link as-btn" onClick={() => window.dispatchEvent(new Event('pb-open-release-notes'))}><Icon name="flag" size={14} />{latestNote.version}</button>
            <span className="xs soft">{latestNote.name} · {timeAgo(latestNote.created_at)}</span>
          </> : r ? <button type="button" className="pb-count-link as-btn" onClick={() => setModal('release')}><Icon name="flag" size={14} />{r.name}</button>
            : <span className="muted small">No release yet</span>}
          {!latestNote && r && <span className="xs soft">{r.status === 'closed' ? 'Released' : r.status === 'locked' ? 'Locked' : 'Planned'}{r.due_date ? ` ${fmtDate(r.due_date, { year: true })}` : ''}</span>}
        </PbRow>
      </PbGroup>

      <PbGroup title="Customer">
        <PbRow label="Customer name" action={edit('customer', p.customer_name ? 'Details' : 'Add details')}>
          <div style={{ minWidth: 0 }}>
            <b className={p.customer_name ? '' : 'muted'}>{p.customer_name || 'Not set'}</b>
            {(board.customer_details.contact_person || board.customer_details.email || board.customer_details.phone) && (
              <div className="xs soft">{[board.customer_details.contact_person, board.customer_details.email, board.customer_details.phone].filter(Boolean).join(' · ')}</div>
            )}
          </div>
        </PbRow>
        <PbRow label="Customer user roles" action={edit('personas', data.customer_roles.length ? 'Edit' : 'Add personas')}>
          {data.customer_roles.length ? (
            <div className="row wrap" style={{ gap: 6 }}>
              {data.customer_roles.map((x, i) => <button key={x.id} type="button" className="pb-chip" onClick={() => setModal({ persona: i })} title="See this persona">{x.name}</button>)}
            </div>
          ) : <span className="muted small">No user personas yet</span>}
        </PbRow>
        <PbRow label="Customer demo">{status('customer_demo', data.options.demo, 'Customer demo')}</PbRow>
        <PbRow label="Customer approval">{status('customer_approval', data.options.yes_no_pending, 'Customer approval')}</PbRow>
        <PbRow label="Customer interaction">{status('customer_interaction', data.options.yes_no_pending, 'Customer interaction')}</PbRow>
      </PbGroup>

      <PbGroup title="Tech stack" link={<Link className="xs" to={`/projects/${p.identifier}/technologies`}>Technologies</Link>}>
        <PbRow label="Development"><TechChips list={stack.development} empty="None listed" /></PbRow>
        <PbRow label="Database"><TechChips list={stack.database} empty="None listed" /></PbRow>
        <PbRow label="Hosting" action={edit('hosting', 'Links')}><LinkPair v={board.hosting} /></PbRow>
        <PbRow label="Code repository" action={edit('repository', 'Links')}><LinkPair v={board.repository} /></PbRow>
        <PbRow label="Environment">
          <EnvPicker value={board.environments} options={data.options.environments} disabled={!can.brief}
            onChange={(v) => saveBoard({ environments: v }, 'Environments saved')} />
        </PbRow>
      </PbGroup>

      {modal === 'brief' && <BriefModal p={p} onClose={() => setModal(null)} onSave={(d) => save({ description: d }, 'Brief saved')} />}
      {modal === 'golive' && <GoLiveModal board={board} onClose={() => setModal(null)} onSave={(b) => saveBoard(b, 'Live version saved')} />}
      {modal === 'release' && r && <ReleaseModal r={r} p={p} onClose={() => setModal(null)} />}
      {modal === 'customer' && <CustomerModal p={p} board={board} onClose={() => setModal(null)} onSave={save} />}
      {modal === 'personas' && <PersonasModal roles={data.customer_roles} onClose={() => setModal(null)} onSave={(roles) => save({ customer_roles: roles }, 'Personas saved')} />}
      {modal?.persona !== undefined && <PersonaView persona={data.customer_roles[modal.persona]} onClose={() => setModal(null)} onEdit={can.brief ? () => setModal('personas') : null} />}
      {(modal === 'hosting' || modal === 'repository') && (
        <LinksModal title={modal === 'hosting' ? 'Hosting' : 'Code repository'} value={board[modal]} onClose={() => setModal(null)}
          onSave={(v) => saveBoard({ [modal]: v }, `${modal === 'hosting' ? 'Hosting' : 'Code repository'} links saved`)} />
      )}
    </section>
  );
}

const fmtH = (n) => `${Math.round((n || 0) * 10) / 10} h`;
function HoursSummary({ hrs, link }) {
  const pct = hrs.estimated > 0 ? Math.min(100, (hrs.logged_on_tasks / hrs.estimated) * 100) : 0;
  const over = hrs.estimated > 0 && hrs.logged_on_tasks > hrs.estimated;
  return (
    <div className="pb-hours">
      <div className="pb-hours-nums">
        <Link className="pb-count-link" to={link} title="Open the project's time">{fmtH(hrs.logged)}<span> logged</span></Link>
        <span className="xs soft">of {fmtH(hrs.estimated)} estimated · {fmtH(hrs.remaining)} remaining on open tasks · {fmtH(hrs.logged_week)} this week</span>
      </div>
      {hrs.estimated > 0 && <span className="pb-hours-bar" title={`${Math.round(pct)}% of the estimate used`}><span className={over ? 'over' : ''} style={{ width: `${pct}%` }} /></span>}
      {hrs.over_estimate > 0 && <span className="xs text-danger">{hrs.over_estimate} task{hrs.over_estimate > 1 ? 's' : ''} over estimate</span>}
    </div>
  );
}

const PbGroup = ({ title, link, children }) => (
  <div className="pb-group">
    <div className="pb-group-title"><span>{title}</span>{link}</div>
    {children}
  </div>
);
const PbRow = ({ label, action, children }) => (
  <div className="pb-row">
    <div className="pb-label">{label}</div>
    <div className="pb-value">{children}</div>
    {action && <div className="pb-act">{action}</div>}
  </div>
);
const TechChips = ({ list, empty }) => (list.length
  ? <div className="row wrap" style={{ gap: 6 }}>{list.map(t => <span key={t.name} className="pb-tech"><b>{t.name}</b>{t.version_used && <span> {t.version_used}</span>}</span>)}</div>
  : <span className="muted small">{empty}</span>);
const short = (u) => u.replace(/^https?:\/\//, '').replace(/\/$/, '');
const LinkPair = ({ v }) => (
  <div className="pb-links">
    {['staging', 'production'].map(k => (
      <span key={k}><span className="xs soft">{k === 'staging' ? 'Staging' : 'Production'}</span>
        {v[k] ? <a href={v[k]} target="_blank" rel="noreferrer noopener" title={v[k]}>{short(v[k])}</a> : <span className="muted small">Not added</span>}
      </span>
    ))}
  </div>
);

function EnvPicker({ value, options, onChange, disabled }) {
  const LABEL = { localhost: 'Localhost', staging: 'Staging', production: 'Production' };
  if (disabled) return value.length ? <div className="row wrap" style={{ gap: 6 }}>{value.map(e => <span key={e} className="pb-chip static">{LABEL[e]}</span>)}</div> : <span className="muted small">None selected</span>;
  return (
    <Popover align="left" trigger={({ toggle, open }) => (
      <button type="button" className={`pb-multi${open ? ' open' : ''}`} onClick={toggle} aria-label="Environments">
        {value.length ? value.map(e => <span key={e} className="pb-chip static">{LABEL[e]}</span>) : <span className="muted">Choose environments</span>}
        <Icon name="chevronDown" size={14} />
      </button>
    )}>
      {options.map(o => (
        <label key={o} className="menu-item check">
          <input type="checkbox" checked={value.includes(o)} onChange={(e) => onChange(e.target.checked ? [...value, o] : value.filter(x => x !== o))} />{LABEL[o]}
        </label>
      ))}
    </Popover>
  );
}

function BriefModal({ p, onClose, onSave }) {
  const [v, setV] = useState(p.description || '');
  return (
    <Modal title="Project brief" wide onClose={onClose} onSubmit={async () => { await onSave(v); onClose(); }} footer={<>
      <button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary">Save</button>
    </>}>
      <Field label="Project brief" hint="What the project is, who it is for and what it must achieve. Markdown is supported.">
        <MarkdownEditor value={v} onChange={setV} rows={8} autoFocus />
      </Field>
    </Modal>
  );
}

function GoLiveModal({ board, onClose, onSave }) {
  const [f, setF] = useState({ live_version: board.live_version || '', live_phase: board.live_phase || '' });
  return (
    <Modal title="Live version" onClose={onClose} onSubmit={async () => { await onSave(f); onClose(); }} footer={<>
      <button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary">Save</button>
    </>}>
      <div className="form-grid">
        <Field label="Delivered version" hint="Leave empty for “Not Yet”."><input type="text" value={f.live_version} maxLength={50} placeholder="e.g. 2.1" autoFocus onChange={(e) => setF({ ...f, live_version: e.target.value })} /></Field>
        <Field label="Delivered phase" hint="Leave empty for “Not Yet”."><input type="text" value={f.live_phase} maxLength={50} placeholder="e.g. 2" onChange={(e) => setF({ ...f, live_phase: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function ReleaseModal({ r, p, onClose }) {
  return (
    <Modal title={`Release notes: ${r.name}`} wide onClose={onClose} footer={<>
      <Link className="btn" to={`/projects/${p.identifier}/roadmap`}>Open roadmap</Link>
      <button type="button" className="btn primary" onClick={onClose}>Close</button>
    </>}>
      <p className="small soft" style={{ marginTop: 0 }}>{r.status === 'closed' ? 'Released' : r.status === 'locked' ? 'Locked' : 'Planned'}{r.due_date ? ` · ${fmtDate(r.due_date, { year: true })}` : ''}</p>
      {r.description ? <Markdown text={r.description} /> : <p className="muted">No release notes written for this version yet. Add them as the version's description on the Roadmap.</p>}
    </Modal>
  );
}

function CustomerModal({ p, board, onClose, onSave }) {
  const d = board.customer_details || {};
  const [name, setName] = useState(p.customer_name || '');
  const [f, setF] = useState({ contact_person: '', designation: '', email: '', phone: '', website: '', address: '', notes: '', ...d });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title="Customer details" wide onClose={onClose} onSubmit={async () => { await onSave({ customer_name: name, board: { customer_details: f } }, 'Customer saved'); onClose(); }} footer={<>
      <button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary">Save</button>
    </>}>
      <div className="form-grid">
        <Field label="Customer name" className="span-2"><input type="text" value={name} maxLength={200} autoFocus placeholder="e.g. Acme Retail Pvt Ltd" onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Contact person"><input type="text" value={f.contact_person} onChange={set('contact_person')} /></Field>
        <Field label="Designation"><input type="text" value={f.designation} onChange={set('designation')} placeholder="e.g. IT Head" /></Field>
        <Field label="Email"><input type="email" value={f.email} onChange={set('email')} /></Field>
        <Field label="Phone"><input type="tel" value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Website" className="span-2"><input type="url" value={f.website} onChange={set('website')} placeholder="https://" /></Field>
        <Field label="Address" className="span-2"><textarea rows={2} value={f.address} onChange={set('address')} /></Field>
        <Field label="Notes" className="span-2"><textarea rows={3} value={f.notes} onChange={set('notes')} /></Field>
      </div>
    </Modal>
  );
}

const PERSONA_FIELDS = [['pain_points', 'Pain points'], ['challenges', 'Challenges'], ['touch_points', 'Touch points']];
function PersonasModal({ roles, onClose, onSave }) {
  const blank = { name: '', pain_points: '', challenges: '', touch_points: '' };
  const [list, setList] = useState(roles.length ? roles.map(r => ({ ...blank, ...Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v ?? ''])) })) : [blank]);
  const set = (i, k, v) => setList(ls => ls.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return (
    <Modal title="Customer user roles: personas" wide onClose={onClose} onSubmit={async () => { await onSave(list.filter(x => x.name.trim())); onClose(); }} footer={<>
      <button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary">Save</button>
    </>}>
      <div className="stack">
        {list.map((x, i) => (
          <fieldset key={i} className="pb-persona-edit">
            <div className="row" style={{ alignItems: 'flex-end' }}>
              <Field label="Name" className="grow"><input type="text" value={x.name} maxLength={100} placeholder="e.g. Store manager" onChange={(e) => set(i, 'name', e.target.value)} /></Field>
              <button type="button" className="btn icon sm ghost" aria-label={`Remove persona ${i + 1}`} onClick={() => setList(ls => ls.filter((_, j) => j !== i))}><Icon name="trash" size={15} /></button>
            </div>
            <div className="form-grid three">
              {PERSONA_FIELDS.map(([k, label]) => (
                <Field key={k} label={label}><textarea rows={3} value={x[k]} onChange={(e) => set(i, k, e.target.value)} /></Field>
              ))}
            </div>
          </fieldset>
        ))}
        <button type="button" className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => setList(ls => [...ls, blank])}><Icon name="plus" size={15} />Add persona</button>
      </div>
    </Modal>
  );
}

function PersonaView({ persona, onClose, onEdit }) {
  if (!persona) return null;
  return (
    <Modal title={persona.name} onClose={onClose} footer={<>
      {onEdit && <button type="button" className="btn" onClick={onEdit}><Icon name="edit" size={15} />Edit personas</button>}
      <button type="button" className="btn primary" onClick={onClose}>Close</button>
    </>}>
      <div className="stack">
        {persona.description && <p style={{ margin: 0 }}>{persona.description}</p>}
        {PERSONA_FIELDS.map(([k, label]) => (
          <div key={k}><div className="xs soft" style={{ fontWeight: 600 }}>{label}</div><div className="pre-wrap">{persona[k] || <span className="muted">Not written yet</span>}</div></div>
        ))}
      </div>
    </Modal>
  );
}

function LinksModal({ title, value, onClose, onSave }) {
  const [f, setF] = useState({ staging: value.staging || '', production: value.production || '' });
  return (
    <Modal title={`${title} links`} onClose={onClose} onSubmit={async () => { await onSave(f); onClose(); }} footer={<>
      <button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary">Save</button>
    </>}>
      <div className="stack">
        <Field label="Staging"><input type="url" value={f.staging} autoFocus placeholder="https://" onChange={(e) => setF({ ...f, staging: e.target.value })} /></Field>
        <Field label="Production"><input type="url" value={f.production} placeholder="https://" onChange={(e) => setF({ ...f, production: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

// Short codes for project roles, shown in the same chip style as PM / AM / BA / DT.
const ROLE_CODE = { 'Project manager': 'PM', 'Team lead': 'TL', 'Account manager': 'AM', 'Business analyst': 'BA', Developer: 'DEV', 'QA / Tester': 'QA', Viewer: 'VW' };
const roleCode = (name) => ROLE_CODE[name] || name.split(/[\s/]+/).filter(Boolean).map(w => w[0]).join('').slice(0, 3).toUpperCase();

function TeamRow({ code, tone, icon, label, title, children }) {
  return (
    <div className="pb-kp">
      <span className={`kp-chip ${tone}`} title={title}><b>{code}</b>{icon && <Icon name={icon} size={14} />}</span>
      <span className="xs soft pb-kp-label">{label}</span>
      <span className="pb-kp-people">{children}</span>
    </div>
  );
}

function ProjectTeam({ data }) {
  const { positions, members, project } = data;
  const [open, setOpen] = useState(false);
  const byRole = {};
  for (const m of members) (byRole[m.role_name] ||= []).push(m);
  return (
    <section className={`panel pb-accordion${open ? ' open' : ''}`}>
      <div className="panel-head">
        <button type="button" className="pb-acc-toggle" aria-expanded={open} onClick={() => setOpen(o => !o)}>
          <Icon name="chevronRight" size={16} className="pb-acc-chev" />
          <h3>Project team <span className="pb-count">{members.length}</span></h3>
        </button>
        <div className="actions"><Link className="btn sm ghost" to={`/projects/${project.identifier}/members`}>Members</Link></div>
      </div>
      {open && (
        <div className="panel-body">
          <div className="pb-keypeople">
            {POSITION_ORDER.map(code => {
              const slot = positions[code];
              const st = STATUS[slot.status];
              return (
                <TeamRow key={code} code={code} tone={st.tone} icon={st.icon} label={slot.label} title={st.label}>
                  {slot.status === 'active' ? slot.active.map(x => <Person key={x.user_id ?? x.id} id={x.user_id ?? x.id} name={x.name} />)
                    : slot.status === 'broken' ? <span className="text-danger small">{slot.removed[0]?.name} removed</span>
                    : <span className="muted small">Not mapped</span>}
                </TeamRow>
              );
            })}
            {Object.entries(byRole).map(([role, ms]) => (
              <TeamRow key={role} code={roleCode(role)} tone="role" label={role} title={`Project role: ${role}`}>
                {ms.map(m => <Person key={m.id} id={m.user_id} name={m.name} />)}
              </TeamRow>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function Approvals({ data, reload }) {
  const [modal, setModal] = useState(null);
  const [, run] = useAsync();
  const list = data.approvals;
  const sections = data.approval_sections;
  const canEdit = data.can.brief;
  // the newest section starts open; the others closed
  const [openIds, setOpenIds] = useState(() => new Set(sections[0] ? [sections[0].id] : []));
  const seen = useRef(new Set(sections.map(x => x.id)));
  useEffect(() => { // open a section as soon as it is created
    const fresh = sections.filter(x => !seen.current.has(x.id));
    fresh.forEach(x => seen.current.add(x.id));
    if (fresh.length) setOpenIds(o => new Set([...o, ...fresh.map(x => x.id)]));
  }, [sections]);
  const toggle = (id) => setOpenIds(o => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const delSection = async (sc, n) => {
    if (await confirmDialog({ title: `Delete section ${sc.name}?`, confirmLabel: 'Delete', danger: true,
      message: n ? `The section and its ${n} approval${n > 1 ? 's' : ''} are removed. This cannot be undone.` : 'The empty section is removed.' })) {
      if (await run(() => api.del(`/approval-sections/${sc.id}`), 'Section deleted')) reload();
    }
  };
  const del = async (a) => {
    if (await confirmDialog({ title: `Delete approvers for ${a.module}?`, message: 'The module and its approvers are removed from this list.', confirmLabel: 'Delete', danger: true })) {
      if (await run(() => api.del(`/approvals/${a.id}`), 'Approval deleted')) reload();
    }
  };
  const mark = async (a, which, done) => {
    if (!done && !(await confirmDialog({ title: 'Undo approval?', message: `${a[`${which}_approver_name`]}'s approval of ${a.module} goes back to not done.`, confirmLabel: 'Undo' }))) return;
    if (await run(() => api.post(`/approvals/${a.id}/done`, { which, done }), done ? `${a.module}: approved by ${a[`${which}_approver_name`]}` : 'Approval undone')) reload();
  };
  const who = (a, which) => {
    const id = a[`${which}_approver_id`];
    if (!id) return <span className="muted small">Not chosen</span>;
    const doneAt = a[`${which}_done_at`];
    const allowed = canEdit || id === data.me;
    return (
      <span className="pb-approver">
        <Person id={id} name={a[`${which}_approver_name`]} />
        {doneAt ? (
          <button type="button" className="pb-tick" disabled={!allowed} onClick={() => mark(a, which, false)}
            title={`Approved ${fmtDateTime(doneAt)}${a[`${which}_done_by_name`] ? ` (marked by ${a[`${which}_done_by_name`]})` : ''}${allowed ? '. Click to undo.' : ''}`}
            aria-label={`${a[`${which}_approver_name`]} approved ${a.module}`}><Icon name="check" size={14} /></button>
        ) : allowed ? (
          <button type="button" className="btn xs pb-done" onClick={() => mark(a, which, true)} aria-label={`Mark ${a[`${which}_approver_name`]}'s approval of ${a.module} done`}>Done</button>
        ) : <span className="xs muted">Pending</span>}
      </span>
    );
  };
  const table = (rows) => (
    <div className="table-wrap">
      <table className="table pb-approvals">
        <thead><tr><th>Module name</th><th>First approver</th><th>Second approver</th>{canEdit && <th />}</tr></thead>
        <tbody>
          {rows.map(a => (
            <tr key={a.id}>
              <td><b>{a.module}</b></td>
              <td>{who(a, 'first')}</td>
              <td>{who(a, 'second')}</td>
              {canEdit && (
                <td className="num">
                  <MoreMenu label={`Actions for ${a.module}`}>
                    <button className="menu-item" onClick={() => setModal({ approval: a })}><Icon name="edit" size={16} />Edit</button>
                    <button className="menu-item danger" onClick={() => del(a)}><Icon name="trash" size={16} />Delete</button>
                  </MoreMenu>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <section className="panel">
      <div className="panel-head"><h3>Approvals {list.length > 0 && <span className="pb-count">{list.length}</span>}</h3>
        <div className="actions">{canEdit && <button type="button" className="btn sm" onClick={() => setModal({ section: true })}><Icon name="plus" size={15} />Add section</button>}</div>
      </div>
      {!sections.length ? (
        <div className="panel-body muted small">No approval sections yet.{canEdit && ' Choose Add section (for example "Phase 1" or "UAT sign-off"), then add modules and their approvers to it.'}</div>
      ) : sections.map(sc => {
        const rows = list.filter(a => a.section_id === sc.id);
        const need = rows.reduce((n, a) => n + (a.first_approver_id ? 1 : 0) + (a.second_approver_id ? 1 : 0), 0);
        const done = rows.reduce((n, a) => n + (a.first_done_at ? 1 : 0) + (a.second_done_at ? 1 : 0), 0);
        const isOpen = openIds.has(sc.id);
        return (
          <div key={sc.id} className={`pb-ap-section${isOpen ? ' open' : ''}`}>
            <div className="pb-ap-head">
              <button type="button" className="pb-acc-toggle" aria-expanded={isOpen} onClick={() => toggle(sc.id)}>
                <Icon name="chevronRight" size={15} className="pb-acc-chev" />
                <span className="pb-ap-name">{sc.name}</span>
                <span className="pb-count">{rows.length}</span>
                {need > 0 && <span className={`xs pb-ap-progress${done === need ? ' all' : ''}`}>{done === need ? <><Icon name="check" size={12} /> All approved</> : `${done} of ${need} approved`}</span>}
              </button>
              {canEdit && (
                <div className="actions">
                  <button type="button" className="btn xs ghost" onClick={() => { setOpenIds(o => new Set([...o, sc.id])); setModal({ sectionId: sc.id }); }}><Icon name="plus" size={13} />Add approver</button>
                  <MoreMenu label={`More for section ${sc.name}`}>
                    <button className="menu-item" onClick={() => setModal({ section: sc })}><Icon name="edit" size={16} />Rename section</button>
                    <button className="menu-item danger" onClick={() => delSection(sc, rows.length)}><Icon name="trash" size={16} />Delete section</button>
                  </MoreMenu>
                </div>
              )}
            </div>
            {isOpen && (rows.length ? table(rows)
              : <div className="pb-ap-empty xs muted">No approvers in this section yet.{canEdit && ' Choose Add approver.'}</div>)}
          </div>
        );
      })}
      {modal?.section && <SectionModal projectId={data.project.id} section={modal.section === true ? null : modal.section} onClose={() => setModal(null)} onSaved={reload} />}
      {modal && !modal.section && <ApprovalModal projectId={data.project.id} approval={modal.approval} sectionId={modal.sectionId}
        sectionName={sections.find(x => x.id === (modal.approval?.section_id ?? modal.sectionId))?.name} onClose={() => setModal(null)} onSaved={reload} />}
    </section>
  );
}

function SectionModal({ projectId, section, onClose, onSaved }) {
  const [name, setName] = useState(section?.name || '');
  const [busy, run] = useAsync();
  const save = async () => {
    const r = await run(() => (section ? api.patch(`/approval-sections/${section.id}`, { name }) : api.post(`/projects/${projectId}/approval-sections`, { name })), section ? 'Section renamed' : `Section ${name} added`);
    if (r) { onSaved(); onClose(); }
  };
  return (
    <Modal title={section ? `Rename section ${section.name}` : 'Add approval section'} onClose={onClose} onSubmit={save} footer={<>
      <button type="button" className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy || !name.trim()}>{section ? 'Save' : 'Add section'}</button>
    </>}>
      <Field label="Section name" hint={section ? undefined : 'For example Phase 1, Phase 2 or UAT sign-off. The newest section is shown open.'}>
        <input type="text" value={name} maxLength={120} required autoFocus onChange={(e) => setName(e.target.value)} />
      </Field>
    </Modal>
  );
}

function ApprovalModal({ projectId, approval, sectionId, sectionName, onClose, onSaved }) {
  const [f, setF] = useState({ module: approval?.module || '', first_approver_id: approval?.first_approver_id ?? null, second_approver_id: approval?.second_approver_id ?? null });
  const [busy, run] = useAsync();
  const save = async () => {
    const r = await run(() => (approval ? api.patch(`/approvals/${approval.id}`, f) : api.post(`/projects/${projectId}/approvals`, { ...f, section_id: sectionId })), approval ? 'Approval saved' : `${f.module} added`);
    if (r) { onSaved(); onClose(); }
  };
  return (
    <Modal title={approval ? `Edit approval: ${approval.module}` : `Add approver${sectionName ? ` to ${sectionName}` : ''}`} onClose={onClose} onSubmit={save} footer={<>
      <button type="button" className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy || !f.module.trim()}>{approval ? 'Save' : 'Add'}</button>
    </>}>
      <div className="stack">
        <Field label="Module name"><input type="text" value={f.module} maxLength={150} required autoFocus placeholder="e.g. Order management" onChange={(e) => setF({ ...f, module: e.target.value })} /></Field>
        <Field label="First approver"><UserSelect value={f.first_approver_id} placeholder="Choose a person" onChange={(v) => setF({ ...f, first_approver_id: v })} /></Field>
        <Field label="Second approver"><UserSelect value={f.second_approver_id} placeholder="Choose a person" onChange={(v) => setF({ ...f, second_approver_id: v })} /></Field>
        <p className="xs muted" style={{ margin: 0 }}>Both approvers are notified when they are chosen.</p>
      </div>
    </Modal>
  );
}

function Documents({ data, reload }) {
  const done = data.documents.filter(d => d.latest).length;
  const [modal, setModal] = useState(null);
  const [, run] = useAsync();
  const canEdit = data.can.documents;
  const del = async (d) => {
    const n = d.versions.length;
    if (await confirmDialog({ title: `Delete ${d.name}?`, confirmLabel: 'Delete', danger: true,
      message: n ? `It is removed from the list together with its ${n} uploaded file${n > 1 ? 's' : ''}. This cannot be undone.` : 'It is removed from the list.' })) {
      if (await run(() => api.del(`/document-slots/${d.id}`), `${d.name} deleted`)) reload();
    }
  };
  return (
    <section className="panel pb-docs">
      <div className="panel-head"><h3>Project documents</h3>
        <div className="actions">
          <span className="small soft">{done} of {data.documents.length} uploaded</span>
          {canEdit && <button type="button" className="btn sm" onClick={() => setModal({})}><Icon name="plus" size={15} />Add</button>}
        </div>
      </div>
      {data.documents.length ? (
        <ul className="pb-doclist">
          {data.documents.map(d => <DocRow key={d.id} d={d} projectId={data.project.id} canUpload={canEdit} maxMb={data.max_mb} reload={reload}
            onRename={() => setModal({ doc: d })} onDelete={() => del(d)} />)}
        </ul>
      ) : <div className="panel-body muted small">No documents in the list.{canEdit && ' Choose Add to create one.'}</div>}
      <div className="panel-body xs muted" style={{ borderTop: '1px solid var(--line)' }}>
        Uploading a file again keeps the earlier one as an older version. Any file type, up to {data.max_mb} MB.
      </div>
      {modal && <DocNameModal projectId={data.project.id} doc={modal.doc} onClose={() => setModal(null)} onSaved={reload} />}
    </section>
  );
}

// Release notes: document name + version, each with its uploaded files. Collapsed by default.
function ReleaseNotes({ data, reload }) {
  const { toast } = useApp();
  const list = data.release_notes;
  const canEdit = data.can.documents;
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [, run] = useAsync();
  const fileInput = useRef(null);
  const target = useRef(null);
  useEffect(() => {
    const show = () => { setOpen(true); setTimeout(() => document.getElementById('pb-release-notes')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); };
    window.addEventListener('pb-open-release-notes', show);
    return () => window.removeEventListener('pb-open-release-notes', show);
  }, []);
  const uploadTo = (note) => { target.current = note; fileInput.current?.click(); };
  const onFile = async (file) => {
    const note = target.current;
    if (!file || !note) return;
    if (file.size > data.max_mb * 1048576) { toast(`Files must be ${data.max_mb} MB or smaller.`, 'error'); return; }
    setBusyId(note.id);
    try {
      await uploadFile(`/api/release-notes/${note.id}/files`, file);
      toast(`${file.name} uploaded to ${note.name} ${note.version}`);
      reload();
    } catch (e) { toast(e.message, 'error'); }
    setBusyId(null);
    fileInput.current.value = '';
  };
  const delNote = async (n) => {
    const k = n.files.length;
    if (await confirmDialog({ title: `Delete ${n.name} ${n.version}?`, confirmLabel: 'Delete', danger: true,
      message: k ? `It is removed together with its ${k} uploaded file${k > 1 ? 's' : ''}. This cannot be undone.` : 'It is removed from the list.' })) {
      if (await run(() => api.del(`/release-notes/${n.id}`), 'Release note deleted')) reload();
    }
  };
  const delFile = async (n, f) => {
    if (await confirmDialog({ title: `Delete ${f.filename}?`, message: `The file is removed from ${n.name} ${n.version}. This cannot be undone.`, confirmLabel: 'Delete', danger: true })) {
      if (await run(() => api.del(`/release-notes/${n.id}/files/${f.id}`), 'File deleted')) reload();
    }
  };
  return (
    <section id="pb-release-notes" className={`panel pb-accordion${open ? ' open' : ''}`}>
      <div className="panel-head">
        <button type="button" className="pb-acc-toggle" aria-expanded={open} onClick={() => setOpen(o => !o)}>
          <Icon name="chevronRight" size={16} className="pb-acc-chev" />
          <h3>Release notes {list.length > 0 && <span className="pb-count">{list.length}</span>}</h3>
        </button>
        <div className="actions">{canEdit && <button type="button" className="btn sm" onClick={() => { setOpen(true); setModal({}); }}><Icon name="plus" size={15} />Add</button>}</div>
      </div>
      {open && (!list.length ? <div className="panel-body muted small">No release notes yet.{canEdit && ' Choose Add to add a document name and version.'}</div> : (
        <ul className="pb-doclist">
          {list.map(n => (
            <li key={n.id} className="pb-doc pb-rn">
              <span className="pb-rn-ver" title="Version">{n.version}</span>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="pb-docname">{n.name}</div>
                <div className="xs soft">Added {timeAgo(n.created_at)}{n.created_by_name ? ` by ${n.created_by_name}` : ''}</div>
                {n.files.length ? (
                  <ul className="pb-rn-files">
                    {n.files.map(f => (
                      <li key={f.id}>
                        <Icon name="file" size={13} /><span className="pb-fname">{f.filename}</span>
                        <span className="xs muted">· {fmtSize(f.size)} · {timeAgo(f.created_at)}</span>
                        <a className="btn icon xs ghost" href={`/api/attachments/${f.id}/download`} download title={`Download ${f.filename}`} aria-label={`Download ${f.filename}`}><Icon name="download" size={14} /></a>
                        {canEdit && <button type="button" className="btn icon xs ghost" title="Delete file" aria-label={`Delete ${f.filename}`} onClick={() => delFile(n, f)}><Icon name="trash" size={14} /></button>}
                      </li>
                    ))}
                  </ul>
                ) : <div className="xs muted" style={{ marginTop: 4 }}>No document uploaded yet</div>}
              </div>
              {canEdit && (
                <div className="pb-docbtns">
                  <button type="button" className="btn icon sm" disabled={busyId === n.id} onClick={() => uploadTo(n)} title="Upload a document" aria-label={`Upload to ${n.name} ${n.version}`}>
                    {busyId === n.id ? <span className="spinner sm" /> : <Icon name="upload" />}
                  </button>
                  <MoreMenu label={`More for ${n.name} ${n.version}`}>
                    <button className="menu-item" onClick={() => setModal({ note: n })}><Icon name="edit" size={16} />Edit name or version</button>
                    <button className="menu-item danger" onClick={() => delNote(n)}><Icon name="trash" size={16} />Delete</button>
                  </MoreMenu>
                </div>
              )}
            </li>
          ))}
        </ul>
      ))}
      <input ref={fileInput} type="file" hidden onChange={(e) => onFile(e.target.files?.[0])} />
      {modal && <ReleaseNoteModal projectId={data.project.id} note={modal.note} maxMb={data.max_mb} onClose={() => setModal(null)} onSaved={reload} />}
    </section>
  );
}

async function uploadFile(url, file) {
  const fd = new FormData(); fd.append('file', file);
  const res = await fetch(url, { method: 'POST', body: fd, credentials: 'same-origin' });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || 'Upload failed.');
  return out;
}

function ReleaseNoteModal({ projectId, note, maxMb, onClose, onSaved }) {
  const { toast } = useApp();
  const [f, setF] = useState({ name: note?.name || '', version: note?.version || '' });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (file && file.size > maxMb * 1048576) { toast(`Files must be ${maxMb} MB or smaller.`, 'error'); return; }
    setBusy(true);
    try {
      let id = note?.id;
      if (note) await api.patch(`/release-notes/${note.id}`, f);
      else id = (await api.post(`/projects/${projectId}/release-notes`, f)).id;
      if (file) await uploadFile(`/api/release-notes/${id}/files`, file);
      toast(note ? 'Release note saved' : `${f.name} ${f.version} added`);
      onSaved(); onClose();
    } catch (e) { toast(e.message, 'error'); onSaved(); }
    setBusy(false);
  };
  return (
    <Modal title={note ? `Edit ${note.name} ${note.version}` : 'Add release note'} onClose={onClose} onSubmit={save} footer={<>
      <button type="button" className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy || !f.name.trim() || !f.version.trim()}>{busy ? 'Saving…' : note ? 'Save' : 'Add'}</button>
    </>}>
      <div className="form-grid">
        <Field label="Document name" className="span-2"><input type="text" value={f.name} maxLength={150} required autoFocus placeholder="e.g. Release notes, Change log" onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Version"><input type="text" value={f.version} maxLength={50} required placeholder="e.g. 1.4.0" onChange={(e) => setF({ ...f, version: e.target.value })} /></Field>
        {!note && (
          <Field label="Document (optional)" hint={`Any file type, up to ${maxMb} MB. You can upload more later.`}>
            <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </Field>
        )}
      </div>
    </Modal>
  );
}

function DocNameModal({ projectId, doc, onClose, onSaved }) {
  const [f, setF] = useState({ name: doc?.name || '', detail: doc?.detail || '' });
  const [busy, run] = useAsync();
  const save = async () => {
    const r = await run(() => (doc ? api.patch(`/document-slots/${doc.id}`, f) : api.post(`/projects/${projectId}/document-slots`, f)), doc ? 'Document renamed' : `${f.name} added`);
    if (r) { onSaved(); onClose(); }
  };
  return (
    <Modal title={doc ? `Rename ${doc.name}` : 'Add document'} onClose={onClose} onSubmit={save} footer={<>
      <button type="button" className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy || !f.name.trim()}>{doc ? 'Save' : 'Add'}</button>
    </>}>
      <div className="stack">
        <Field label="Document name"><input type="text" value={f.name} maxLength={150} required autoFocus placeholder="e.g. Test Cases" onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Details" hint="Optional, shown in brackets after the name, e.g. BRD, with Business Rules & SOPs."><input type="text" value={f.detail} maxLength={200} onChange={(e) => setF({ ...f, detail: e.target.value })} /></Field>
        {!doc && <p className="xs muted" style={{ margin: 0 }}>It is added at the end of the list; numbers follow the order.</p>}
      </div>
    </Modal>
  );
}

function DocRow({ d, projectId, canUpload, maxMb, reload, onRename, onDelete }) {
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
      const res = await fetch(`/api/projects/${projectId}/documents/${d.id}`, { method: 'POST', body: fd, credentials: 'same-origin' });
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
          <MoreMenu label={`More for ${d.name}`}>
            <button className="menu-item" onClick={onRename}><Icon name="edit" size={16} />Rename</button>
            <button className="menu-item danger" onClick={onDelete}><Icon name="trash" size={16} />Delete</button>
          </MoreMenu>
        </>}
      </div>
    </li>
  );
}
