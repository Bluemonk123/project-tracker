import { Fragment, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../../api.js';
import { useLoad } from '../../context.jsx';
import Icon from '../../components/Icon.jsx';
import { Loading, ErrorBox, Empty, Modal, Field, useAsync, confirmDialog, MoreMenu } from '../../components/ui.jsx';
import { fmtDate, timeAgo } from '../../lib/format.js';

export const STATUS_TAG = {
  latest: 'ok', patch: 'accent', minor: 'signal', major: 'signal', eol: 'danger', unknown: '',
};

export function useCatalog() {
  const { data } = useLoad(() => api.get('/tech/catalog'), []);
  return data || { catalog: [], categories: [], sources: [] };
}

function supportText(t) {
  const c = t.assessment?.cycle;
  if (!c) return null;
  const lts = c.lts ? 'LTS, ' : '';
  const until = (d) => (lts ? `LTS, until ${d}` : `Until ${d}`);
  if (c.eol === true) return 'No longer supported';
  if (c.eol === false) return c.lts ? 'LTS, supported' : 'Supported';
  if (typeof c.eol === 'string') return c.eol <= new Date().toISOString().slice(0, 10) ? `Ended ${fmtDate(c.eol, { year: true })}` : until(fmtDate(c.eol, { year: true }));
  return null;
}

export function StatusTag({ a }) {
  if (!a) return null;
  return <span className={`tag ${STATUS_TAG[a.status] || ''}`} title={a.label}>{a.label}</span>;
}

export function Releases({ info }) {
  if (!info) return null;
  return (
    <div className="tech-releases">
      {info.error && <div className="small danger-text">{info.error}</div>}
      {info.warning && <div className="xs muted">{info.warning}</div>}
      {info.releases?.length > 0 && (
        <div>
          <div className="xs muted" style={{ marginBottom: 4 }}>Recent releases</div>
          <div className="row wrap" style={{ gap: 6 }}>
            {info.releases.map(r => <span key={r.version} className="tag" title={r.date ? `Released ${r.date}` : undefined}><b>{r.version}</b>{r.date ? ` · ${fmtDate(r.date)}` : ''}</span>)}
          </div>
        </div>
      )}
      {info.cycles?.length > 0 && (
        <div>
          <div className="xs muted" style={{ margin: '8px 0 4px' }}>Release lines and support</div>
          <div className="row wrap" style={{ gap: 6 }}>
            {info.cycles.slice(0, 8).map(c => {
              const ended = c.eol === true || (typeof c.eol === 'string' && c.eol <= new Date().toISOString().slice(0, 10));
              return (
                <span key={c.cycle} className={`tag${ended ? ' danger' : ''}`}>
                  <b>{c.cycle}</b>{c.lts ? ' LTS' : ''}{c.latest ? ` → ${c.latest}` : ''}
                  {typeof c.eol === 'string' ? `, ${ended ? 'ended' : 'until'} ${fmtDate(c.eol, { year: true })}` : ''}
                </span>
              );
            })}
          </div>
        </div>
      )}
      {info.links?.length > 0 && (
        <div className="row wrap small" style={{ marginTop: 8, gap: 12 }}>
          {info.links.map(l => <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer"><Icon name="link" size={13} /> {l.label}</a>)}
          {info.fetched_at && <span className="xs muted">Checked {timeAgo(info.fetched_at.replace('T', ' ').slice(0, 19))}</span>}
        </div>
      )}
    </div>
  );
}

function TechModal({ project, tech, onClose, onSaved }) {
  const { catalog, categories, sources } = useCatalog();
  const [f, setF] = useState({
    name: tech?.name || '', category: tech?.category || 'Frontend', version_used: tech?.version_used || '',
    source: tech?.source || 'none', package_id: tech?.package_id || '', eol_slug: tech?.eol_slug || '', notes: tech?.notes || '',
  });
  const [preview, setPreview] = useState(null);
  const [checking, setChecking] = useState(false);
  const [busy, run] = useAsync();
  const set = (k, v) => setF(s => ({ ...s, [k]: v }));
  const pickName = (name) => {
    const c = catalog.find(x => x.name.toLowerCase() === name.trim().toLowerCase());
    setF(s => ({ ...s, name, ...(c && !tech ? { category: c.category, source: c.source, package_id: c.package_id, eol_slug: c.eol_slug || '' } : {}) }));
    setPreview(null);
  };
  const check = async () => {
    setChecking(true);
    try { setPreview(await api.post('/technologies/lookup', { ...f, refresh: true })); } catch (e) { setPreview({ info: { error: e.message } }); }
    setChecking(false);
  };
  const save = async () => {
    const r = await run(() => (tech ? api.patch(`/technologies/${tech.id}`, f) : api.post(`/projects/${project.id}/technologies`, f)), tech ? 'Technology saved' : `${f.name} added`);
    if (r) { onSaved(); onClose(); }
  };
  const src = sources.find(s => s.key === f.source);
  return (
    <Modal title={tech ? `Edit ${tech.name}` : 'Add technology'} wide onClose={onClose} onSubmit={save} footer={<>
      <button type="button" className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy || !f.name.trim()}>{tech ? 'Save' : 'Add technology'}</button>
    </>}>
      <div className="form-grid three">
        <Field label="Technology" className="span-2" hint="Pick from the list to fill in the rest, or type any name.">
          <input type="text" list="tech-catalog" value={f.name} onChange={(e) => pickName(e.target.value)} placeholder="e.g. React, Laravel, PostgreSQL" required />
          <datalist id="tech-catalog">{catalog.map(c => <option key={c.name} value={c.name}>{c.category}</option>)}</datalist>
        </Field>
        <Field label="Version used in this project">
          <input type="text" value={f.version_used} onChange={(e) => { set('version_used', e.target.value); setPreview(null); }} placeholder="e.g. 18.2.0" />
        </Field>
        <Field label="Category">
          <select value={f.category} onChange={(e) => set('category', e.target.value)}>{categories.map(c => <option key={c}>{c}</option>)}</select>
        </Field>
        <Field label="Check versions from">
          <select value={f.source} onChange={(e) => { set('source', e.target.value); setPreview(null); }}>
            {sources.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </Field>
        {f.source !== 'none' && f.source !== 'flutter' && (
          <Field label={f.source === 'endoflife' ? 'Product' : 'Package'} hint={src?.hint}>
            <input type="text" value={f.package_id} onChange={(e) => { set('package_id', e.target.value); setPreview(null); }} />
          </Field>
        )}
        {f.source !== 'endoflife' && (
          <Field label="Support dates (optional)" hint="endoflife.date product name, e.g. react, nodejs, postgresql">
            <input type="text" value={f.eol_slug} onChange={(e) => { set('eol_slug', e.target.value); setPreview(null); }} />
          </Field>
        )}
        <Field label="Notes" className="span-2"><input type="text" value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Where it is used, upgrade plans…" /></Field>
      </div>
      {(f.source !== 'none' || f.eol_slug) && (
        <div className="tech-preview">
          <div className="row">
            <button type="button" className="btn sm" onClick={check} disabled={checking}><Icon name="search" />{checking ? 'Checking online…' : 'Check versions now'}</button>
            {preview?.info?.latest && <span className="small">Latest <b>{preview.info.latest.version}</b>{preview.info.latest.date ? ` (${fmtDate(preview.info.latest.date, { year: true })})` : ''}</span>}
            {preview && <StatusTag a={preview.assessment} />}
          </div>
          {preview && <Releases info={preview.info} />}
        </div>
      )}
    </Modal>
  );
}

export function TechTable({ rows, showProject, canEdit, onEdit, onDelete }) {
  const [open, setOpen] = useState({});
  const cols = 7 + (showProject ? 1 : 0);
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr>
          <th style={{ width: 28 }} /><th>Technology</th>{showProject && <th>Project</th>}<th>Version used</th><th>Latest version</th>
          <th className="hide-sm">Support</th><th>Status</th>{canEdit && <th />}
        </tr></thead>
        <tbody>
          {rows.map(t => (
            <Fragment key={t.id}>
              <tr>
                <td>
                  <button className="icon-btn" aria-expanded={!!open[t.id]} aria-label={open[t.id] ? 'Hide releases' : 'Show releases'}
                    onClick={() => setOpen(o => ({ ...o, [t.id]: !o[t.id] }))} style={{ transform: open[t.id] ? 'rotate(90deg)' : 'none' }}><Icon name="chevronRight" /></button>
                </td>
                <td>
                  <b>{t.name}</b> <span className="tag">{t.category}</span>
                  {t.notes && <div className="xs muted ellipsis" style={{ maxWidth: 360 }} title={t.notes}>{t.notes}</div>}
                </td>
                {showProject && <td><Link to={`/projects/${t.project_identifier}/technologies`} className="key" style={{ '--pc': t.project_color }}>{t.project_identifier}</Link> <span className="small soft">{t.project_name}</span></td>}
                <td className="num" style={{ textAlign: 'left' }}>{t.version_used || <span className="muted">—</span>}</td>
                <td>
                  {t.info?.latest ? <><b className="num">{t.info.latest.version}</b>{t.info.latest.date && <div className="xs muted">{fmtDate(t.info.latest.date, { year: true })}</div>}</>
                    : t.source === 'none' && !t.eol_slug ? <span className="xs muted">Not checked online</span>
                      : t.info?.error ? <span className="xs danger-text" title={t.info.error}>Could not check</span> : <span className="muted">—</span>}
                </td>
                <td className="hide-sm small soft">{supportText(t) || <span className="muted">—</span>}</td>
                <td><StatusTag a={t.assessment} /></td>
                {canEdit && (
                  <td className="num">
                    <MoreMenu>
                      <button className="menu-item" onClick={() => onEdit(t)}><Icon name="edit" size={16} />Edit</button>
                      <button className="menu-item danger" onClick={() => onDelete(t)}><Icon name="trash" size={16} />Remove</button>
                    </MoreMenu>
                  </td>
                )}
              </tr>
              {open[t.id] && <tr className="tech-detail"><td /><td colSpan={cols - 1}><Releases info={t.info} />{!t.info && <span className="small muted">This technology is not checked online. Edit it to choose a source.</span>}</td></tr>}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Technologies({ project }) {
  const force = useRef(false);
  const { data, error, loading, reload } = useLoad(() => {
    const refresh = force.current; force.current = false;
    return api.get(`/projects/${project.id}/technologies` + qs({ refresh: refresh ? 1 : undefined }));
  }, [project.id]);
  const checkNow = () => { force.current = true; reload(); };
  const [modal, setModal] = useState(null);
  const [, run] = useAsync();
  const rows = data?.rows || [];
  const canEdit = !!data?.can_edit;
  const counts = useMemo(() => rows.reduce((m, t) => ({ ...m, [t.assessment.status]: (m[t.assessment.status] || 0) + 1 }), {}), [rows]);
  const del = async (t) => {
    if (await confirmDialog({ message: `Remove ${t.name} from ${project.name}?`, confirmLabel: 'Remove', danger: true })) {
      if (await run(() => api.del(`/technologies/${t.id}`), 'Technology removed')) reload();
    }
  };
  return (
    <div className="content">
      <div className="page-head">
        <div className="grow">
          <h2>Technologies</h2>
          <p>The tech stack of {project.name}, with the latest versions checked online. For information only; nothing is changed automatically.</p>
        </div>
        <div className="head-actions">
          {rows.length > 0 && <button className="btn" disabled={loading} onClick={checkNow}><Icon name="activity" />{loading ? 'Checking…' : 'Check for updates'}</button>}
          {canEdit && <button className="btn primary" onClick={() => setModal({})}><Icon name="plus" />Add technology</button>}
        </div>
      </div>
      {rows.length > 0 && (
        <div className="figures">
          <div className="figure"><div className="n">{rows.length}</div><div className="l">Technologies</div></div>
          <div className="figure"><div className="n">{counts.latest || 0}</div><div className="l">Up to date</div></div>
          <div className={`figure${(counts.minor || 0) + (counts.patch || 0) ? ' signal' : ''}`}><div className="n">{(counts.minor || 0) + (counts.patch || 0)}</div><div className="l">Minor or patch update</div></div>
          <div className={`figure${counts.major ? ' signal' : ''}`}><div className="n">{counts.major || 0}</div><div className="l">Major version behind</div></div>
          <div className={`figure${counts.eol ? ' danger' : ''}`}><div className="n">{counts.eol || 0}</div><div className="l">Out of support</div></div>
        </div>
      )}
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : !rows.length ? (
        <div className="panel"><Empty title="No technologies listed yet" action={canEdit && <button className="btn primary" onClick={() => setModal({})}><Icon name="plus" />Add the first technology</button>}>
          List the frameworks, languages, databases and tools this application uses, with the version in use. The app looks up the latest releases for you.
        </Empty></div>
      ) : (
        <div className="panel">
          <TechTable rows={rows} canEdit={canEdit} onEdit={(t) => setModal({ tech: t })} onDelete={del} />
        </div>
      )}
      <p className="xs muted" style={{ marginTop: 10 }}>
        Versions come from npm, PyPI, NuGet, Maven, Packagist, RubyGems, pub.dev, Go and Cargo (via deps.dev), GitHub, and support dates from endoflife.date. Results are kept for 12 hours; use Check for updates to fetch them again.
        {' '}<Link to="/technologies">See technologies across all projects</Link>
      </p>
      {modal && <TechModal project={project} tech={modal.tech} onClose={() => setModal(null)} onSaved={reload} />}
    </div>
  );
}
