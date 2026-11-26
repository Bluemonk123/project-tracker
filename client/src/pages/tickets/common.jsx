// Shared pieces for the Ticket Board, Tickets Raised and the Raise Ticket forms.
import { useEffect, useRef, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { Modal, Loading, ErrorBox } from '../../components/ui.jsx';
import { api } from '../../api.js';
import { fmtSize, utc, pad } from '../../lib/format.js';

export const STATUS = {
  open: { label: 'Open', color: '#e34f32' },
  pending: { label: 'Pending', color: '#3091ec' },
  hold: { label: 'On hold', color: '#2f3941' },
  solved: { label: 'Solved', color: '#87929d' },
};
export const PRIORITY = {
  urgent: { label: 'Urgent', color: '#cc3340' },
  high: { label: 'High', color: '#ed961c' },
  normal: { label: 'Normal', color: '#68737d' },
};
export const TYPE_LABEL = { issue: 'Issue', feedback: 'Feedback', feature: 'Feature', task: 'Task' };
export const CHANNEL = { web: { label: 'Web', icon: 'link' }, email: { label: 'Email', icon: 'chat' }, agent: { label: 'Agent', icon: 'user' } };

// Criticality of a task (C1 highest)
export const CritTag = ({ name, color }) => <span className="crit-tag" style={{ '--c': color }} title={`Criticality ${name}`}>{name}</span>;

// Where a task came from
export const SOURCE = { project: { label: 'Project', icon: 'folder' }, ticket: { label: 'Ticket', icon: 'ticket' }, email: { label: 'Email', icon: 'chat' } };
export const SourceTag = ({ source }) => {
  const s = SOURCE[source] || SOURCE.project;
  return <span className={`src-tag ${source || 'project'}`} title={`Source: ${s.label}`}><Icon name={s.icon} size={12} />{s.label}</span>;
};

export const TicketStatus = ({ status }) => {
  const s = STATUS[status] || STATUS.open;
  return <span className="tk-status" style={{ '--c': s.color }}>{s.label}</span>;
};
export const TicketPriority = ({ priority }) => {
  const p = PRIORITY[priority] || PRIORITY.normal;
  return <span className="tk-prio" style={{ '--c': p.color }}>{p.label}</span>;
};
export function SlaBadge({ sla }) {
  if (!sla || sla.state === 'none') return <span className="muted">—</span>;
  return <span className={`tk-sla ${sla.state}`} title={sla.due_at ? `Due ${fmtLocal(sla.due_at)}` : 'SLA clock paused while on hold'}>{sla.label}</span>;
}
export const ChannelIcon = ({ channel }) => {
  const c = CHANNEL[channel] || CHANNEL.web;
  return <span className="tk-channel" title={`Channel: ${c.label}`}><Icon name={c.icon} size={14} />{c.label}</span>;
};

// Ticket times are ISO UTC strings; show them in the viewer's local time.
export function fmtLocal(s) {
  const d = utc(s);
  if (!d) return '';
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined, hour: '2-digit', minute: '2-digit' });
}
export function fmtShort(s) {
  const d = utc(s);
  if (!d) return '';
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}

// ---------- attachments ----------
export const ALLOWED_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'doc', 'xls', 'ppt', 'docx', 'xlsx', 'pptx', 'zip'];
export const MAX_FILES = 2;
export const MAX_BYTES = 5 * 1024 * 1024;
const extOf = (n) => (String(n).split('.').pop() || '').toLowerCase();

// Picks up to 2 files; refuses the wrong type or size before anything is sent (the server checks again).
export function FilePicker({ files, onChange, onError, disabled }) {
  const input = useRef(null);
  const add = (list) => {
    const next = [...files];
    for (const f of list) {
      if (!ALLOWED_EXT.includes(extOf(f.name))) { onError?.(`${f.name}: this file type is not allowed.`); continue; }
      if (f.size > MAX_BYTES) { onError?.(`${f.name} is over 5 MB.`); continue; }
      if (next.length >= MAX_FILES) { onError?.(`Attach at most ${MAX_FILES} files.`); break; }
      next.push(f);
    }
    onChange(next);
  };
  return (
    <div className="tk-files">
      {files.map((f, i) => (
        <span key={`${f.name}${i}`} className="tk-file"><Icon name="paperclip" size={13} /><span className="ellipsis">{f.name}</span><span className="xs muted">{fmtSize(f.size)}</span>
          <button type="button" className="btn icon xs ghost" onClick={() => onChange(files.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`}><Icon name="x" size={12} /></button>
        </span>
      ))}
      {files.length < MAX_FILES && (
        <button type="button" className="btn sm ghost" disabled={disabled} onClick={() => input.current?.click()}>
          <Icon name="paperclip" />Attach file
        </button>
      )}
      <input ref={input} type="file" hidden multiple accept={ALLOWED_EXT.map(e => `.${e}`).join(',')}
        onChange={(e) => { add([...e.target.files]); e.target.value = ''; }} />
      <span className="xs muted">Up to 2 files, 5 MB each: images, PDF, Office or zip.</span>
    </div>
  );
}

export function toForm(fields, files = []) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null) fd.append(k, String(v));
  files.forEach(f => fd.append('files', f));
  return fd;
}

export function AttachmentList({ files }) {
  if (!files?.length) return null;
  return (
    <div className="tk-attachments">
      {files.map(f => (/^image\//.test(f.mime_type || '')
        ? <a key={f.id} href={`/api/ticket-attachments/${f.id}?inline=1`} target="_blank" rel="noreferrer" className="tk-thumb" title={f.file_name}>
            <img src={`/api/ticket-attachments/${f.id}?inline=1`} alt={f.file_name} loading="lazy" />
          </a>
        : <a key={f.id} href={`/api/ticket-attachments/${f.id}`} className="tk-file link"><Icon name="paperclip" size={13} /><span className="ellipsis">{f.file_name}</span>
            {f.size_bytes ? <span className="xs muted">{fmtSize(f.size_bytes)}</span> : null}</a>))}
    </div>
  );
}

// The whole original email (with the earlier messages it quotes), for tickets and replies that came by email.
// The email's own formatting is shown in a locked-down frame: no scripts, no outside images or links loaded.
const FRAME_CSP = "default-src 'none'; img-src data: cid:; style-src 'unsafe-inline'; font-src data:";
function FullEmailModal({ id, onClose }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [view, setView] = useState('formatted');
  useEffect(() => { api.get(`/ticket-emails/${id}`).then(setD, setErr); }, [id]);
  const doc = d?.html ? `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}">
    <base target="_blank"><style>body{font:14px/1.5 system-ui,sans-serif;margin:12px;color:#1f2933;background:#fff;word-wrap:break-word}img{max-width:100%;height:auto}blockquote{margin:8px 0 8px 4px;padding-left:10px;border-left:3px solid #d0d5db}</style></head><body>${d.html}</body></html>` : null;
  return (
    <Modal title={d ? (d.subject || 'Email') : 'Full email'} wide="xl" onClose={onClose}
      footer={<><a className="btn" href={`/api/ticket-emails/${id}/download`}><Icon name="download" size={15} />Download (.eml)</a><button type="button" className="btn primary" onClick={onClose}>Close</button></>}>
      {err ? <ErrorBox error={err} /> : !d ? <Loading /> : (
        <div className="tk-mail">
          <dl className="tk-mail-head">
            <dt>From</dt><dd>{d.from || '—'}</dd>
            {d.to && <><dt>To</dt><dd>{d.to}</dd></>}
            {d.cc && <><dt>Cc</dt><dd>{d.cc}</dd></>}
            <dt>Date</dt><dd>{d.date ? fmtLocal(d.date) : '—'}</dd>
            {d.attachments.length > 0 && <><dt>Files</dt><dd>{d.attachments.map(a => `${a.name} (${fmtSize(a.size)})`).join(', ')}</dd></>}
          </dl>
          {doc && (
            <div className="subtabs" style={{ alignSelf: 'flex-start' }}>
              <button type="button" className={view === 'formatted' ? 'active' : ''} onClick={() => setView('formatted')}>As sent</button>
              <button type="button" className={view === 'text' ? 'active' : ''} onClick={() => setView('text')}>Plain text</button>
            </div>
          )}
          {doc && view === 'formatted'
            ? <iframe className="tk-mail-frame" title="Email content" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={doc} referrerPolicy="no-referrer" />
            : <pre className="tk-mail-text">{d.text || '(no text)'}</pre>}
        </div>
      )}
    </Modal>
  );
}
export function FullEmailButton({ email }) {
  const [open, setOpen] = useState(false);
  if (!email) return null;
  return (
    <>
      <button type="button" className="tk-file link tk-mail-btn" onClick={() => setOpen(true)} title="The whole email as received, including the earlier messages in the trail">
        <Icon name="mail" size={13} /><span>View full email</span>{email.size_bytes ? <span className="xs muted">{fmtSize(email.size_bytes)}</span> : null}
      </button>
      {open && <FullEmailModal id={email.id} onClose={() => setOpen(false)} />}
    </>
  );
}

// One line of the conversation: original request, public reply, internal note or system event.
export function ThreadItem({ m }) {
  if (m.author_type === 'system') {
    return <div className="tk-event">{m.body} · {m.author_name} · {fmtLocal(m.created_at)}</div>;
  }
  const initials = String(m.author_name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('');
  return (
    <div className={`tk-msg${m.is_internal ? ' internal' : ''}${m.author_type === 'requester' ? ' requester' : ''}`}>
      <span className="tk-initials" aria-hidden="true">{initials}</span>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="tk-msg-head">
          <b>{m.author_name}</b>
          {m.is_internal ? <span className="tk-note-badge">Internal note</span> : null}
          {m.author_type === 'requester' ? <span className="tag">Requester</span> : null}
          <span className="xs muted">{fmtLocal(m.created_at)}</span>
        </div>
        {m.body ? <div className="tk-body">{m.body}</div> : null}
        <AttachmentList files={m.attachments} />
        <FullEmailButton email={m.email} />
      </div>
    </div>
  );
}
