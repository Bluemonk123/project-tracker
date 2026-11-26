// Task Board: a ticket dropped on a stage becomes a task. A short form: headline, module and problem, then
// project / assignee, priority / type and sprint. The ticket's files and the link back are added by the server.
import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { useApp } from '../../context.jsx';
import { Modal, Field, MarkdownEditor } from '../../components/ui.jsx';
import ModuleInput from '../ModuleInput.jsx';
import { useProjectInfo } from '../NewWpModal.jsx';
import { fmtDate } from '../../lib/format.js';
import { FullEmailButton } from './common.jsx';

// Due date preview: the Nth working day counting today (weekly off days and holidays skipped), like the server.
function dueFrom(cal, days) {
  if (!cal || !(days > 0)) return null;
  const off = new Set(cal.off_days || []); const hol = new Set((cal.holidays || []).map(h => h.day));
  const d = new Date(); d.setHours(12, 0, 0, 0);
  let left = days;
  for (let i = 0; i < 3660; i++) {
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!off.has(d.getDay()) && !hol.has(iso)) { left--; if (!left) return iso; }
    d.setDate(d.getDate() + 1);
  }
  return null;
}

export default function ConvertTicketModal({ ticket, column, sprints = [], defaultSprint = null, defaultProject = null, onClose, onCreated }) {
  const { meta, projects, activeUsers, toast } = useApp();
  const writable = projects.filter(p => !p.archived);
  const defPrio = meta.priorities.find(p => p.is_default)?.id || meta.priorities[0]?.id;
  const taskType = meta.types.find(t => t.name === 'Task')?.id || meta.types[0]?.id;
  const [f, setF] = useState({
    subject: ticket.subject_display || '', module: '',
    description: `${ticket.description || ''}\n\n_From ticket #${ticket.ticket_no}, raised by ${ticket.raised_by}._`.trim(),
    project_id: defaultProject || writable[0]?.id || '', assignee_id: null, priority_id: defPrio, type_id: taskType, sprint_id: defaultSprint,
  });
  const set = (k, v) => setF(s => ({ ...s, [k]: v }));
  const info = useProjectInfo(f.project_id);
  const [cal, setCal] = useState(null);
  useEffect(() => { api.get('/work-calendar').then(setCal).catch(() => {}); }, []);
  const [busy, setBusy] = useState(false);
  const memberIds = new Set((info?.members || []).map(m => m.user_id));
  const members = activeUsers.filter(u => memberIds.has(u.id));
  const others = activeUsers.filter(u => !memberIds.has(u.id));
  const prio = meta.priorities.find(p => p.id === Number(f.priority_id));
  const due = prio?.no_timeline ? null : dueFrom(cal, cal?.priority_days?.[f.priority_id]);
  const order = { current: 0, planned: 1 };
  const sprintChoices = sprints.filter(s => s.state !== 'ended').sort((a, b) => order[a.state] - order[b.state] || a.start_date.localeCompare(b.start_date));
  const save = async () => {
    if (!f.project_id) { toast('Choose the project.', 'error'); return; }
    setBusy(true);
    try {
      const wp = await api.post(`/tickets/${ticket.ticket_no}/convert`, { ...f, status_id: column.statuses[0].id, module: f.module || null });
      toast(`Ticket #${ticket.ticket_no} is now task ${wp.key || ''}`.trim());
      onCreated(wp);
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Turn ticket #${ticket.ticket_no} into a task`} wide="lg" onClose={onClose} onSubmit={save}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>{busy ? 'Creating…' : 'Create task'}</button></>}>
      <Field label="Task headline"><input type="text" value={f.subject} onChange={(e) => set('subject', e.target.value)} required maxLength={255} autoFocus /></Field>
      <Field label="Module" hint="Which part of the application. Pick one used in this project or type a new one.">
        <ModuleInput projectId={f.project_id} value={f.module} onChange={(v) => set('module', v)} />
      </Field>
      <Field label="Problem"><MarkdownEditor value={f.description} onChange={(v) => set('description', v)} rows={5} /></Field>
      {ticket.email && <div style={{ marginTop: -6 }}><FullEmailButton email={ticket.email} /> <span className="xs muted">The whole email stays on the task too.</span></div>}
      <div className="grid-2">
        <Field label="Project *">
          <select value={f.project_id} onChange={(e) => setF(s => ({ ...s, project_id: Number(e.target.value), module: '' }))} required>
            {writable.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Assign to">
          <select value={f.assignee_id ?? ''} onChange={(e) => set('assignee_id', e.target.value ? Number(e.target.value) : null)}>
            <option value="">Unassigned</option>
            <optgroup label="Project members">{members.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</optgroup>
            {others.length > 0 && <optgroup label="Other employees">{others.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</optgroup>}
          </select>
        </Field>
        <Field label="Priority" hint={prio?.no_timeline ? 'No due date (no timeline).' : due ? `Due ${fmtDate(due, { year: true })} (TAT ${cal.priority_days[f.priority_id]} working day${cal.priority_days[f.priority_id] === 1 ? '' : 's'})` : 'No TAT set: no due date.'}>
          <select value={f.priority_id} onChange={(e) => set('priority_id', Number(e.target.value))}>
            {[...meta.priorities].reverse().map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Type">
          <select value={f.type_id} onChange={(e) => set('type_id', Number(e.target.value))}>
            {meta.types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
        <Field label="Sprint">
          <select value={f.sprint_id ?? ''} onChange={(e) => set('sprint_id', e.target.value ? Number(e.target.value) : null)}>
            <option value="">No sprint</option>
            {sprintChoices.map(s => <option key={s.id} value={s.id}>{s.code} · {s.name}{s.state === 'current' ? ' (current)' : ' (future)'}</option>)}
          </select>
        </Field>
      </div>
      <div className="info-box small">Starts in <b>{column.name}</b> with the ticket's files, linked to ticket #{ticket.ticket_no}. Closing the task solves the ticket and {ticket.raised_by} is told.</div>
    </Modal>
  );
}
