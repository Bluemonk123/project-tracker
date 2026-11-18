// Upload tasks (Sprint Planning): read a CSV or Excel file, check every row on the server, then import the good ones.
// Uploaded tasks are not in any sprint; they appear under "Not in a sprint" and in All work.
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import Icon from '../components/Icon.jsx';
import { Modal, Field, useAsync } from '../components/ui.jsx';

// Column headings we recognise (lower case, spaces and punctuation ignored) -> field
const COLUMNS = [
  ['subject', 'Subject', ['subject', 'title', 'taskname', 'task', 'summary', 'tasksubject']],
  ['project', 'Project', ['project', 'projectname', 'projectkey']],
  ['type', 'Type', ['type', 'tasktype', 'category']],
  ['priority', 'Priority', ['priority']],
  ['module', 'Module', ['module', 'section', 'sectionmodule', 'area', 'modulearea']],
  ['description', 'Problem', ['problem', 'description', 'details', 'issue', 'requestedchange']],
  ['solution', 'Solution', ['solution', 'fix', 'resolution']],
  ['location', 'Location', ['location', 'environment']],
  ['requested_by', 'Requested by', ['requestedby', 'requester', 'username', 'raisedby', 'owner', 'ownername']],
  ['assignee', 'Assignee', ['assignee', 'assignedto', 'developer']],
  ['estimated_hours', 'Estimated hours', ['estimatedhours', 'estimate', 'estimation', 'hours', 'esthours']],
  ['start_date', 'Start date', ['startdate', 'start']],
  ['due_date', 'Due date', ['duedate', 'due', 'finishdate', 'finish', 'enddate']],
];
const key = (h) => String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const ALIAS = new Map(COLUMNS.flatMap(([f, , names]) => names.map(n => [n, f])));
const pad = (n) => String(n).padStart(2, '0');
const cell = (v) => (v instanceof Date ? `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}` : v == null ? '' : String(v));

// A small CSV reader: quoted fields, commas/semicolons/tabs, line breaks inside quotes.
function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0] || '';
  const sep = [',', ';', '\t'].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows = []; let row = []; let f = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c;
    } else if (c === '"' && f === '') q = true;
    else if (c === sep) { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}

// Finds the heading row (within the first 10 rows) and turns the rows below it into task fields.
function toTasks(grid) {
  const at = grid.slice(0, 10).findIndex(r => r.some(h => ['subject', 'description'].includes(ALIAS.get(key(h)))));
  if (at < 0) return { error: 'No heading row found. The file needs a "Subject" (or "Problem"/"Description") column heading.' };
  const heads = grid[at].map(h => ALIAS.get(key(h)) || null);
  const seen = new Set();
  const map = heads.map(f => (f && !seen.has(f) ? (seen.add(f), f) : null)); // first column wins if a heading repeats
  const ignored = grid[at].filter((h, i) => String(h ?? '').trim() && !map[i]).map(h => String(h).trim());
  const rows = [];
  grid.slice(at + 1).forEach((r, i) => {
    const t = { ref: at + i + 2 };
    map.forEach((f, j) => { if (f) t[f] = cell(r[j]).trim(); });
    if (COLUMNS.some(([f]) => t[f])) rows.push(t); // skip empty lines
  });
  return { rows, columns: [...seen], ignored };
}

function templateCsv() {
  const head = COLUMNS.map(([, label]) => label);
  const ex = ['Login page shows error 500', '', 'Bug', 'P2', 'Login', 'Users see an error after entering the password', '', 'On Staging', 'Mehak', '', '4', '', ''];
  const q = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [head, ex].map(r => r.map(q).join(',')).join('\r\n');
}

export default function UploadTasksModal({ defaultProject, onClose, onDone }) {
  const { projects } = useApp();
  const writable = projects.filter(p => !p.permissions || p.permissions.includes('wp.create'));
  const [projectId, setProjectId] = useState(defaultProject && writable.some(p => p.id === defaultProject) ? String(defaultProject) : '');
  const [file, setFile] = useState(null);         // { name, rows, columns, ignored }
  const [check, setCheck] = useState(null);       // dry-run result
  const [done, setDone] = useState(null);
  const [reading, setReading] = useState(false);
  const [err, setErr] = useState('');
  const [busy, run] = useAsync();
  const input = useRef(null);

  const verify = async (f, pid) => {
    setCheck(null);
    const r = await run(() => api.post('/work-packages/import', { rows: f.rows, project_id: pid || undefined, dry_run: true }));
    if (r) setCheck(r);
  };
  const read = async (fl) => {
    setErr(''); setFile(null); setCheck(null); setDone(null);
    if (!fl) return;
    const ext = fl.name.split('.').pop().toLowerCase();
    if (!['csv', 'xlsx', 'txt'].includes(ext)) { setErr(ext === 'xls' ? 'Old .xls files are not supported: open it in Excel and save as .xlsx, or as CSV.' : 'Choose a .xlsx or .csv file.'); return; }
    if (fl.size > 5 * 1024 * 1024) { setErr('The file is over 5 MB.'); return; }
    setReading(true);
    try {
      let grid;
      if (ext === 'xlsx') {
        const { readSheet } = await import('read-excel-file/browser');
        grid = await readSheet(fl);
      } else grid = parseCsv(await fl.text());
      const t = toTasks(grid);
      if (t.error) { setErr(t.error); return; }
      if (!t.rows.length) { setErr('The file has headings but no task rows.'); return; }
      if (t.rows.length > 1000) { setErr(`The file has ${t.rows.length} tasks; upload at most 1000 at a time.`); return; }
      const f = { name: fl.name, ...t };
      setFile(f);
      await verify(f, projectId);
    } catch (e) {
      setErr(`The file could not be read: ${e.message || e}`);
    } finally { setReading(false); }
  };
  const doImport = async () => {
    const r = await run(() => api.post('/work-packages/import', { rows: file.rows, project_id: projectId || undefined, file_name: file.name }), null);
    if (r) { setDone(r); onDone?.(r); }
  };
  const bad = check ? check.rows.filter(x => !x.ok) : [];
  const templateUrl = `data:text/csv;charset=utf-8,${encodeURIComponent('﻿' + templateCsv())}`;

  if (done) {
    return (
      <Modal title="Tasks uploaded" onClose={onClose} footer={<button type="button" className="btn primary" onClick={onClose}>Done</button>}>
        <p><b>{done.created}</b> task{done.created === 1 ? '' : 's'} added{done.skipped ? <>, <b>{done.skipped}</b> row{done.skipped === 1 ? '' : 's'} skipped because of problems</> : ''}.</p>
        <p className="small muted">They are not in any sprint yet: you'll find them under <b>Not in a sprint</b>, ready to pick into a sprint, and in <Link to="/work-packages" onClick={onClose}>All work</Link>.</p>
        <div className="up-keys">{done.items.slice(0, 40).map(x => <Link key={x.id} to={`/wp/${x.id}`} className="tag" onClick={onClose}>{x.key}</Link>)}{done.items.length > 40 && <span className="xs muted">and {done.items.length - 40} more</span>}</div>
      </Modal>
    );
  }

  return (
    <Modal title="Upload tasks" onClose={onClose} wide
      footer={<>
        <span className="small muted grow">{check ? `${check.valid} ready${check.invalid ? `, ${check.invalid} with problems (skipped)` : ''}` : ''}</span>
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn primary" disabled={busy || !check?.valid} onClick={doImport}>
          <Icon name="upload" />{check?.valid ? `Add ${check.valid} task${check.valid === 1 ? '' : 's'}` : 'Add tasks'}
        </button>
      </>}>
      <p className="small" style={{ marginTop: 0 }}>Upload a <b>CSV</b> or <b>Excel (.xlsx)</b> file with one task per row. The tasks start in <b>New</b> and are not in any sprint, so you can pick them into sprints afterwards.
        {' '}<a href={templateUrl} download="task-upload-template.csv">Download the template</a>.</p>
      <div className="form-grid">
        <Field label="Project" hint="For rows without a Project column (or with it empty).">
          <select value={projectId} onChange={(e) => { setProjectId(e.target.value); if (file) verify(file, e.target.value); }}>
            <option value="">Use the file's Project column</option>
            {writable.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="File">
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn" onClick={() => input.current?.click()} disabled={reading || busy}><Icon name="paperclip" />{file ? 'Choose another file' : 'Choose file'}</button>
            {file && <span className="small ellipsis" title={file.name}>{file.name} · {file.rows.length} row{file.rows.length === 1 ? '' : 's'}</span>}
            <input ref={input} type="file" hidden accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => { read(e.target.files[0]); e.target.value = ''; }} />
          </div>
        </Field>
      </div>
      <details className="up-help small">
        <summary>Which columns can the file have?</summary>
        <p>Only <b>Subject</b> is needed (if it is empty, the start of the <b>Problem</b> is used). Optional: {COLUMNS.slice(1).map(([, l]) => l).join(', ')}.
          Type and Priority use the names in the app (e.g. Bug, P2), Location is Local, Staging, Production or External, Assignee is a person's name or email, and dates are YYYY-MM-DD or DD/MM/YYYY.
          Without a due date, it is set from the priority and the working calendar.</p>
      </details>
      {(reading || (busy && !check)) && <p className="small muted">Reading and checking the file…</p>}
      {err && <div className="error-box small">{err}</div>}
      {file && (
        <p className="xs muted" style={{ margin: '8px 0' }}>
          Columns used: {file.columns.map(f => COLUMNS.find(c => c[0] === f)[1]).join(', ')}.
          {file.ignored.length > 0 && <> Ignored: {file.ignored.join(', ')}.</>}
        </p>
      )}
      {check && (
        <>
          {bad.length > 0 && <div className="warn-box small" style={{ marginBottom: 8 }}><b>{bad.length}</b> row{bad.length === 1 ? ' has' : 's have'} problems and will be skipped. Fix them in the file and upload again, or add the rest now.</div>}
          <div className="table-wrap up-preview">
            <table className="table">
              <thead><tr><th>Row</th><th>Subject</th><th>Project</th><th>Type</th><th>Priority</th><th>Assignee</th><th>Due</th><th>Check</th></tr></thead>
              <tbody>
                {check.rows.map(x => (
                  <tr key={x.row} className={x.ok ? '' : 'up-bad'}>
                    <td className="xs muted">{x.row}</td>
                    <td className="ellipsis" style={{ maxWidth: 260 }} title={x.subject}>{x.subject || <span className="muted">—</span>}</td>
                    <td className="small">{x.project || '—'}</td>
                    <td className="small">{x.type || 'Task'}</td>
                    <td className="small">{x.priority || <span className="muted">default</span>}</td>
                    <td className="small">{x.assignee || '—'}</td>
                    <td className="small">{x.due_date || <span className="muted">auto</span>}</td>
                    <td className="small">{x.ok ? <span className="up-ok"><Icon name="check" size={13} />Ready</span> : <span className="up-err">{x.errors.join('; ')}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  );
}
