// Tickets Raised: the requester's side. Admins see every ticket; everyone else their own.
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useApp, useLoad } from '../../context.jsx';
import Icon from '../../components/Icon.jsx';
import { Loading, ErrorBox, Empty, Modal, Field } from '../../components/ui.jsx';
import { TicketStatus, TicketPriority, fmtLocal, fmtShort, FilePicker, toForm, AttachmentList, ThreadItem, FullEmailButton } from './common.jsx';
import RaiseTicketModal from './RaiseTicketModal.jsx';

const agePill = (days) => (days < 1 ? ['Today', 'ok'] : days <= 7 ? [`${days}d`, 'blue'] : days <= 30 ? [`${days}d`, 'amber'] : [`${days}d`, 'red']);

export default function TicketsRaised() {
  const [sp, setSp] = useSearchParams();
  const { data, error, loading, reload } = useLoad(() => api.get('/tickets-raised'), []);
  const [raise, setRaise] = useState(false);
  const [closing, setClosing] = useState(null);
  const open = sp.get('ticket');
  const setOpen = (no) => { const n = new URLSearchParams(sp); if (no) n.set('ticket', no); else n.delete('ticket'); setSp(n); };
  useEffect(() => {
    const on = () => reload();
    window.addEventListener('pt-ticket-created', on);
    return () => window.removeEventListener('pt-ticket-created', on);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (error && !data) return <div className="content"><ErrorBox error={error} /></div>;
  if (loading && !data) return <Loading />;
  const { tiles, rows } = data;
  return (
    <div className="content">
      <div className="page-head">
        <div className="grow"><h1>Tickets Raised</h1><p>{data.is_admin ? 'Every ticket raised, and where each one stands.' : 'Tickets you raised and where each one stands.'}</p></div>
        <div className="head-actions"><button type="button" className="btn primary" onClick={() => setRaise(true)}><Icon name="plus" />Raise ticket</button></div>
      </div>
      <div className="figures">
        <div className="figure"><div className="n">{tiles.total}</div><div className="l">Total</div></div>
        <div className="figure"><div className="n">{tiles.open}</div><div className="l">Open</div></div>
        <div className="figure"><div className="n">{tiles.closed}</div><div className="l">Closed</div></div>
        <div className="figure"><div className="n">{tiles.avg_ageing}<span className="small muted"> days</span></div><div className="l">Average ageing (open)</div></div>
      </div>
      <div className="panel">
        {!rows.length ? <Empty title="No tickets yet">Use “Raise ticket” to ask the support team for help.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Ticket</th><th>Raised on</th><th>Raised by</th><th>Description</th><th>Files</th><th>Age</th><th>State</th><th /></tr></thead>
              <tbody>
                {rows.map(t => {
                  const [ageLabel, tone] = agePill(t.age_days);
                  return (
                    <tr key={t.ticket_no}>
                      <td className="small num" style={{ textAlign: 'left' }}>#{t.ticket_no}</td>
                      <td className="small" title={fmtLocal(t.raised_on)}>{fmtShort(t.raised_on)}</td>
                      <td className="small">{t.raised_by}</td>
                      <td className="subject"><div className="ellipsis"><b>{t.subject_display}</b></div><div className="xs muted ellipsis">{t.description}</div></td>
                      <td className="small">{t.attachments.length ? <span title={t.attachments.map(a => a.file_name).join(', ')}><Icon name="paperclip" size={13} /> {t.attachments.length}</span> : <span className="muted">—</span>}</td>
                      <td><span className={`tk-age ${t.status === 'solved' ? 'done' : tone}`}>{ageLabel}</span></td>
                      <td><span className={`tk-simple ${t.simple_status.toLowerCase()}`}>{t.simple_status}</span></td>
                      <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                        <button type="button" className="btn sm" onClick={() => setOpen(t.ticket_no)}>View</button>
                        {data.is_admin && t.status !== 'solved' && <button type="button" className="btn sm" style={{ marginLeft: 6 }} onClick={() => setClosing(t)}>Close</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {open && <ConversationModal no={open} onClose={() => setOpen(null)} onChanged={reload} onCloseTicket={(t) => setClosing(t)} />}
      {closing && <CloseModal ticket={closing} onClose={() => setClosing(null)} onDone={() => { setClosing(null); reload(); }} />}
      {raise && <RaiseTicketModal onClose={() => { setRaise(false); reload(); }} />}
    </div>
  );
}

// The requester's view of the conversation: request, public replies and changes. Never internal notes.
function ConversationModal({ no, onClose, onChanged, onCloseTicket }) {
  const { toast } = useApp();
  const { data, error, loading, reload } = useLoad(() => api.get(`/tickets/${no}/thread`), [no]);
  const [body, setBody] = useState('');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const send = async (e) => {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    try {
      const r = await api.post(`/tickets/${no}/thread/reply`, toForm({ body }, files));
      r.warnings?.forEach(w => toast(w, 'error'));
      toast('Reply sent'); setBody(''); setFiles([]); reload(); onChanged();
    } catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };
  const t = data?.ticket;
  return (
    <Modal title={t ? `Ticket #${t.ticket_no}` : 'Ticket'} wide onClose={onClose}
      footer={<span className="small muted grow">You get an alert whenever the support team replies or changes this ticket.</span>}>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : data && (
        <>
          <div className="tk-conv-head">
            <h3 style={{ margin: 0 }}>{t.subject_display}</h3>
            <div className="row wrap" style={{ gap: 8, marginTop: 6 }}>
              <TicketStatus status={t.status} /><TicketPriority priority={t.priority} />
              <span className="small muted">Team: {t.group_name}</span>
              <span className="small muted">Handled by: {t.handled_by || 'Not assigned yet'}</span>
              {data.can.close && <button type="button" className="btn sm" style={{ marginLeft: 'auto' }} onClick={() => { onClose(); onCloseTicket({ ticket_no: t.ticket_no, subject_display: t.subject_display }); }}>Close ticket</button>}
            </div>
          </div>
          <div className="tk-thread modal-thread">
            <div className="tk-msg requester original">
              <span className="tk-initials" aria-hidden="true">{String(t.raised_by).split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('')}</span>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="tk-msg-head"><b>{t.raised_by}</b><span className="tag">Original request</span><span className="xs muted">{fmtLocal(t.raised_on)}</span></div>
                <div className="tk-body">{t.description}</div>
                <AttachmentList files={t.attachments} />
                <FullEmailButton email={t.email} />
              </div>
            </div>
            {data.messages.map(m => <ThreadItem key={m.id} m={m} />)}
          </div>
          {data.can.reply && (
            <form className="tk-reply" onSubmit={send}>
              <textarea rows={3} maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)}
                placeholder={t.status === 'solved' ? 'Reply to reopen this ticket…' : 'Reply to the support team…'} />
              <div className="row wrap between" style={{ gap: 8 }}>
                <FilePicker files={files} onChange={setFiles} onError={(m) => toast(m, 'error')} />
                <button className="btn primary" disabled={busy || !body.trim()}>{busy ? 'Sending…' : 'Send reply'}</button>
              </div>
            </form>
          )}
        </>
      )}
    </Modal>
  );
}

function CloseModal({ ticket, onClose, onDone }) {
  const { toast } = useApp();
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try { await api.post(`/tickets/${ticket.ticket_no}/close`, { notes }); toast(`Ticket ${ticket.ticket_no} closed`); onDone(); }
    catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Close ticket #${ticket.ticket_no}`} onClose={onClose} onSubmit={submit} footer={<>
      <button type="button" className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy}>{busy ? 'Closing…' : 'Close ticket'}</button>
    </>}>
      <div className="small">{ticket.subject_display}</div>
      <Field label="Closing notes" hint="Added to the ticket's conversation and sent to the requester.">
        <textarea rows={4} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What was done to resolve it." />
      </Field>
    </Modal>
  );
}
