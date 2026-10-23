import { useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import Icon from './Icon.jsx';
import { Modal, Field, UserSelect, MultiUserPicker, Person, useAsync } from './ui.jsx';
import { fmtDate, utc, isoDate } from '../lib/format.js';

export const POSITION_ORDER = ['PM', 'AM', 'BA', 'DT'];
export const STATUS = {
  active: { icon: 'link', label: 'Active link', tone: 'ok' },
  broken: { icon: 'linkBroken', label: 'Broken link', tone: 'danger' },
  unmapped: { icon: 'question', label: 'Not mapped', tone: 'muted' },
};
const dateOf = (s) => (s ? fmtDate(isoDate(utc(s)), { year: true }) : '');

function describe(slot) {
  if (slot.status === 'active') return slot.active.map(p => p.name).join(', ');
  if (slot.status === 'broken') {
    const last = slot.removed[0];
    return `${last.name}: ${last.reason.toLowerCase()}${last.removed_at ? ` on ${dateOf(last.removed_at)}` : ''}`;
  }
  return 'Nobody mapped yet';
}

// Compact row of four chips for tables: PM · AM · BA · DT
export function KeyPeopleStrip({ positions }) {
  if (!positions) return null;
  return (
    <span className="kp-strip">
      {POSITION_ORDER.map(code => {
        const slot = positions[code];
        const st = STATUS[slot.status];
        return (
          <span key={code} className={`kp-chip ${st.tone}`} title={`${slot.label}: ${st.label}. ${describe(slot)}`}
            aria-label={`${slot.label}: ${st.label}`}>
            <b>{code}</b><Icon name={st.icon} size={14} />
            {code === 'DT' && slot.active.length > 1 && <span className="kp-n">{slot.active.length}</span>}
          </span>
        );
      })}
    </span>
  );
}

export function KeyPeopleLegend() {
  return (
    <span className="kp-legend xs muted">
      {Object.values(STATUS).map(s => <span key={s.label} className={`kp-chip plain ${s.tone}`}><Icon name={s.icon} size={13} />{s.label}</span>)}
    </span>
  );
}

function EditPosition({ project, slot, onClose, onSaved }) {
  const { activeUsers } = useApp();
  const [single, setSingle] = useState(slot.active[0]?.user_id ?? null);
  const [many, setMany] = useState(slot.active.map(p => p.user_id));
  const [busy, run] = useAsync();
  const save = async () => {
    const user_ids = slot.multiple ? many : single ? [single] : [];
    const r = await run(() => api.put(`/projects/${project.id}/positions/${slot.code}`, { user_ids }), `${slot.label} updated`);
    if (r) { onSaved(r); onClose(); }
  };
  return (
    <Modal title={`${slot.label} of ${project.name}`} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy} onClick={save}>Save</button>
    </>}>
      <Field label={slot.multiple ? 'People in the development team' : 'Person'}
        hint="Mapped people are added to the project if they are not members yet. Removing someone keeps a record and shows a broken link until someone else is mapped.">
        {slot.multiple
          ? <MultiUserPicker value={many} onChange={setMany} users={activeUsers} />
          : <UserSelect value={single} onChange={setSingle} placeholder="Nobody (remove)" />}
      </Field>
      {slot.removed.length > 0 && (
        <div>
          <div className="small soft" style={{ fontWeight: 600, marginBottom: 4 }}>History</div>
          {slot.removed.slice(0, 5).map(p => (
            <div key={p.id} className="xs muted">{p.name}, {p.reason.toLowerCase()} on {dateOf(p.removed_at) || 'unknown date'}{p.removed_by ? ` by ${p.removed_by}` : ''}</div>
          ))}
        </div>
      )}
    </Modal>
  );
}

// Full panel for the project overview and members page
export function KeyPeoplePanel({ project, onChanged }) {
  const [positions, setPositions] = useState(project.positions);
  const [editing, setEditing] = useState(null);
  const canEdit = project.permissions.includes('project.members');
  const gaps = POSITION_ORDER.filter(c => positions[c].status !== 'active').length;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Key people</h3>
        <span className={`small ${gaps ? 'danger-text' : 'ok-text'}`}>{gaps ? `${gaps} of 4 need attention` : 'All mapped'}</span>
      </div>
      <ul className="list">
        {POSITION_ORDER.map(code => {
          const slot = positions[code];
          const st = STATUS[slot.status];
          return (
            <li key={code} className="kp-row">
              <span className={`kp-icon ${st.tone}`} title={st.label}><Icon name={st.icon} size={18} /></span>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="row" style={{ gap: 8 }}><b className="kp-code">{code}</b><span className="small soft">{slot.label}</span></div>
                {slot.status === 'active' ? (
                  <div className="row wrap" style={{ gap: '4px 12px', marginTop: 4 }}>
                    {slot.active.map(p => <Person key={p.id} id={p.user_id} name={p.name} />)}
                  </div>
                ) : (
                  <div className={`small ${slot.status === 'broken' ? 'danger-text' : 'muted'}`} style={{ marginTop: 2 }}>
                    {slot.status === 'broken' ? `Broken link. ${describe(slot)}` : 'Not mapped yet'}
                  </div>
                )}
              </div>
              {canEdit && <button className="btn sm" onClick={() => setEditing(slot)}>{slot.status === 'active' ? 'Change' : 'Map'}</button>}
            </li>
          );
        })}
      </ul>
      {editing && <EditPosition project={project} slot={editing} onClose={() => setEditing(null)}
        onSaved={(p) => { setPositions(p); onChanged?.(); }} />}
    </section>
  );
}
