// Module: which part of the application a task is about. Free text, with the project's existing modules as suggestions.
import { useEffect, useId, useState } from 'react';
import { api } from '../api.js';

export function useModules(projectId) {
  const [list, setList] = useState([]);
  useEffect(() => {
    if (!projectId) { setList([]); return; }
    let alive = true;
    api.get(`/projects/${projectId}/modules`).then(r => { if (alive) setList(r.map(x => x.module)); }).catch(() => {});
    return () => { alive = false; };
  }, [projectId]);
  return list;
}

// Saves on blur / Enter when `onSave` is given (task page); otherwise a plain controlled input (forms).
export default function ModuleInput({ projectId, value, onChange, onSave, disabled, autoFocus }) {
  const listId = useId();
  const modules = useModules(projectId);
  const [v, setV] = useState(value || '');
  useEffect(() => setV(value || ''), [value]);
  const commit = () => { if (onSave && v.trim() !== String(value || '').trim()) onSave(v.trim()); };
  return (
    <>
      <input type="text" list={listId} value={v} maxLength={80} disabled={disabled} autoFocus={autoFocus} aria-label="Module"
        placeholder="e.g. Account Master, Invoices, Login"
        onChange={(e) => { setV(e.target.value); onChange?.(e.target.value); }}
        onBlur={commit} onKeyDown={(e) => { if (onSave && e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } if (e.key === 'Escape') setV(value || ''); }} />
      <datalist id={listId}>{modules.map(m => <option key={m} value={m} />)}</datalist>
    </>
  );
}
