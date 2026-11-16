// "Raise Ticket" in the top bar: any signed-in member of staff.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { useApp } from '../../context.jsx';
import { Modal, Field, ErrorBox } from '../../components/ui.jsx';
import { FilePicker, toForm } from './common.jsx';

export default function RaiseTicketModal({ onClose }) {
  const { toast } = useApp();
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const submit = async () => {
    if (!description.trim()) { setError(new Error('Describe the problem or request.')); return; }
    setBusy(true); setError(null);
    try {
      const r = await api.post('/tickets/raise', toForm({ subject, description }, files));
      setDone(r);
      window.dispatchEvent(new Event('pt-ticket-created'));
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  if (done) {
    return (
      <Modal title="Ticket raised" onClose={onClose} footer={<>
        <Link className="btn" to={`/tickets-raised?ticket=${done.ticket_no}`} onClick={onClose}>View in Tickets Raised</Link>
        <button type="button" className="btn primary" onClick={onClose}>Done</button>
      </>}>
        <div className="tk-done">
          <div className="xs muted">Your ticket number</div>
          <div className="tk-done-no">{done.ticket_no}</div>
          <p className="small muted">The support team has been alerted. You get an alert whenever they reply or change this ticket.</p>
        </div>
        {done.warnings?.length > 0 && <div className="warn-box">{done.warnings.map(w => <div key={w}>{w}</div>)}</div>}
      </Modal>
    );
  }
  return (
    <Modal title="Raise a ticket" onClose={onClose} onSubmit={submit} footer={<>
      <button type="button" className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy}>{busy ? 'Sending…' : 'Raise ticket'}</button>
    </>}>
      <ErrorBox error={error} />
      <Field label="Subject" hint="Optional. A short summary, e.g. “Printer on floor 2 offline”.">
        <input type="text" maxLength={200} value={subject} onChange={(e) => setSubject(e.target.value)} />
      </Field>
      <Field label="Description" hint={`${description.length} / 5000`}>
        <textarea rows={6} maxLength={5000} required value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder="What happened, what you expected, and any steps to see the problem." />
      </Field>
      <FilePicker files={files} onChange={setFiles} onError={(m) => toast(m, 'error')} />
    </Modal>
  );
}
