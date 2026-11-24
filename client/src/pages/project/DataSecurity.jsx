// Project → Data Security: the team's 45-point Data Security Checklist (sections A–E) for this project.
// Each check gets a status (Covered / Partial / Not covered / Not applicable), the evidence and the next step.
// "Copy audit prompt" gives a prompt for an AI code review; "Import report" reads its tables back in.
import { useMemo, useState } from 'react';
import { api } from '../../api.js';
import { useLoad, useApp } from '../../context.jsx';
import Icon from '../../components/Icon.jsx';
import { Loading, ErrorBox, Modal, Field, useAsync } from '../../components/ui.jsx';
import { fmtDateTime, timeAgo } from '../../lib/format.js';

export const SEC_STATUS = {
  covered: { label: 'Covered', icon: '✅', cls: 'ok' },
  partial: { label: 'Partial', icon: '🟡', cls: 'signal' },
  missing: { label: 'Not covered', icon: '❌', cls: 'danger' },
  na: { label: 'Not applicable', icon: '➖', cls: 'na' },
};
const ORDER = ['covered', 'partial', 'missing', 'na'];
const FILTERS = [['all', 'All'], ['open', 'Not checked'], ['covered', 'Covered'], ['partial', 'Partial'], ['missing', 'Not covered'], ['na', 'N/A']];

function StatusPill({ status }) {
  if (!status) return <span className="sec-pill open">Not checked</span>;
  const s = SEC_STATUS[status];
  return <span className={`sec-pill ${s.cls}`}><span aria-hidden>{s.icon}</span>{s.label}</span>;
}

function Bar({ c }) {
  const total = c.total || 1;
  return (
    <div className="sec-bar" role="img" aria-label={`${c.covered} covered, ${c.partial} partial, ${c.missing} not covered, ${c.na} not applicable, ${c.open} not checked`}>
      {['covered', 'partial', 'missing', 'na', 'open'].map(k => c[k] > 0 && <span key={k} className={k} style={{ width: `${(c[k] / total) * 100}%` }} />)}
    </div>
  );
}
const scoreLine = (c) => `${c.covered} ✅ · ${c.partial} 🟡 · ${c.missing} ❌${c.na ? ` · ${c.na} ➖` : ''}${c.open ? ` · ${c.open} not checked` : ''}`;

// ---------- audit prompt (for an AI code review) and reading its report back ----------
function auditPrompt(project, data) {
  const lines = [
    `You are reviewing the "${project.name}" codebase for data security. Check it against the checklist below and produce a status report.`,
    '', 'RULES',
    '- Check the actual code, config and templates. Do not guess. Look for evidence (file path + line) for every item.',
    '- Mark each item:', '  ✅ Covered — fully in place across the app', '  🟡 Partial — in place in some places only, or weak (say exactly what is missing)',
    '  ❌ Not covered — not found', "  ➖ Not applicable — feature doesn't exist in this app (say why)",
    '- Items marked [server] can only be confirmed on the live server → mark from what the code/config shows and add "confirm on server".',
    '- Do not change any code. Report only.', '', 'CHECKLIST',
  ];
  for (const s of data.sections) {
    lines.push('', `${s.key}. ${s.name}`);
    for (const ch of data.checks.filter(x => x.section === s.key)) lines.push(`${ch.code} ${ch.title}${ch.server ? ' [server]' : ''} — ${ch.detail}`);
  }
  lines.push('', 'OUTPUT',
    '1. Header: project name, date, and score per section, e.g. "A: 8 ✅ · 3 🟡 · 1 ❌".',
    "2. One table per section with columns: # | Check | Status (✅/🟡/❌/➖) | Evidence (file:line) | What's missing / next step.",
    '   Put the check code (A1, A2, …) in the # column.',
    '3. "Top 5 fixes" — the most important ❌/🟡 items, highest data risk first, with a one-line fix each.',
    '4. Keep wording short and plain.');
  return lines.join('\n');
}

function readStatus(cell) {
  const s = cell.toLowerCase();
  if (cell.includes('✅') || /^covered\b/.test(s)) return 'covered';
  if (cell.includes('🟡') || /^partial\b/.test(s)) return 'partial';
  if (cell.includes('❌') || /^not covered\b/.test(s) || /^missing\b/.test(s)) return 'missing';
  if (cell.includes('➖') || /^(not applicable|n\/a|na)\b/.test(s)) return 'na';
  return null;
}
const clean = (s) => String(s || '').replace(/\*\*|`/g, '').replace(/<br\s*\/?>/gi, ' ').trim();

// Markdown table rows like "| A1 | SQL injection | ✅ | server/db.js:40 | — |"
export function parseReport(text, codes) {
  const found = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.includes('|')) continue;
    const cells = line.split('|').map(clean);
    if (cells[0] === '') cells.shift();
    if (cells.length && cells[cells.length - 1] === '') cells.pop();
    const ci = cells.findIndex(c => codes.has(c.toUpperCase().replace(/[.:]$/, '')));
    if (ci < 0) continue;
    const code = cells[ci].toUpperCase().replace(/[.:]$/, '');
    const si = cells.findIndex((c, i) => i > ci && readStatus(c));
    if (si < 0) continue;
    const dash = (v) => (/^[-–—]*$/.test(v || '') ? '' : v);
    found.set(code, { code, status: readStatus(cells[si]), evidence: dash(cells[si + 1]) || '', next_step: dash(cells[si + 2]) || '' });
  }
  return [...found.values()];
}

function ImportModal({ project, data, onClose, onDone }) {
  const [text, setText] = useState('');
  const [busy, run] = useAsync();
  const codes = useMemo(() => new Set(data.checks.map(c => c.code)), [data]);
  const items = useMemo(() => parseReport(text, codes), [text, codes]);
  const byCode = new Map(data.checks.map(c => [c.code, c]));
  const apply = async () => {
    const r = await run(() => api.post(`/projects/${project.id}/security/import`, { items }), null);
    if (r) { onDone(r); onClose(); }
  };
  return (
    <Modal title="Import an audit report" wide onClose={onClose}
      footer={<><span className="grow small soft">{items.length ? `${items.length} of 45 checks found` : 'Paste the report to see what it finds'}</span>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!items.length || busy} onClick={apply}>{busy ? 'Saving…' : `Update ${items.length || ''} checks`}</button></>}>
      <p className="small soft" style={{ marginTop: 0 }}>Paste the report from an AI code review (made with <b>Copy audit prompt</b>) or any table with the check code (A1…E11), the status (✅ 🟡 ❌ ➖) and then evidence and next step. Only the checks found are changed; each change is kept in the check's history.</p>
      <Field label="Report"><textarea rows={9} value={text} onChange={(e) => setText(e.target.value)} placeholder="| A1 | SQL injection | ✅ | server/db.js:40 | — |" /></Field>
      {items.length > 0 && (
        <div className="table-wrap sec-import-preview">
          <table className="table">
            <thead><tr><th>#</th><th>Check</th><th>Now</th><th>From report</th><th>Evidence</th></tr></thead>
            <tbody>{items.map(x => (
              <tr key={x.code}><td className="key">{x.code}</td><td>{byCode.get(x.code)?.title}</td><td><StatusPill status={byCode.get(x.code)?.status} /></td>
                <td><StatusPill status={x.status} /></td><td className="small soft"><div className="sec-clip">{x.evidence}</div></td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

function EditModal({ project, check, canEdit, onClose, onSaved }) {
  const [f, setF] = useState({ status: check.status || '', evidence: check.evidence || '', next_step: check.next_step || '' });
  const [busy, run] = useAsync();
  const { data: history } = useLoad(() => api.get(`/projects/${project.id}/security/${check.code}/history`), [check.code]);
  const save = async () => {
    const r = await run(() => api.put(`/projects/${project.id}/security/${check.code}`, { ...f, status: f.status || null }), `${check.code} saved`);
    if (r) { onSaved(r); onClose(); }
  };
  return (
    <Modal title={`${check.code} · ${check.title}`} wide onClose={onClose} onSubmit={canEdit ? save : undefined}
      footer={canEdit ? <><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></> : <button type="button" className="btn" onClick={onClose}>Close</button>}>
      <p className="soft" style={{ marginTop: 0 }}>{check.detail}{check.server && <> <span className="tag">Server</span> confirm on the live server.</>}</p>
      <Field label="Status">
        <div className="sec-choose" role="radiogroup">
          {ORDER.map(k => (
            <button type="button" key={k} role="radio" aria-checked={f.status === k} disabled={!canEdit}
              className={`sec-pill ${SEC_STATUS[k].cls}${f.status === k ? ' on' : ''}`} onClick={() => setF({ ...f, status: f.status === k ? '' : k })}>
              <span aria-hidden>{SEC_STATUS[k].icon}</span>{SEC_STATUS[k].label}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Evidence" hint="Where it is in place: file and line, setting, document or test.">
        <textarea rows={3} value={f.evidence} disabled={!canEdit} onChange={(e) => setF({ ...f, evidence: e.target.value })} />
      </Field>
      <Field label="What's missing / next step">
        <textarea rows={3} value={f.next_step} disabled={!canEdit} onChange={(e) => setF({ ...f, next_step: e.target.value })} />
      </Field>
      {history?.length > 0 && (
        <div className="sec-history">
          <div className="xs muted" style={{ fontWeight: 600, marginBottom: 4 }}>History</div>
          {history.map((h, i) => (
            <div key={i} className="small">
              <span className="soft">{fmtDateTime(h.created_at)}</span> · {h.user_name || 'Someone'}{h.source === 'import' ? ' (imported report)' : ''}:{' '}
              {h.status_from !== h.status_to ? <>{h.status_from ? SEC_STATUS[h.status_from].label : 'Not checked'} → <b>{h.status_to ? SEC_STATUS[h.status_to].label : 'Not checked'}</b></> : 'status unchanged'}
              {h.changed && <span className="soft">{` · ${h.changed.split(',').map(k => (k === 'next_step' ? 'next step' : k)).join(' and ')} changed`}</span>}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

export default function DataSecurity({ project }) {
  const { toast } = useApp();
  const { data: loaded, error, loading } = useLoad(() => api.get(`/projects/${project.id}/security`), [project.id]);
  const [fresh, setFresh] = useState(null);
  const data = fresh || loaded;
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(null);
  const [importing, setImporting] = useState(false);
  const [closed, setClosed] = useState({});
  const [busy, run] = useAsync();

  if (error) return <div className="content"><ErrorBox error={error} /></div>;
  if (loading && !data) return <Loading />;
  const t = data.totals;
  const done = t.covered + t.na;
  const pct = Math.round((done / t.total) * 100);
  const term = q.trim().toLowerCase();
  const shown = (ch) => (filter === 'all' || (filter === 'open' ? !ch.status : ch.status === filter))
    && (!term || `${ch.code} ${ch.title} ${ch.detail} ${ch.evidence || ''} ${ch.next_step || ''}`.toLowerCase().includes(term));
  const byCode = new Map(data.checks.map(c => [c.code, c]));

  const quickStatus = async (ch, status) => {
    const r = await run(() => api.put(`/projects/${project.id}/security/${ch.code}`, { status: status || null }), null);
    if (r) setFresh(r);
  };
  const copyPrompt = async () => {
    try { await navigator.clipboard.writeText(auditPrompt(project, data)); toast('Audit prompt copied. Paste it into your AI code review tool, then import its report here.'); }
    catch { toast('Could not copy. Your browser blocked the clipboard.', 'error'); }
  };

  return (
    <div className="content">
      <div className="page-head">
        <div className="grow">
          <h2>Data security</h2>
          <p>The team's Data Security Checklist for {project.name}: 45 checks across development, testing, deployment and compliance.
            {data.last_updated_at && <> Last updated {timeAgo(data.last_updated_at)}{data.last_updated_by ? ` by ${data.last_updated_by}` : ''}.</>}</p>
        </div>
        <div className="head-actions">
          <button className="btn" onClick={copyPrompt} title="A prompt for an AI code review of this project against the checklist"><Icon name="copy" />Copy audit prompt</button>
          {data.can_edit && <button className="btn" onClick={() => setImporting(true)}><Icon name="upload" />Import report</button>}
          <a className="btn" href={`/api/projects/${project.id}/security.csv`}><Icon name="download" />Export</a>
        </div>
      </div>

      <div className="panel sec-summary">
        <div className="sec-overall">
          <div><div className="sec-big">{pct}%</div><div className="small soft">covered or not applicable</div></div>
          <div className="grow"><Bar c={t} /><div className="small soft" style={{ marginTop: 6 }}>{scoreLine(t)}</div></div>
        </div>
        <div className="sec-sections">
          {data.sections.map(s => (
            <a key={s.key} href={`#sec-${s.key}`} className="sec-section-chip">
              <b>{s.key}</b><span className="grow">{s.name}</span>
              <Bar c={s.counts} />
              <span className="xs soft">{scoreLine(s.counts)}</span>
            </a>
          ))}
        </div>
      </div>

      {data.top.length > 0 && (
        <div className="panel sec-top">
          <h3><Icon name="alert" />Top fixes</h3>
          <ol>{data.top.map(code => { const ch = byCode.get(code); return (
            <li key={code}><button className="link-btn" onClick={() => setEdit(ch)}><span className="key">{code}</span> {ch.title}</button> <StatusPill status={ch.status} />
              {ch.next_step && <span className="small soft"> — {ch.next_step}</span>}</li>
          ); })}</ol>
        </div>
      )}

      <div className="sec-toolbar">
        <div className="seg" role="tablist">
          {FILTERS.map(([k, label]) => (
            <button key={k} className={filter === k ? 'active' : ''} onClick={() => setFilter(k)}>
              {label}{k !== 'all' && <span className="soft"> {t[k]}</span>}
            </button>
          ))}
        </div>
        <input type="search" className="sec-search" placeholder="Find a check" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {data.sections.map(s => {
        const rows = data.checks.filter(ch => ch.section === s.key && shown(ch));
        if (!rows.length) return null;
        const isClosed = closed[s.key];
        return (
          <section key={s.key} id={`sec-${s.key}`} className="panel sec-block">
            <button className="sec-block-head" onClick={() => setClosed({ ...closed, [s.key]: !isClosed })} aria-expanded={!isClosed}>
              <span className="sec-letter">{s.key}</span><h3 className="grow">{s.name}</h3>
              <span className="small soft">{scoreLine(s.counts)}</span><span className={`sec-caret${isClosed ? '' : ' open'}`}>▸</span>
            </button>
            {!isClosed && (
              <div className="table-wrap">
                <table className="table sec-table">
                  <thead><tr><th style={{ width: 52 }}>#</th><th>Check</th><th style={{ width: 170 }}>Status</th><th>Evidence</th><th>What's missing / next step</th><th style={{ width: 110 }}>Updated</th></tr></thead>
                  <tbody>{rows.map(ch => (
                    <tr key={ch.code} className="clickable" onClick={(e) => { if (!e.target.closest('select')) setEdit(ch); }}>
                      <td className="key">{ch.code}</td>
                      <td><div className="sec-title">{ch.title}{ch.server && <span className="tag" title="Confirm on the live server">Server</span>}</div><div className="xs soft sec-clip">{ch.detail}</div></td>
                      <td>
                        {data.can_edit ? (
                          <select className={`sec-select ${ch.status ? SEC_STATUS[ch.status].cls : 'open'}`} value={ch.status || ''} disabled={busy}
                            onChange={(e) => quickStatus(ch, e.target.value)} aria-label={`Status of ${ch.code}`}>
                            <option value="">Not checked</option>
                            {ORDER.map(k => <option key={k} value={k}>{SEC_STATUS[k].icon} {SEC_STATUS[k].label}</option>)}
                          </select>
                        ) : <StatusPill status={ch.status} />}
                      </td>
                      <td className="small"><div className="sec-clip">{ch.evidence || <span className="muted">—</span>}</div></td>
                      <td className="small"><div className="sec-clip">{ch.next_step || <span className="muted">—</span>}</div></td>
                      <td className="xs soft">{ch.updated_at ? <span title={`${fmtDateTime(ch.updated_at)}${ch.updated_by_name ? ` · ${ch.updated_by_name}` : ''}`}>{timeAgo(ch.updated_at)}<br />{ch.updated_by_name}</span> : '—'}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
      {!data.checks.some(shown) && <div className="panel"><p className="soft" style={{ padding: 16, margin: 0 }}>No checks match.</p></div>}

      {edit && <EditModal project={project} check={byCode.get(edit.code)} canEdit={data.can_edit} onClose={() => setEdit(null)} onSaved={setFresh} />}
      {importing && <ImportModal project={project} data={data} onClose={() => setImporting(false)} onDone={(r) => { setFresh(r); toast(`${r.changed} checks updated from the report`); }} />}
    </div>
  );
}
