// Remarks on a task: several short notes, each addressed to a chosen person (who gets an alert).
// Shown on the task page and, from the Task Board card, in a pop-up.
import { useState } from 'react';
import { api } from '../api.js';
import { useApp, useLoad } from '../context.jsx';
import Icon from '../components/Icon.jsx';
import { Avatar, Modal, Loading, ErrorBox, UserSelect, confirmDialog } from '../components/ui.jsx';
import { timeAgo, fmtDateTime } from '../lib/format.js';

export function RemarksList({ wpId, remarks, canAdd, canEdit, onChange }) {
  const { user, activeUsers, toast } = useApp();
  const [to, setTo] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const add = async (e) => {
    e.preventDefault();
    if (!to) { toast('Choose who the remark is for', 'error'); return; }
    if (!body.trim()) return;
    setBusy(true);
    try {
      const r = await api.post(`/work-packages/${wpId}/remarks`, { user_id: to, body });
      setBody(''); toast('Remark added'); onChange(r.remarks);
    } catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };
  const del = async (rm) => {
    if (!await confirmDialog({ message: 'Delete this remark?', confirmLabel: 'Delete', danger: true })) return;
    try { const r = await api.del(`/remarks/${rm.id}`); onChange(r.remarks); } catch (err) { toast(err.message, 'error'); }
  };
  return (
    <div className="remarks">
      {canAdd && (
        <form className="remark-form" onSubmit={add}>
          <div className="remark-to">
            <UserSelect value={to} onChange={(v) => setTo(v || '')} users={activeUsers} placeholder="Remark for…" />
          </div>
          <textarea rows={2} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write a remark…"
            onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') add(e); }} />
          <div className="row between">
            <span className="xs muted">The person you choose gets an alert.</span>
            <button className="btn sm primary" disabled={busy || !body.trim()}>{busy ? 'Adding…' : 'Add remark'}</button>
          </div>
        </form>
      )}
      {!remarks.length ? <p className="small muted" style={{ margin: '6px 0' }}>No remarks yet.</p> : (
        <ul className="remark-list">
          {remarks.map(rm => (
            <li key={rm.id}>
              <Avatar id={rm.user_id} name={rm.user_name || '?'} size="sm" />
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="small"><b>For {rm.user_name || 'a removed user'}</b> <span className="xs muted">· by {rm.created_by_name || 'someone'} · <span title={fmtDateTime(rm.created_at)}>{timeAgo(rm.created_at)}</span></span></div>
                <div className="remark-body">{rm.body}</div>
              </div>
              {(rm.created_by === user.id || canEdit) && (
                <button type="button" className="icon-btn" aria-label="Delete remark" title="Delete remark" onClick={() => del(rm)}><Icon name="trash" size={15} /></button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function RemarksModal({ wp, onClose, onChanged }) {
  const { data, error, loading, setData } = useLoad(() => api.get(`/work-packages/${wp.id}/remarks`), [wp.id]);
  return (
    <Modal title={`Remarks · ${wp.key}`} onClose={onClose} footer={<button type="button" className="btn" onClick={onClose}>Close</button>}>
      <div className="small muted" style={{ marginTop: -4 }}>{wp.subject}</div>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : data && (
        <RemarksList wpId={wp.id} remarks={data.remarks} canAdd={data.can_add} canEdit={data.can_edit}
          onChange={(remarks) => { setData(d => ({ ...d, remarks })); onChanged?.(remarks.length); }} />
      )}
    </Modal>
  );
}
