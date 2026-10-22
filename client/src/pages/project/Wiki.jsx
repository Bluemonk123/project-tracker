import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { useLoad } from '../../context.jsx';
import Icon from '../../components/Icon.jsx';
import { Loading, ErrorBox, Empty, Markdown, MarkdownEditor, Modal, Field, useAsync, confirmDialog, MoreMenu } from '../../components/ui.jsx';
import { timeAgo, fmtDateTime, fmtSize } from '../../lib/format.js';

function NewPageModal({ project, pages, parentId, onClose }) {
  const nav = useNavigate();
  const [title, setTitle] = useState('');
  const [parent, setParent] = useState(parentId || '');
  const [busy, run] = useAsync();
  const save = async () => {
    const r = await run(() => api.post(`/projects/${project.id}/wiki`, { title, parent_id: parent || null, content: `# ${title}\n\n` }), 'Page created');
    if (r) { onClose(); nav(`/projects/${project.identifier}/wiki/${r.id}?edit=1`); }
  };
  return (
    <Modal title="New wiki page" onClose={onClose} onSubmit={save} footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>Create page</button></>}>
      <Field label="Title"><input type="text" value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="e.g. Deployment steps" /></Field>
      <Field label="Inside"><select value={parent} onChange={(e) => setParent(e.target.value)}><option value="">Top level</option>{pages.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select></Field>
    </Modal>
  );
}

function History({ page, onClose, onRestore, canEdit }) {
  const { data } = useLoad(() => api.get(`/wiki/${page.id}/versions`), [page.id]);
  const [sel, setSel] = useState(null);
  return (
    <Modal title={`History of “${page.title}”`} wide onClose={onClose}>
      {!data ? <Loading /> : (
        <div className="grid-2" style={{ gridTemplateColumns: '220px 1fr' }}>
          <div className="stack tight">
            {data.map((v, i) => (
              <button key={v.id} className={`menu-item${sel?.id === v.id ? ' ' : ''}`} style={sel?.id === v.id ? { background: 'var(--accent-soft)' } : undefined} onClick={() => setSel(v)}>
                <span className="grow" style={{ minWidth: 0 }}><span className="small">{fmtDateTime(v.created_at)}</span><br /><span className="xs muted">{v.user_name}{i === 0 ? ', current' : ''}</span></span>
              </button>
            ))}
          </div>
          <div>
            {sel ? <>
              <div className="md-preview" style={{ maxHeight: 400, overflow: 'auto' }}><Markdown text={sel.content} /></div>
              {canEdit && sel.id !== data[0].id && <button className="btn sm" style={{ marginTop: 8 }} onClick={() => onRestore(sel.content)}>Restore this version</button>}
            </> : <p className="muted small">Pick a version to see it.</p>}
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function Wiki({ project, pageId }) {
  const nav = useNavigate();
  const list = useLoad(() => api.get(`/projects/${project.id}/wiki`), [project.id]);
  const pages = list.data || [];
  const currentId = pageId || pages.find(p => p.title === 'Overview')?.id || pages[0]?.id;
  const page = useLoad(() => (currentId ? api.get(`/wiki/${currentId}`) : Promise.resolve(null)), [currentId]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [title, setTitle] = useState('');
  const [modal, setModal] = useState(null);
  const [busy, run] = useAsync();
  const canEdit = project.permissions.includes('wiki.edit');
  const p = page.data;
  useEffect(() => {
    if (p) { setDraft(p.content); setTitle(p.title); setEditing(new URLSearchParams(window.location.search).get('edit') === '1' && canEdit); }
  }, [p?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (content = draft) => {
    if (await run(() => api.patch(`/wiki/${p.id}`, { content, title }), 'Page saved')) {
      setEditing(false); page.reload(); list.reload();
      window.history.replaceState(null, '', `/projects/${project.identifier}/wiki/${p.id}`);
    }
  };
  const tree = (parent, depth) => pages.filter(x => (x.parent_id || null) === parent).map(x => (
    <div key={x.id}>
      <Link to={`/projects/${project.identifier}/wiki/${x.id}`} className={x.id === Number(currentId) ? 'active' : ''} style={{ paddingLeft: 10 + depth * 14 }}>{x.title}</Link>
      {tree(x.id, depth + 1)}
    </div>
  ));

  if (list.loading && !list.data) return <div className="content"><Loading /></div>;
  return (
    <div className="content">
      <ErrorBox error={list.error || page.error} />
      {!pages.length ? (
        <div className="panel"><Empty title="No wiki pages yet" action={canEdit && <button className="btn primary" onClick={() => setModal('new')}><Icon name="plus" />Create the first page</button>}>
          Keep specs, requirement documents, environment details and how-tos for this application here.
        </Empty></div>
      ) : (
        <div className="wiki-layout">
          <nav className="panel wiki-nav" style={{ padding: 8 }} aria-label="Wiki pages">
            {tree(null, 0)}
            {canEdit && <button className="btn sm ghost" style={{ marginTop: 6, width: '100%', justifyContent: 'flex-start' }} onClick={() => setModal('new')}><Icon name="plus" />New page</button>}
          </nav>
          <article className="panel">
            {!p ? <Loading /> : (
              <>
                <div className="panel-head">
                  {editing ? <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} style={{ fontWeight: 600, maxWidth: 420 }} aria-label="Page title" />
                    : <h3 style={{ fontSize: 17 }}>{p.title}</h3>}
                  <div className="actions">
                    <span className="xs muted hide-sm">Edited by {p.updated_by_name} {timeAgo(p.updated_at)}</span>
                    {canEdit && !editing && <button className="btn sm" onClick={() => setEditing(true)}><Icon name="edit" />Edit</button>}
                    <MoreMenu>
                      <button className="menu-item" onClick={() => setModal('history')}><Icon name="clock" size={16} />History ({p.versions})</button>
                      <button className="menu-item" onClick={() => window.print()}><Icon name="printer" size={16} />Print</button>
                      {canEdit && <button className="menu-item" onClick={() => setModal({ newChild: p.id })}><Icon name="plus" size={16} />Add sub-page</button>}
                      {canEdit && <button className="menu-item danger" onClick={async () => {
                        if (await confirmDialog({ message: `Delete the page “${p.title}”? Sub-pages move to the top level.`, confirmLabel: 'Delete page', danger: true })) {
                          if (await run(() => api.del(`/wiki/${p.id}`), 'Page deleted')) { list.reload(); nav(`/projects/${project.identifier}/wiki`); }
                        }
                      }}><Icon name="trash" size={16} />Delete page</button>}
                    </MoreMenu>
                  </div>
                </div>
                <div className="panel-body">
                  {editing ? (
                    <div className="stack tight">
                      <MarkdownEditor value={draft} onChange={setDraft} rows={22} autoFocus onSubmitShortcut={() => save()} />
                      <div className="row">
                        <button className="btn primary" disabled={busy} onClick={() => save()}>Save page</button>
                        <button className="btn" onClick={() => { setDraft(p.content); setTitle(p.title); setEditing(false); }}>Cancel</button>
                        <span className="xs muted">Every save keeps a version in the history.</span>
                      </div>
                    </div>
                  ) : <div className="wiki-content"><Markdown text={p.content} /></div>}
                  {p.children.length > 0 && !editing && (
                    <div style={{ marginTop: 20 }}>
                      <div className="small soft" style={{ fontWeight: 600, marginBottom: 6 }}>Sub-pages</div>
                      {p.children.map(c => <div key={c.id}><Link to={`/projects/${project.identifier}/wiki/${c.id}`}>{c.title}</Link></div>)}
                    </div>
                  )}
                  {!editing && (
                    <div style={{ marginTop: 20 }}>
                      <div className="row small soft" style={{ fontWeight: 600, marginBottom: 6 }}>Files
                        {project.permissions.includes('files.upload') && <label className="btn sm ghost" style={{ cursor: 'pointer' }}><Icon name="paperclip" />Attach
                          <input type="file" hidden multiple onChange={async (e) => { for (const f of e.target.files) await run(() => api.upload(f, 'wiki', p.id), `Uploaded ${f.name}`); e.target.value = ''; page.reload(); }} /></label>}
                      </div>
                      {p.attachments.map(a => <div key={a.id} className="row small"><Icon name="paperclip" size={14} /><a href={`/api/attachments/${a.id}/download?inline=1`} target="_blank" rel="noreferrer">{a.filename}</a><span className="xs muted">{fmtSize(a.size)}</span></div>)}
                      {!p.attachments.length && <span className="xs muted">No files.</span>}
                    </div>
                  )}
                </div>
              </>
            )}
          </article>
        </div>
      )}
      {(modal === 'new' || modal?.newChild) && <NewPageModal project={project} pages={pages} parentId={modal?.newChild} onClose={() => setModal(null)} />}
      {modal === 'history' && p && <History page={p} canEdit={canEdit} onClose={() => setModal(null)} onRestore={async (c) => { setModal(null); await save(c); }} />}
    </div>
  );
}
