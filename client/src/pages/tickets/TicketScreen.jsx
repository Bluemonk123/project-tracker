// One ticket: conversation on the left, properties on the right.
// Used as its own page (/ticket-board/<no>) and inside the dashboard's side panel.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useApp, useLoad } from '../../context.jsx';
import Icon from '../../components/Icon.jsx';
import { Loading, ErrorBox, Popover, MoreMenu, confirmDialog } from '../../components/ui.jsx';
import {
  STATUS, PRIORITY, TYPE_LABEL, TicketStatus, TicketPriority, SlaBadge, ChannelIcon, fmtLocal,
  FilePicker, toForm, AttachmentList, ThreadItem,
} from './common.jsx';

const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || '';
const fillMacro = (tpl, d) => tpl
  .replaceAll('{customer_first_name}', firstName(d.requester.name))
  .replaceAll('{agent_first_name}', firstName(d.me.name))
  .replaceAll('{ticket_id}', String(d.ticket.ticket_no));

export function TicketPage() {
  const { no } = useParams();
  return (
    <div className="content wide">
      <div className="row" style={{ marginBottom: 12 }}>
        <Link to="/ticket-board" className="btn sm ghost"><Icon name="chevronLeft" />Ticket Board</Link>
      </div>
      <TicketScreen no={no} />
    </div>
  );
}

export default function TicketScreen({ no, embedded, onChanged, onClose }) {
  const { data, error, loading, reload } = useLoad(() => api.get(`/tickets/${no}`), [no]);
  const changed = () => { reload(); onChanged?.(); };
  if (error) return <ErrorBox error={error} />;
  if (loading && !data) return <Loading />;
  return <TicketView key={data.ticket.id} d={data} embedded={embedded} onChanged={changed} onClose={onClose} onDeleted={onChanged} />;
}

function TicketView({ d, embedded, onChanged, onClose, onDeleted }) {
  const { toast } = useApp();
  const nav = useNavigate();
  const t = d.ticket;
  const canEdit = d.can.edit;
  const [busy, setBusy] = useState(false);
  const patch = async (body) => {
    setBusy(true);
    try { await api.patch(`/tickets/${t.ticket_no}`, body); onChanged(); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const take = async () => {
    setBusy(true);
    try { await api.post(`/tickets/${t.ticket_no}/take`); toast('Assigned to you'); onChanged(); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!await confirmDialog({ title: `Delete ticket #${t.ticket_no}?`, message: 'The ticket, its conversation and its files are removed for good. Use this for spam or test tickets.', confirmLabel: 'Delete ticket', danger: true })) return;
    try {
      await api.del(`/tickets/${t.ticket_no}`); toast(`Ticket ${t.ticket_no} deleted`);
      onDeleted?.();
      if (onClose) onClose(); else nav('/ticket-board');
    } catch (e) { toast(e.message, 'error'); }
  };
  const threadEnd = useRef(null);
  useEffect(() => { if (!embedded) return; threadEnd.current?.scrollIntoView({ block: 'nearest' }); }, [d.messages.length, embedded]);

  return (
    <div className={`tk-screen${embedded ? ' embedded' : ''}`}>
      <section className="tk-conv panel">
        <header className="tk-head">
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="row wrap" style={{ gap: 8 }}>
              <span className="tk-no">#{t.ticket_no}</span>
              <TicketStatus status={t.status} />
              <TicketPriority priority={t.priority} />
              <ChannelIcon channel={t.channel} />
              <span className="xs muted" title="Time since the ticket was raised (stops when solved)">Age {t.age}</span>
            </div>
            <h2 className="tk-subject">{t.subject_display}</h2>
          </div>
          <div className="row" style={{ alignSelf: 'flex-start' }}>
            {!t.assignee_id && canEdit && <button type="button" className="btn sm primary" disabled={busy} onClick={take}>Take it</button>}
            {d.can.delete && <MoreMenu><button type="button" className="menu-item danger" onClick={remove}><Icon name="trash" size={16} />Delete ticket</button></MoreMenu>}
            {embedded && <Link className="btn sm ghost icon" to={`/ticket-board/${t.ticket_no}`} title="Open as a full page" aria-label="Open as a full page"><Icon name="link" /></Link>}
            {onClose && <button type="button" className="btn sm ghost icon" onClick={onClose} aria-label="Close panel"><Icon name="x" /></button>}
          </div>
        </header>
        <div className="tk-thread">
          <div className="tk-msg requester original">
            <span className="tk-initials" aria-hidden="true">{String(d.requester.name).split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('')}</span>
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="tk-msg-head"><b>{d.requester.name}</b><span className="tag">Original request</span><span className="xs muted">{fmtLocal(t.raised_on)}</span></div>
              <div className="tk-body">{t.feedback}</div>
              <AttachmentList files={t.attachments} />
            </div>
          </div>
          {d.messages.map(m => <ThreadItem key={m.id} m={m} />)}
          <div ref={threadEnd} />
        </div>
        {canEdit ? <ReplyBox d={d} onSent={onChanged} /> : <div className="tk-readonly small muted">You can read this ticket. Replying and changing it needs the Ticket Board “Edit” permission.</div>}
      </section>

      <aside className="tk-props panel">
        <div className="tk-requester">
          <div className="xs muted">Requester</div>
          <div className="tk-req-name">{d.requester.name}</div>
          <div className="small">{d.requester.kind_label}{d.requester.detail ? ` · ${d.requester.detail}` : ''}</div>
          {d.requester.email && <div className="small"><a href={`mailto:${d.requester.email}`}>{d.requester.email}</a></div>}
          <div className="xs muted" style={{ marginTop: 4 }}>{d.requester.total} ticket{d.requester.total === 1 ? '' : 's'} · {d.requester.unsolved} unsolved</div>
          {d.can.change_requester && <RequesterChange d={d} onChanged={onChanged} />}
        </div>
        <div className="tk-prop-list">
          <Prop label="Assignee">
            <EngineerPicker engineers={d.engineers} value={t.assignee_id} disabled={!canEdit || busy} onChange={(id) => patch({ assignee_id: id })} />
          </Prop>
          <Prop label="Status">
            <select value={t.status} disabled={!canEdit || busy} onChange={(e) => patch({ status: e.target.value })}>
              {d.options.statuses.map(s => <option key={s} value={s}>{STATUS[s].label}</option>)}
            </select>
          </Prop>
          <Prop label="Group">
            <select value={t.group_name} disabled={!canEdit || busy} onChange={(e) => patch({ group_name: e.target.value })}>
              {!d.options.groups.includes(t.group_name) && <option value={t.group_name}>{t.group_name} (inactive)</option>}
              {d.options.groups.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </Prop>
          <Prop label="Type">
            <select value={t.ticket_type} disabled={!canEdit || busy} onChange={(e) => patch({ ticket_type: e.target.value })}>
              {d.options.types.map(x => <option key={x} value={x}>{TYPE_LABEL[x]}</option>)}
            </select>
          </Prop>
          <Prop label="Priority">
            <select value={t.priority} disabled={!canEdit || busy} onChange={(e) => patch({ priority: e.target.value })}>
              {d.options.priorities.map(x => <option key={x} value={x}>{PRIORITY[x].label}</option>)}
            </select>
          </Prop>
          <Prop label="Subject">
            <TextProp value={t.subject || t.subject_display} disabled={!canEdit || busy} max={200} required onSave={(v) => patch({ subject: v })} />
          </Prop>
          <Prop label="Tags">
            <TextProp value={t.tags || ''} disabled={!canEdit || busy} max={500} placeholder="comma, separated" onSave={(v) => patch({ tags: v })} />
          </Prop>
          <Prop label="Linked record">
            <TextProp value={t.linked_record || ''} disabled={!canEdit || busy} max={100} placeholder="e.g. order or asset ID" onSave={(v) => patch({ linked_record: v })} />
          </Prop>
          <Prop label="Date created"><span className="small">{fmtLocal(t.raised_on)}</span></Prop>
          <Prop label="SLA"><SlaBadge sla={t.sla} /></Prop>
          {t.notes && <Prop label="Closing notes"><div className="small tk-body">{t.notes}</div></Prop>}
        </div>
        <div className="tk-history">
          <div className="xs muted" style={{ marginBottom: 6 }}>Interaction history</div>
          {!d.history.length ? <div className="small muted">No other tickets from this requester.</div> : (
            <ul className="list">
              {d.history.map(h => (
                <li key={h.ticket_no}>
                  <TicketStatus status={h.status} />
                  <Link to={`/ticket-board/${h.ticket_no}`} className="ellipsis grow small">{h.subject_display}</Link>
                  <span className="xs muted">#{h.ticket_no}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}

const Prop = ({ label, children }) => <label className="tk-prop"><span className="xs muted">{label}</span>{children}</label>;

function TextProp({ value, onSave, disabled, max, required, placeholder }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => {
    const nv = v.trim();
    if (nv === String(value || '').trim()) return;
    if (required && !nv) { setV(value); return; }
    onSave(nv);
  };
  return <input type="text" value={v} maxLength={max} disabled={disabled} placeholder={placeholder}
    onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } if (e.key === 'Escape') setV(value); }} />;
}

// Administrators only: pick another user as the requester.
function RequesterChange({ d, onChanged }) {
  const { activeUsers, toast } = useApp();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const people = (activeUsers || []).filter(u => u.id !== d.ticket.requester_user_id && `${u.name} ${u.email || ''}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 50);
  const pick = async (u) => {
    setBusy(true);
    try { await api.put(`/tickets/${d.ticket.ticket_no}/requester`, { user_id: u.id }); toast(`Requester changed to ${u.name}`); onChanged(); }
    catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Popover align="left" trigger={({ toggle }) => <button type="button" className="link-btn xs" style={{ marginTop: 6 }} onClick={toggle} disabled={busy}>Change requester</button>}>
      <div style={{ padding: 6, width: 280 }}>
        <input type="search" placeholder="Search people" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        <div style={{ maxHeight: 260, overflow: 'auto', marginTop: 4 }}>
          {people.map(u => (
            <button type="button" key={u.id} className="menu-item" disabled={busy} onClick={() => pick(u)}>
              <span className="grow ellipsis">{u.name}</span><span className="xs muted ellipsis" style={{ maxWidth: 130 }}>{u.email}</span>
            </button>
          ))}
          {!people.length && <div className="xs muted" style={{ padding: 6 }}>No one matches.</div>}
        </div>
      </div>
    </Popover>
  );
}

// Searchable list of engineers, with "(you)" and each one's open-ticket count.
function EngineerPicker({ engineers, value, onChange, disabled }) {
  const [q, setQ] = useState('');
  const current = engineers.find(e => e.id === value);
  const list = useMemo(() => engineers.filter(e => !e.former && e.name.toLowerCase().includes(q.trim().toLowerCase())), [engineers, q]);
  return (
    <Popover align="left" trigger={({ toggle }) => (
      <button type="button" className="tk-picker" onClick={toggle} disabled={disabled}>
        <span className="ellipsis">{current ? `${current.name}${current.is_me ? ' (you)' : ''}` : 'Unassigned'}</span><Icon name="chevronDown" size={14} />
      </button>
    )}>
      <div style={{ padding: 6, width: 250 }}>
        <input type="search" placeholder="Search engineers" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      </div>
      <div style={{ maxHeight: 260, overflowY: 'auto' }}>
        {value && <button type="button" className="menu-item" onClick={() => onChange(null)}>Unassign</button>}
        {list.map(e => (
          <button type="button" key={e.id} className={`menu-item${e.id === value ? ' active' : ''}`} onClick={() => onChange(e.id)}>
            <span className="grow ellipsis">{e.name}{e.is_me ? ' (you)' : ''}</span><span className="xs muted">{e.open_count} open</span>
          </button>
        ))}
        {!list.length && <div className="small muted" style={{ padding: 10 }}>No engineer matches.</div>}
      </div>
    </Popover>
  );
}

function ReplyBox({ d, onSent }) {
  const { toast } = useApp();
  const t = d.ticket;
  const [internal, setInternal] = useState(false);
  const [body, setBody] = useState('');
  const [status, setStatus] = useState(t.status);
  const [group, setGroup] = useState(null);
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const applyMacro = (id) => {
    const m = d.macros.find(x => String(x.id) === String(id));
    if (!m) return;
    setBody(fillMacro(m.body_template, d));
    if (m.set_status) setStatus(m.set_status);
    if (m.set_group && d.options.groups.includes(m.set_group)) setGroup(m.set_group);
    setInternal(!!m.is_internal);
  };
  const submit = async (e) => {
    e.preventDefault();
    if (!body.trim() && !files.length && status === t.status && !group) { toast('Write a reply or change the status', 'error'); return; }
    setBusy(true);
    try {
      if (body.trim() || files.length || status !== t.status) {
        const r = await api.post(`/tickets/${t.ticket_no}/reply`, toForm({ body, internal: internal ? 1 : 0, status }, files));
        r.warnings?.forEach(w => toast(w, 'error'));
      }
      if (group && group !== t.group_name) await api.patch(`/tickets/${t.ticket_no}`, { group_name: group });
      toast(internal ? 'Note added' : body.trim() ? 'Reply sent' : 'Status changed');
      setBody(''); setFiles([]); setGroup(null);
      onSent();
    } catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <form className={`tk-reply${internal ? ' internal' : ''}`} onSubmit={submit}>
      <div className="row wrap" style={{ gap: 8 }}>
        <div className="subtabs" role="tablist" aria-label="Reply type">
          <button type="button" role="tab" aria-selected={!internal} className={!internal ? 'active' : ''} onClick={() => setInternal(false)}>Public reply</button>
          <button type="button" role="tab" aria-selected={internal} className={internal ? 'active' : ''} onClick={() => setInternal(true)}>Internal note</button>
        </div>
        {d.macros.length > 0 && (
          <select className="tk-macro" value="" onChange={(e) => applyMacro(e.target.value)} aria-label="Use a saved reply">
            <option value="">Saved replies…</option>
            {d.macros.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        )}
      </div>
      <textarea rows={4} maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)}
        placeholder={internal ? 'Note for the team (never shown to the requester)…' : 'Reply to the requester…'}
        onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') submit(e); }} />
      <div className="small muted tk-hint">{internal ? 'Internal notes are never shown or sent to the requester.' : d.reply_hint}</div>
      {group && group !== t.group_name && <div className="xs muted">Group will change to {group} when you submit.</div>}
      <div className="row wrap between" style={{ gap: 8 }}>
        <FilePicker files={files} onChange={setFiles} onError={(m) => toast(m, 'error')} />
        <div className="tk-submit">
          <button className="btn primary" disabled={busy}>{busy ? 'Sending…' : `Submit as ${STATUS[status].label}`}</button>
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status after submitting">
            {d.options.statuses.map(s => <option key={s} value={s}>{STATUS[s].label}</option>)}
          </select>
        </div>
      </div>
    </form>
  );
}
