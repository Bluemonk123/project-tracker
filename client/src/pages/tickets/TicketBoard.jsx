// Ticket Board dashboard: count cards, charts, saved views, filtered table, side panel.
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, qs } from '../../api.js';
import { useApp, useLoad } from '../../context.jsx';
import Icon from '../../components/Icon.jsx';
import { Loading, ErrorBox, Empty, Popover, Modal, Field, UserSelect } from '../../components/ui.jsx';
import { STATUS, PRIORITY, TYPE_LABEL, TicketStatus, TicketPriority, SlaBadge, fmtShort, fmtLocal, FilePicker, toForm, EmailToTicket } from './common.jsx';
import TicketScreen from './TicketScreen.jsx';

const CARDS = [
  ['total', 'Total'], ['solved', 'Solved'], ['unsolved', 'Unsolved'], ['unassigned', 'Unassigned'], ['breached', 'SLA breached'],
];
const GROUP_COLORS = ['#3B6EA8', '#2F7A6B', '#7A4FA3', '#B5662A', '#2E8A9A', '#9C4F6E', '#5B6B85', '#6E7A2E'];

export default function TicketBoard() {
  const { can } = useApp();
  const [sp, setSp] = useSearchParams();
  const params = { view: sp.get('view') || undefined, card: sp.get('card') || undefined, group: sp.get('group') || undefined, priority: sp.get('priority') || undefined, status: sp.get('status') || undefined };
  const { data, error, loading, reload } = useLoad(() => api.get('/ticket-board' + qs(params)), [sp.toString().replace(/(^|&)ticket=\d+/, '')]);
  const [newOpen, setNewOpen] = useState(false);
  const open = sp.get('ticket');
  const setParam = (changes) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(changes)) { if (v === null || v === undefined || v === '') next.delete(k); else next.set(k, v); }
    setSp(next, { replace: false });
  };
  useEffect(() => {
    const on = () => reload();
    window.addEventListener('pt-ticket-created', on);
    const timer = setInterval(() => { if (document.visibilityState === 'visible') reload(); }, 60000);
    return () => { window.removeEventListener('pt-ticket-created', on); clearInterval(timer); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.modal-backdrop')) setParam({ ticket: null }); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  if (!can('tickets.view')) return <div className="content"><Empty title="No access">The Ticket Board needs the “Ticket Board: Enable” permission. Ask an administrator.</Empty></div>;
  if (error && !data) return <div className="content"><ErrorBox error={error} /></div>;
  if (!data) return <Loading />;
  const multi = (key) => (sp.get(key) || '').split(',').filter(Boolean);

  return (
    <div className="content wide">
      <div className="page-head">
        <div className="grow"><h1>Ticket Board</h1><p>Support tickets from raise to solved: triage, assign, reply and keep within the SLA.<EmailToTicket /></p></div>
        <div className="head-actions">
          {data.can.add && <button type="button" className="btn primary" onClick={() => setNewOpen(true)}><Icon name="plus" />New ticket</button>}
        </div>
      </div>

      <div className="figures tk-cards">
        {CARDS.map(([k, l]) => (
          <button type="button" key={k} className={`figure${data.card === k ? ' active' : ''}${k === 'breached' && data.counts.breached ? ' danger' : ''}`}
            onClick={() => setParam({ card: data.card === k ? null : k, view: null })} aria-pressed={data.card === k}>
            <div className="n">{data.counts[k]}</div><div className="l">{l}</div>
          </button>
        ))}
      </div>

      <div className="tk-charts">
        <BarChart title="Tickets by status" rows={Object.entries(data.charts.status).map(([k, n]) => ({ label: STATUS[k].label, n, color: STATUS[k].color }))} />
        <BarChart title="Tickets by priority" rows={Object.entries(data.charts.priority).map(([k, n]) => ({ label: PRIORITY[k].label, n, color: PRIORITY[k].color }))} />
        <BarChart title="Tickets by group" rows={Object.entries(data.charts.group).map(([k, n], i) => ({ label: k, n, color: GROUP_COLORS[i % GROUP_COLORS.length] }))} />
      </div>

      <div className="tk-layout">
        <nav className="panel tk-views" aria-label="Saved views">
          <div className="panel-head"><h3>Views</h3></div>
          <ul className="list">
            {data.views.map(v => (
              <li key={v.key}>
                <button type="button" className={`tk-view${!data.card && data.view === v.key ? ' active' : ''}`} onClick={() => setParam({ view: v.key, card: null })}>
                  <span className="grow">{v.label}</span><span className="tk-count">{v.count}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <section className="panel" style={{ minWidth: 0 }}>
          <div className="panel-head">
            <h3>{data.card ? CARDS.find(c => c[0] === data.card)[1] : data.views.find(v => v.key === data.view)?.label}</h3>
            <span className="xs muted">{data.matching > data.rows.length ? `showing ${data.rows.length} of ${data.matching}` : `${data.matching} ticket${data.matching === 1 ? '' : 's'}`}</span>
            <div className="actions">
              <MultiFilter label="Group" options={data.groups.map(g => [g, g])} value={multi('group')} onChange={(v) => setParam({ group: v.join(',') })} />
              <MultiFilter label="Priority" options={Object.entries(PRIORITY).map(([k, p]) => [k, p.label])} value={multi('priority')} onChange={(v) => setParam({ priority: v.join(',') })} />
              <MultiFilter label="Status" options={Object.entries(STATUS).map(([k, s]) => [k, s.label])} value={multi('status')} onChange={(v) => setParam({ status: v.join(',') })} />
            </div>
          </div>
          {!data.rows.length ? <Empty small title="No tickets here">Try another view or clear the filters.</Empty> : (
            <div className="table-wrap tk-table-wrap">
              <table className="table tk-table">
                <thead><tr>
                  <th>Status</th><th>Subject</th><th>Requester</th><th>Created</th><th>Updated</th><th>Group</th><th>Assignee</th><th>Priority</th><th>SLA</th><th>Age</th>
                </tr></thead>
                <tbody>
                  {data.rows.map(t => (
                    <tr key={t.id} className={String(t.ticket_no) === open ? 'selected' : ''} tabIndex={0} style={{ cursor: 'pointer' }}
                      onClick={() => setParam({ ticket: t.ticket_no })} onKeyDown={(e) => { if (e.key === 'Enter') setParam({ ticket: t.ticket_no }); }}>
                      <td><TicketStatus status={t.status} /></td>
                      <td className="subject">
                        <div className="ellipsis"><span className="xs muted">#{t.ticket_no}</span> <b>{t.subject_display}</b></div>
                        <div className="xs muted ellipsis">{t.preview}</div>
                      </td>
                      <td className="small">{t.requester_display}</td>
                      <td className="small" title={fmtLocal(t.raised_on)}>{fmtShort(t.raised_on)}</td>
                      <td className="small" title={fmtLocal(t.updated_at)}>{fmtShort(t.updated_at)}</td>
                      <td className="small">{t.group_name}</td>
                      <td className="small">{t.assignee_name || <span className="muted">—</span>}</td>
                      <td><TicketPriority priority={t.priority} /></td>
                      <td><SlaBadge sla={t.sla} /></td>
                      <td className="small num">{t.age}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {open && (
        <div className="tk-drawer-wrap" onMouseDown={(e) => { if (e.target === e.currentTarget) setParam({ ticket: null }); }}>
          <div className="tk-drawer" role="dialog" aria-label={`Ticket ${open}`}>
            <TicketScreen no={open} embedded onChanged={reload} onClose={() => setParam({ ticket: null })} />
          </div>
        </div>
      )}
      {newOpen && <NewTicketModal groups={data.active_groups} onClose={() => setNewOpen(false)} onCreated={(no) => { setNewOpen(false); reload(); setParam({ ticket: no }); }} />}
    </div>
  );
}

function BarChart({ title, rows }) {
  const max = Math.max(1, ...rows.map(r => r.n));
  return (
    <div className="panel tk-chart">
      <div className="panel-head"><h3>{title}</h3></div>
      <div className="panel-body">
        {rows.map(r => (
          <div key={r.label} className="tk-bar-row">
            <span className="small ellipsis" title={r.label}>{r.label}</span>
            <span className="tk-bar"><span style={{ width: `${(r.n / max) * 100}%`, background: r.color }} /></span>
            <span className="small num">{r.n}</span>
          </div>
        ))}
        {!rows.length && <div className="small muted">No groups.</div>}
      </div>
    </div>
  );
}

function MultiFilter({ label, options, value, onChange }) {
  return (
    <Popover trigger={({ toggle }) => (
      <button type="button" className={`btn sm${value.length ? ' tk-filter-on' : ''}`} onClick={toggle}>
        <Icon name="filter" />{label}{value.length ? ` (${value.length})` : ''}
      </button>
    )}>
      {options.map(([k, l]) => (
        <label key={k} className="menu-item check">
          <input type="checkbox" checked={value.includes(k)} onChange={(e) => onChange(e.target.checked ? [...value, k] : value.filter(x => x !== k))} />{l}
        </label>
      ))}
      {value.length > 0 && <><div className="menu-sep" /><button type="button" className="menu-item" onClick={() => onChange([])}>Clear</button></>}
    </Popover>
  );
}

// Agent "New ticket": requester is a user, or a typed name (and optional email).
function NewTicketModal({ groups, onClose, onCreated }) {
  const { activeUsers, toast } = useApp();
  const [mode, setMode] = useState('user');
  const [f, setF] = useState({ requester_user_id: '', requester_name: '', requester_email: '', subject: '', priority: 'normal', ticket_type: 'issue', group_name: groups.includes('Support') ? 'Support' : groups[0], description: '' });
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async () => {
    if (mode === 'user' && !f.requester_user_id) { setError(new Error('Pick the requester.')); return; }
    if (mode === 'name' && !f.requester_name.trim()) { setError(new Error("Type the requester's name.")); return; }
    setBusy(true); setError(null);
    const body = { ...f };
    if (mode === 'user') { delete body.requester_name; delete body.requester_email; } else delete body.requester_user_id;
    try {
      const r = await api.post('/ticket-board/tickets', toForm(body, files));
      r.warnings?.forEach(w => toast(w, 'error'));
      toast(`Ticket ${r.ticket_no} created`);
      onCreated(r.ticket_no);
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Modal title="New ticket" wide onClose={onClose} onSubmit={submit} footer={<>
      <button type="button" className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy}>{busy ? 'Creating…' : 'Create ticket'}</button>
    </>}>
      <ErrorBox error={error} />
      <Field label="Requester">
        <div className="subtabs" style={{ marginBottom: 8 }}>
          <button type="button" className={mode === 'user' ? 'active' : ''} onClick={() => setMode('user')}>Pick a user</button>
          <button type="button" className={mode === 'name' ? 'active' : ''} onClick={() => setMode('name')}>Type a name</button>
        </div>
        {mode === 'user'
          ? <UserSelect value={f.requester_user_id} onChange={(v) => setF({ ...f, requester_user_id: v || '' })} users={activeUsers} placeholder="Choose a person" />
          : <div className="grid-2" style={{ gap: 10 }}>
              <input type="text" placeholder="Name" maxLength={100} value={f.requester_name} onChange={set('requester_name')} />
              <input type="email" placeholder="Email (optional)" maxLength={254} value={f.requester_email} onChange={set('requester_email')} />
            </div>}
      </Field>
      <Field label="Subject"><input type="text" required maxLength={200} value={f.subject} onChange={set('subject')} /></Field>
      <div className="grid-3" style={{ gap: 12 }}>
        <Field label="Priority"><select value={f.priority} onChange={set('priority')}>{Object.entries(PRIORITY).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}</select></Field>
        <Field label="Type"><select value={f.ticket_type} onChange={set('ticket_type')}>{Object.entries(TYPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Group"><select value={f.group_name} onChange={set('group_name')}>{groups.map(g => <option key={g} value={g}>{g}</option>)}</select></Field>
      </div>
      <Field label="Description"><textarea rows={6} required maxLength={5000} value={f.description} onChange={set('description')} /></Field>
      <FilePicker files={files} onChange={setFiles} onError={(m) => toast(m, 'error')} />
    </Modal>
  );
}
