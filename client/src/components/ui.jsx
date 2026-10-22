import { useEffect, useRef, useState, useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import Icon from './Icon.jsx';
import { useApp } from '../context.jsx';
import { initials, personColor, dueLabel, PROJECT_STATUS } from '../lib/format.js';

marked.setOptions({ gfm: true, breaks: true });

export function Modal({ title, onClose, children, footer, wide, onSubmit }) {
  const ref = useRef(null);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    const first = ref.current?.querySelector('input:not([type=hidden]), select, textarea');
    first?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  const Wrap = onSubmit ? 'form' : 'div';
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <Wrap className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}
        onSubmit={onSubmit ? (e) => { e.preventDefault(); onSubmit(e); } : undefined}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </Wrap>
    </div>
  );
}

export function Avatar({ id, name, size }) {
  if (!name) return null;
  return <span className={`avatar${size ? ` ${size}` : ''}`} style={{ '--c': personColor(id) }} title={name}>{initials(name)}</span>;
}
export function Person({ id, name, size = 'sm', muted }) {
  if (!name) return <span className="muted">{muted ?? '—'}</span>;
  return <span className="person"><Avatar id={id} name={name} size={size} /><span className="ellipsis">{name}</span></span>;
}

export const Pill = ({ color, children, square, noDot }) => (
  <span className={`pill${square ? ' square' : ''}${noDot ? ' no-dot' : ''}`} style={{ '--c': color }}>{children}</span>
);
export const StatusPill = ({ name, color }) => <Pill color={color}>{name}</Pill>;
export const TypeLabel = ({ name, color }) => <span className="type-label" style={{ '--c': color }}>{name}</span>;
export function Priority({ name, color, position }) {
  const level = Math.min(3, (position ?? 1) + 0);
  return (
    <span className="prio" style={{ '--c': color }} title={`${name} priority`}>
      <i>{[1, 2, 3].map(n => <b key={n} className={n <= Math.max(1, level) ? 'on' : ''} />)}</i>{name}
    </span>
  );
}
export function Due({ date, closed }) {
  const d = dueLabel(date, closed);
  if (!d) return <span className="muted">—</span>;
  return <span className={`due ${d.tone}`}>{d.text}</span>;
}
export const Key = ({ k, color }) => <span className="key" style={{ '--pc': color }}>{k}</span>;
export function Progress({ value, color }) {
  return (
    <span className="progress-row">
      <span className="progress" role="progressbar" aria-valuenow={value || 0} aria-valuemin="0" aria-valuemax="100"><span style={{ width: `${value || 0}%`, '--c': color }} /></span>
      <span className="small muted num" style={{ width: 34, textAlign: 'right' }}>{Math.round(value || 0)}%</span>
    </span>
  );
}
export function ProjectStatus({ status }) {
  const s = PROJECT_STATUS[status] || PROJECT_STATUS.not_set;
  return <Pill color={s.color}>{s.label}</Pill>;
}

export const Loading = () => <div className="loading"><span className="spinner" aria-label="Loading" /></div>;
export const ErrorBox = ({ error }) => (error ? <div className="error-box" role="alert">{error.message || String(error)}</div> : null);
export function Empty({ title, children, action, small }) {
  return (
    <div className={`empty${small ? ' small' : ''}`}>
      {title && <h3>{title}</h3>}
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Field({ label, hint, children, className = '', htmlFor }) {
  return (
    <div className={`field ${className}`}>
      {label && <label htmlFor={htmlFor}>{label}</label>}
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function Popover({ trigger, children, align = 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <span className="popover-wrap" ref={ref}>
      {trigger({ open, toggle: () => setOpen(o => !o) })}
      {open && <div className={`popover ${align}`} onClick={(e) => { if (e.target.closest('.menu-item')) setOpen(false); }}>{children}</div>}
    </span>
  );
}
export function MoreMenu({ children, label = 'More actions' }) {
  return (
    <Popover trigger={({ toggle }) => (
      <button type="button" className="btn icon sm ghost" onClick={toggle} aria-label={label}><Icon name="more" /></button>
    )}>{children}</Popover>
  );
}

// Confirm dialog as a hook: const confirm = useConfirm(); if (await confirm('Delete?')) ...
let confirmSetter = null;
export function ConfirmHost() {
  const [req, setReq] = useState(null);
  confirmSetter = setReq;
  if (!req) return null;
  const close = (v) => { req.resolve(v); setReq(null); };
  return (
    <Modal title={req.title || 'Are you sure?'} onClose={() => close(false)} footer={<>
      <button className="btn" onClick={() => close(false)}>Cancel</button>
      <button className={`btn ${req.danger ? 'danger solid' : 'primary'}`} onClick={() => close(true)} autoFocus>{req.confirmLabel || 'Confirm'}</button>
    </>}>
      <p style={{ margin: 0 }}>{req.message}</p>
    </Modal>
  );
}
export const confirmDialog = (opts) => new Promise(resolve => confirmSetter?.({ ...opts, resolve }));

export function Toasts() {
  const { toasts } = useApp();
  return <div className="toasts" role="status" aria-live="polite">{toasts.map(t => <div key={t.id} className={`toast ${t.kind}`}>{t.message}</div>)}</div>;
}

// ---------- markdown ----------
const MENTION = /@\[([^\]]+)\]\(user:(\d+)\)/g;
export function renderMarkdown(text) {
  if (!text) return '';
  const pre = String(text)
    .replace(MENTION, (_m, name) => `<span class="mention">@${name.replace(/[<>&"]/g, '')}</span>`)
    .replace(/(^|[\s(])#(\d{1,7})\b/g, (_m, s, id) => `${s}<a href="/wp/${id}">#${id}</a>`);
  return DOMPurify.sanitize(marked.parse(pre), { ADD_ATTR: ['target'] });
}
export function Markdown({ text, className = '' }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  if (!text) return null;
  return <div className={`md ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

// Textarea with preview and @mentions
export function MarkdownEditor({ value, onChange, placeholder, rows = 6, autoFocus, onSubmitShortcut, mentionUsers }) {
  const { activeUsers } = useApp();
  const pool = mentionUsers || activeUsers;
  const [tab, setTab] = useState('write');
  const [mention, setMention] = useState(null); // { start, query }
  const [hl, setHl] = useState(0);
  const ta = useRef(null);
  const matches = mention ? pool.filter(u => u.name.toLowerCase().includes(mention.query.toLowerCase())).slice(0, 6) : [];

  const onInput = (e) => {
    onChange(e.target.value);
    const pos = e.target.selectionStart;
    const before = e.target.value.slice(0, pos);
    const m = before.match(/(^|\s)@([\w.-]{0,20})$/);
    if (m) { setMention({ start: pos - m[2].length - 1, query: m[2] }); setHl(0); } else setMention(null);
  };
  const pick = (u) => {
    const el = ta.current;
    const pos = el.selectionStart;
    const next = value.slice(0, mention.start) + `@[${u.name}](user:${u.id}) ` + value.slice(pos);
    onChange(next);
    setMention(null);
    requestAnimationFrame(() => { el.focus(); const p = mention.start + u.name.length + String(u.id).length + 11; el.setSelectionRange(p, p); });
  };
  const onKeyDown = (e) => {
    if (mention && matches.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setHl(h => (h + 1) % matches.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setHl(h => (h - 1 + matches.length) % matches.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(matches[hl]); return; }
      if (e.key === 'Escape') { setMention(null); return; }
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && onSubmitShortcut) { e.preventDefault(); onSubmitShortcut(); }
  };
  return (
    <div>
      <div className="editor-tabs">
        <button type="button" className={tab === 'write' ? 'active' : ''} onClick={() => setTab('write')}>Write</button>
        <button type="button" className={tab === 'preview' ? 'active' : ''} onClick={() => setTab('preview')}>Preview</button>
        <span className="xs muted" style={{ marginLeft: 'auto', alignSelf: 'center' }}>Markdown works here. Type @ to mention someone.</span>
      </div>
      {tab === 'write' ? (
        <div className="editor-wrap">
          {mention && matches.length > 0 && (
            <div className="mention-pop" role="listbox">
              {matches.map((u, i) => (
                <button type="button" key={u.id} className="menu-item" style={i === hl ? { background: 'var(--sunken)' } : undefined}
                  onMouseDown={(e) => { e.preventDefault(); pick(u); }}>
                  <Avatar id={u.id} name={u.name} size="sm" />{u.name}<span className="xs muted">{u.job_title}</span>
                </button>
              ))}
            </div>
          )}
          <textarea ref={ta} value={value || ''} onChange={onInput} onKeyDown={onKeyDown} rows={rows} placeholder={placeholder} autoFocus={autoFocus} />
        </div>
      ) : (
        <div className="md-preview">{value ? <Markdown text={value} /> : <span className="muted">Nothing to preview yet.</span>}</div>
      )}
    </div>
  );
}

// ---------- selects ----------
export function UserSelect({ value, onChange, users, placeholder = 'Unassigned', allowEmpty = true, disabled, id, includeMe }) {
  const { activeUsers, user } = useApp();
  const list = users || activeUsers;
  return (
    <select id={id} value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}>
      {allowEmpty && <option value="">{placeholder}</option>}
      {includeMe && user && <option value={user.id}>Me ({user.name})</option>}
      {list.filter(u => !includeMe || u.id !== user?.id).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
    </select>
  );
}

export function MultiUserPicker({ value = [], onChange, users }) {
  const { activeUsers } = useApp();
  const list = users || activeUsers;
  const [q, setQ] = useState('');
  const selected = list.filter(u => value.includes(u.id));
  const options = list.filter(u => !value.includes(u.id) && u.name.toLowerCase().includes(q.toLowerCase())).slice(0, 8);
  return (
    <div className="stack tight">
      <div className="row wrap">
        {selected.map(u => (
          <span key={u.id} className="tag" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 4px 3px 8px' }}>
            {u.name}
            <button type="button" className="icon-btn" style={{ padding: 0 }} aria-label={`Remove ${u.name}`} onClick={() => onChange(value.filter(v => v !== u.id))}><Icon name="x" size={12} /></button>
          </span>
        ))}
        {!selected.length && <span className="small muted">Nobody selected yet.</span>}
      </div>
      <Popover align="left" trigger={({ toggle }) => (
        <button type="button" className="btn sm" onClick={toggle}><Icon name="plus" />Add people</button>
      )}>
        <input type="search" placeholder="Search people" value={q} onChange={(e) => setQ(e.target.value)} autoFocus style={{ marginBottom: 4 }} />
        {options.map(u => (
          <button type="button" key={u.id} className="menu-item" onClick={() => { onChange([...value, u.id]); setQ(''); }}>
            <Avatar id={u.id} name={u.name} size="sm" />{u.name}
          </button>
        ))}
        {!options.length && <div className="small muted" style={{ padding: 8 }}>No more people match.</div>}
        {list.length > value.length && (
          <><div className="menu-sep" /><button type="button" className="menu-item" onClick={() => onChange(list.map(u => u.id))}>Add everyone listed</button></>
        )}
      </Popover>
    </div>
  );
}

export const COLORS = ['#0070C0', '#F39219', '#33B014', '#0B3A7A', '#4D4D4D', '#2F7A6B', '#3B6EA8', '#7A4FA3', '#B5662A', '#C2453B', '#2E8A9A', '#9C4F6E', '#6E7A2E', '#5B6B85', '#C98A1B', '#1F2933', '#8A5A44'];
export function ColorPicker({ value, onChange }) {
  return (
    <div className="row">
      <div className="color-swatches">
        {COLORS.map(c => <button type="button" key={c} className={value === c ? 'on' : ''} style={{ background: c }} onClick={() => onChange(c)} aria-label={`Colour ${c}`} />)}
      </div>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} aria-label="Custom colour" />
    </div>
  );
}

export function useAsync() {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const run = async (fn, success) => {
    setBusy(true);
    try {
      const r = await fn();
      if (success) toast(success);
      return r;
    } catch (e) {
      toast(e.message, 'error');
      return undefined; // callers treat undefined as failure
    } finally { setBusy(false); }
  };
  return [busy, run];
}
