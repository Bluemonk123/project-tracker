// End-to-end API test. Runs against a throwaway database.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-test-'));
process.env.DATA_DIR = tmp;
const { createApp } = await import('../index.js');

let server, base;
before(async () => {
  server = createApp().listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

function client() {
  let cookie = '';
  const call = async (method, url, body) => {
    const res = await fetch(base + url, {
      method, headers: { 'Content-Type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined,
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : await res.text();
    return { status: res.status, data };
  };
  return { cookie: () => cookie, get: u => call('GET', u), post: (u, b) => call('POST', u, b), patch: (u, b) => call('PATCH', u, b), put: (u, b) => call('PUT', u, b), del: (u, b) => call('DELETE', u, b) };
}

const admin = client();
const dev = client();
const outsider = client();
const ids = {};

test('first-run setup creates the administrator', async () => {
  assert.equal((await admin.get('/setup-status')).data.needsSetup, true);
  const r = await admin.post('/setup', { name: 'Asha Admin', email: 'admin@office.local', password: 'secret123' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await admin.post('/setup', { name: 'x', email: 'x@x', password: 'secret123' })).status, 400);
  const me = await admin.get('/auth/me');
  assert.equal(me.data.user.is_admin, 1);
});

test('admin creates users, roles and a team', async () => {
  const meta = (await admin.get('/meta')).data;
  ids.devRole = meta.roles.find(r => r.name === 'Developer').id;
  ids.pmRole = meta.roles.find(r => r.name === 'Project manager').id;
  ids.employee = meta.roles.find(r => r.name === 'Employee').id;
  let r = await admin.post('/admin/users', { name: 'Dev One', email: 'dev@office.local', password: 'password1', global_role_id: ids.employee });
  assert.equal(r.status, 201, JSON.stringify(r.data)); ids.dev = r.data.id;
  r = await admin.post('/admin/users', { name: 'Out Sider', email: 'out@office.local', password: 'password1', global_role_id: ids.employee });
  ids.out = r.data.id;
  r = await admin.post('/admin/roles', { name: 'Designer', scope: 'project', permissions: ['project.view', 'wp.view', 'bogus.perm'] });
  assert.equal(r.status, 201);
  const roles = (await admin.get('/admin/roles')).data;
  assert.deepEqual(roles.find(x => x.name === 'Designer').permissions, ['project.view', 'wp.view']);
  r = await admin.post('/teams', { name: 'Mobile', member_ids: [ids.dev] });
  assert.equal(r.status, 201); ids.team = r.data.id;
  assert.equal((await dev.post('/auth/login', { email: 'dev@office.local', password: 'password1' })).status, 200);
  assert.equal((await outsider.post('/auth/login', { email: 'out@office.local', password: 'password1' })).status, 200);
  assert.equal((await dev.post('/auth/login', { email: 'dev@office.local', password: 'nope' })).status, 401);
});

test('projects, members and visibility', async () => {
  let r = await admin.post('/projects', { name: 'Customer Portal', identifier: 'crm', description: 'Main CRM' });
  assert.equal(r.status, 201, JSON.stringify(r.data)); ids.project = r.data.id;
  assert.equal(r.data.identifier, 'CRM');
  assert.equal((await admin.post('/projects', { name: 'Dup', identifier: 'CRM' })).status, 400);
  assert.equal((await dev.post('/projects', { name: 'Nope', identifier: 'NOPE' })).status, 403);
  r = await admin.post(`/projects/${ids.project}/members`, { team_id: ids.team, role_id: ids.devRole });
  assert.equal(r.data.added, 1);
  assert.equal((await dev.get('/projects')).data.length, 1);
  assert.equal((await outsider.get('/projects')).data.length, 0);
  assert.equal((await outsider.get(`/projects/${ids.project}`)).status, 403);
  r = await dev.get('/projects/CRM');
  assert.equal(r.status, 200);
  assert.ok(r.data.permissions.includes('wp.create'));
  assert.ok(!r.data.permissions.includes('wp.delete'));
  r = await admin.post(`/projects/${ids.project}/versions`, { name: 'v1.0', due_date: '2030-01-01' });
  assert.equal(r.status, 201); ids.version = r.data.id;
});

test('work packages: create, edit rules, journal, relations', async () => {
  const meta = (await admin.get('/meta')).data;
  const inProgress = meta.statuses.find(s => s.name === 'In progress').id;
  const done = meta.statuses.find(s => s.name === 'Done').id;
  const req = meta.types.find(t => t.name === 'Requirement').id;
  let r = await admin.post('/work-packages', { project_id: ids.project, subject: 'Login requirement', type_id: req, version_id: ids.version });
  assert.equal(r.status, 201, JSON.stringify(r.data)); ids.reqWp = r.data.id;
  assert.equal(r.data.key, 'CRM-1');
  r = await admin.post('/work-packages', { project_id: ids.project, subject: 'Build login form', parent_id: ids.reqWp, assignee_id: ids.dev,
    start_date: '2026-01-01', due_date: '2026-01-05', estimated_hours: 6 });
  assert.equal(r.status, 201); ids.task = r.data.id;
  r = await admin.post('/work-packages', { project_id: ids.project, subject: 'Bad dates', start_date: '2026-02-02', due_date: '2026-01-01' });
  assert.equal(r.status, 400);
  // developer can edit own assigned task but not others
  r = await dev.patch(`/work-packages/${ids.task}`, { status_id: inProgress, notes: 'Started @[Asha Admin](user:1)' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await dev.patch(`/work-packages/${ids.reqWp}`, { subject: 'hack' })).status, 403);
  assert.equal((await dev.post('/work-packages', { project_id: ids.project, subject: 'x', assignee_id: 1 })).status, 403);
  r = await dev.post('/work-packages', { project_id: ids.project, subject: 'My own bug', assignee_id: ids.dev });
  assert.equal(r.status, 201); ids.bug = r.data.id;
  assert.equal((await outsider.get(`/work-packages/${ids.task}`)).status, 403);
  // cycles are rejected
  assert.equal((await admin.patch(`/work-packages/${ids.reqWp}`, { parent_id: ids.task })).status, 400);
  // relations
  r = await admin.post(`/work-packages/${ids.task}/relations`, { to_id: ids.bug, type: 'precedes' });
  assert.equal(r.status, 201);
  r = await admin.get(`/work-packages/${ids.task}`);
  assert.equal(r.data.relations.length, 1);
  assert.ok(r.data.journals.some(j => j.notes?.startsWith('Started')));
  assert.equal(r.data.ancestors[0].key, 'CRM-1');
  // closing sets 100%
  r = await admin.patch(`/work-packages/${ids.task}`, { status_id: done });
  assert.equal(r.data.done_ratio, 100);
  // admin got a mention notification
  const n = await admin.get('/notifications?unread=1');
  assert.ok(n.data.some(x => x.reason === 'mentioned'), JSON.stringify(n.data));
  // filtering
  r = await admin.get(`/work-packages?project_id=CRM&status=all&sort=key:asc`);
  assert.equal(r.data.total, 3);
  r = await admin.get(`/work-packages?q=CRM-2&status=all`);
  assert.equal(r.data.rows[0].id, ids.task);
  r = await dev.get('/work-packages?assignee_id=me');
  assert.equal(r.data.total, 1);
  r = await admin.get('/work-packages/export.csv?status=all');
  assert.ok(r.data.includes('Build login form'));
  r = await admin.patch('/work-packages-bulk', { ids: [ids.reqWp, ids.bug], changes: { priority_id: meta.priorities[2].id } });
  assert.equal(r.data.updated, 2);
  r = await dev.post(`/work-packages/${ids.reqWp}/comments`, { notes: 'Looks good' });
  assert.equal(r.status, 201);
});

test('time tracking with visibility rules', async () => {
  let r = await dev.post('/time-entries', { wp_id: ids.bug, hours: 2.5, activity: 'Development', spent_on: '2026-01-02' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal((await dev.post('/time-entries', { wp_id: ids.bug, hours: 30 })).status, 400);
  assert.equal((await outsider.post('/time-entries', { wp_id: ids.bug, hours: 1 })).status, 403);
  await admin.post('/time-entries', { project_id: ids.project, hours: 1 });
  assert.equal((await dev.get('/time-entries')).data.rows.length, 1);
  assert.equal((await admin.get('/time-entries')).data.rows.length, 2);
  r = await admin.get('/time-entries/report?rows=user&cols=activity');
  assert.ok(r.data.length >= 2);
});

test('meetings: recurring daily stand-up, agenda, actions, stand-up updates', async () => {
  let r = await admin.post('/meetings', {
    project_id: ids.project, title: 'Daily stand-up', kind: 'daily', starts_at: '2026-11-02T10:00', duration_minutes: 15,
    include_members: true, recurrence: { frequency: 'weekdays', until: '2026-11-13' }, agenda: [{ title: 'Blockers' }],
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.ids.length, 10);
  ids.meeting = r.data.id;
  r = await dev.get(`/meetings/${ids.meeting}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.participants.length, 2);
  assert.equal(r.data.agenda.length, 1);
  assert.equal(r.data.series.count, 10);
  assert.equal(r.data.can.manage, false);
  r = await dev.put(`/meetings/${ids.meeting}/standup`, { yesterday: 'Login form', today: 'Bug', blockers: 'Need API keys' });
  assert.equal(r.status, 200);
  r = await dev.post(`/meetings/${ids.meeting}/agenda`, { wp_id: ids.bug });
  assert.equal(r.status, 201);
  r = await admin.post(`/meetings/${ids.meeting}/actions`, { subject: 'Get API keys', assignee_id: ids.dev, due_date: '2026-11-04' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  r = await admin.get(`/meetings/${ids.meeting}`);
  assert.equal(r.data.actions.length, 1);
  assert.equal(r.data.standups[0].blockers, 'Need API keys');
  assert.equal((await dev.patch(`/meetings/${ids.meeting}`, { minutes: 'x' })).status, 403);
  r = await admin.patch(`/meetings/${ids.meeting}`, { minutes: 'All good', status: 'closed' });
  assert.equal(r.status, 200);
  r = await admin.post(`/meetings/${ids.meeting}/copy`, { starts_at: '2026-11-20 10:00' });
  assert.equal(r.status, 201);
  r = await admin.get(`/meetings/${ids.meeting}/summary`);
  assert.equal(r.status, 200);
  r = await dev.get(`/meetings/${ids.meeting}/standup-suggestions`);
  assert.equal(r.status, 200);
  assert.ok(r.data.doing.length >= 1);
  r = await admin.get('/meetings?project_id=CRM');
  assert.equal(r.data.length, 11);
  r = await admin.del(`/meetings/${ids.meeting}?scope=future`);
  assert.equal((await admin.get('/meetings?project_id=CRM')).data.length, 0); // copy joined the series too
  // weekly meeting without a project (manager only)
  assert.equal((await dev.post('/meetings', { title: 'All hands', starts_at: '2026-11-06 16:00' })).status, 403);
  r = await admin.post('/meetings', { title: 'Weekly managers', kind: 'weekly', starts_at: '2026-11-06 16:00', participant_ids: [ids.dev], recurrence: { frequency: 'weekly', count: 4 } });
  assert.equal(r.data.ids.length, 4);
  assert.equal((await dev.get(`/meetings/${r.data.id}`)).status, 200);
  assert.equal((await outsider.get(`/meetings/${r.data.id}`)).status, 403);
});

test('wiki, dashboard, reports, search, backups', async () => {
  let r = await dev.post(`/projects/${ids.project}/wiki`, { title: 'Requirements', content: '# Login\nMust support SSO' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  r = await dev.patch(`/wiki/${r.data.id}`, { content: '# Login\nMust support SSO and OTP' });
  assert.equal(r.status, 200);
  r = await dev.get('/dashboard');
  assert.equal(r.status, 200);
  assert.ok(r.data.myWork.length >= 1);
  r = await admin.get('/reports/portfolio');
  assert.equal(r.data.projects.length, 1);
  r = await admin.get('/reports/workload');
  assert.ok(r.data.find(x => x.name === 'Dev One').open_count >= 1);
  r = await admin.get('/search?q=login');
  assert.ok(r.data.workPackages.length >= 1 && r.data.wiki.length === 1);
  assert.equal((await outsider.get('/search?q=login')).data.workPackages.length, 0);
  r = await admin.post('/admin/backups');
  assert.equal(r.status, 201);
  assert.equal((await dev.get('/admin/backups')).status, 403);
  assert.equal((await dev.get('/admin/users')).status, 403);
});

test('locking a user ends their session', async () => {
  await admin.patch(`/admin/users/${ids.out}`, { status: 'locked' });
  assert.equal((await outsider.get('/auth/me')).status, 401);
  assert.equal((await admin.patch(`/admin/users/1`, { status: 'locked' })).status, 400);
});

test('key people: active, broken and unmapped links', async () => {
  let r = await admin.post('/projects', { name: 'Billing', identifier: 'BILL', manager_id: 1 });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const pid = r.data.id;
  let pos = (await admin.get(`/projects/${pid}`)).data.positions;
  assert.equal(pos.PM.status, 'active');
  assert.equal(pos.AM.status, 'unmapped');
  assert.equal(pos.BA.status, 'unmapped');
  assert.equal(pos.DT.status, 'unmapped');
  // single positions refuse two people; DT accepts many
  assert.equal((await admin.put(`/projects/${pid}/positions/AM`, { user_ids: [1, ids.dev] })).status, 400);
  r = await admin.put(`/projects/${pid}/positions/DT`, { user_ids: [ids.dev, 1] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.DT.active.length, 2);
  // mapping makes the person a project member, so the developer can now see it
  assert.ok((await dev.get('/projects')).data.some(p => p.id === pid));
  // developers cannot change key people
  assert.equal((await dev.put(`/projects/${pid}/positions/BA`, { user_ids: [ids.dev] })).status, 403);
  // map then unmap the BA -> broken
  await admin.put(`/projects/${pid}/positions/BA`, { user_ids: [ids.dev] });
  r = await admin.put(`/projects/${pid}/positions/BA`, { user_ids: [] });
  assert.equal(r.data.BA.status, 'broken');
  assert.equal(r.data.BA.removed[0].name, 'Dev One');
  // removing someone from the project breaks their links; DT stays active through the other person
  const members = (await admin.get(`/projects/${pid}/members`)).data;
  const devMember = members.find(m => m.user_id === ids.dev);
  await admin.del(`/projects/${pid}/members/${devMember.id}`);
  pos = (await admin.get(`/projects/${pid}`)).data.positions;
  assert.equal(pos.DT.status, 'active');
  assert.equal(pos.DT.active.length, 1);
  assert.equal(pos.DT.removed[0].reason, 'Removed from project');
  // PM follows the project manager field
  await admin.patch(`/projects/${pid}`, { manager_id: '' });
  pos = (await admin.get(`/projects/${pid}`)).data.positions;
  assert.equal(pos.PM.status, 'broken');
  // list and portfolio include positions
  const list = (await admin.get('/projects')).data.find(p => p.id === pid);
  assert.equal(list.positions.PM.status, 'broken');
  const port = (await admin.get('/reports/portfolio')).data;
  assert.ok(port.totals.team_gaps >= 1);
});

test('short key is generated from the project name when not given', async () => {
  let r = await admin.post('/projects', { name: 'Customer Portal' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.identifier, 'CP');
  r = await admin.post('/projects', { name: 'Customer Portal' });
  assert.equal(r.data.identifier, 'CP2');
  r = await admin.post('/projects', { name: 'Inventory' });
  assert.equal(r.data.identifier, 'INVENT');
  r = await admin.post('/projects', { name: '3D Viewer' });
  assert.match(r.data.identifier, /^[A-Z][A-Z0-9]{1,9}$/);
  r = await admin.post('/projects', { name: 'X' });
  assert.match(r.data.identifier, /^[A-Z][A-Z0-9]{1,9}$/);
});

test('kanban board: columns, date range, employee and project filters', async () => {
  const meta = (await admin.get('/meta')).data;
  const byName = (n) => meta.statuses.find(s => s.name === n);
  assert.ok(byName('In design') && byName('In testing'), 'new statuses exist');
  assert.equal(byName('In design').board_column, 'design');
  assert.equal(byName('In testing').board_column, 'testing');
  assert.equal(byName('Done').board_column, 'closed');
  const p = (await admin.post('/projects', { name: 'Board Test', identifier: 'BRD' })).data;
  await admin.post(`/projects/${p.id}/members`, { user_id: ids.dev, role_id: ids.devRole });
  const mk = (b) => admin.post('/work-packages', { project_id: p.id, ...b }).then(r => r.data);
  const inWeek = await mk({ subject: 'In week', start_date: '2026-09-07', due_date: '2026-09-09', assignee_id: ids.dev, status_id: byName('In design').id });
  const nextWeek = await mk({ subject: 'Next week', start_date: '2026-09-15', due_date: '2026-09-16' });
  const spanning = await mk({ subject: 'Spans the week', start_date: '2026-08-01', due_date: '2026-10-30' });
  const undated = await mk({ subject: 'No dates' });
  const q = `/board?from=2026-09-07&to=2026-09-11&project_id=${p.id}`;
  let r = await admin.get(q);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.columns.map(c => c.name), ['New', 'In Design', 'In Develop', 'In Testing', 'Closed']);
  const ids2 = r.data.rows.map(x => x.id);
  assert.ok(ids2.includes(inWeek.id) && ids2.includes(spanning.id) && ids2.includes(undated.id));
  assert.ok(!ids2.includes(nextWeek.id));
  assert.equal(r.data.rows.find(x => x.id === inWeek.id).board_column, 'design');
  r = await admin.get(q + '&undated=0');
  assert.ok(!r.data.rows.some(x => x.id === undated.id));
  r = await admin.get(q + `&assignee_id=${ids.dev}`);
  assert.deepEqual(r.data.rows.map(x => x.id), [inWeek.id]);
  r = await dev.get(q + '&assignee_id=me');
  assert.equal(r.data.rows[0].can_edit, true);
  assert.equal((await admin.get('/board?from=2026-10-23&to=2026-10-19')).status, 400);
  assert.equal((await admin.get('/board')).status, 400);
});

test('task links, attachment limits and assigning a non-member', async () => {
  const p = (await admin.post('/projects', { name: 'Attach Test', identifier: 'ATT' })).data;
  // dev is not a member yet; assigning adds them
  let r = await admin.post('/work-packages', { project_id: p.id, subject: 'With links', assignee_id: ids.dev,
    links: ['figma.com/file/abc', { url: 'https://docs.example.com/spec', title: 'Spec' }] });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const wp = r.data;
  assert.ok((await dev.get('/projects')).data.some(x => x.id === p.id), 'assignee became a member');
  r = await admin.get(`/work-packages/${wp.id}`);
  assert.deepEqual(r.data.links.map(l => l.url), ['https://figma.com/file/abc', 'https://docs.example.com/spec']);
  assert.equal(r.data.links[1].title, 'Spec');
  assert.equal((await admin.post('/work-packages', { project_id: p.id, subject: 'Bad', links: ['javascript:alert(1)'] })).status, 400);
  r = await admin.post(`/work-packages/${wp.id}/links`, { url: 'http://test.local/build' });
  assert.equal(r.status, 201);
  assert.equal((await admin.del(`/links/${r.data.id}`)).status, 200);
  // uploads: only photo/pdf/zip, at most 5
  const up = async (name) => {
    const fd = new FormData();
    fd.append('container_type', 'wp'); fd.append('container_id', String(wp.id));
    fd.append('file', new Blob(['x']), name);
    const res = await fetch(base + '/attachments', { method: 'POST', body: fd, headers: { cookie: admin.cookie() } });
    return res.status;
  };
  assert.equal(await up('notes.exe'), 400);
  for (const n of ['a.png', 'b.JPG', 'c.pdf', 'd.zip', 'e.webp']) assert.equal(await up(n), 201, n);
  assert.equal(await up('f.png'), 400);
});

test('project technologies: add, edit, list, permissions', async () => {
  const p = (await admin.post('/projects', { name: 'Tech Test', identifier: 'TECH' })).data;
  const cat = (await admin.get('/tech/catalog')).data;
  assert.ok(cat.catalog.some(c => c.name === 'React' && c.source === 'npm'));
  let r = await admin.post(`/projects/${p.id}/technologies`, { name: 'Internal SDK', category: 'Backend', version_used: '2.1', source: 'none', notes: 'Our own library' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const id = r.data.id;
  assert.equal((await admin.post(`/projects/${p.id}/technologies`, { name: 'internal sdk' })).status, 400, 'duplicates refused');
  assert.equal((await admin.post(`/projects/${p.id}/technologies`, { name: 'X', source: 'bogus' })).status, 400);
  r = await admin.patch(`/technologies/${id}`, { version_used: '2.2' });
  assert.equal(r.status, 200);
  r = await admin.get(`/projects/${p.id}/technologies`);
  assert.equal(r.data.rows.length, 1);
  assert.equal(r.data.rows[0].version_used, '2.2');
  assert.equal(r.data.rows[0].assessment.status, 'unknown');
  assert.equal(r.data.can_edit, true);
  // a developer who is not a project editor cannot change the list
  await admin.post(`/projects/${p.id}/members`, { user_id: ids.dev, role_id: ids.devRole });
  assert.equal((await dev.post(`/projects/${p.id}/technologies`, { name: 'Y' })).status, 403);
  assert.equal((await dev.get(`/projects/${p.id}/technologies`)).data.can_edit, false);
  // ...but can update the version used (Developer role has tech.version), and nothing else
  assert.equal((await dev.get(`/projects/${p.id}/technologies`)).data.can_version, true);
  r = await dev.patch(`/technologies/${id}`, { version_used: '2.3' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await dev.patch(`/technologies/${id}`, { version_used: '2.4', name: 'Renamed' })).status, 403);
  assert.equal((await dev.patch(`/technologies/${id}`, { notes: 'x' })).status, 403);
  assert.equal((await dev.del(`/technologies/${id}`)).status, 403);
  const row = (await admin.get(`/projects/${p.id}/technologies`)).data.rows[0];
  assert.equal(row.version_used, '2.3');
  assert.equal(row.version_updated_by_name, 'Dev One');
  assert.ok(row.version_updated_at);
  // someone outside the project cannot
  assert.ok([401, 403].includes((await outsider.patch(`/technologies/${id}`, { version_used: '9' })).status));
  // rename: allowed for managers, refused when the name is taken
  const other = (await admin.post(`/projects/${p.id}/technologies`, { name: 'Other Lib' })).data.id;
  assert.equal((await admin.patch(`/technologies/${other}`, { name: 'INTERNAL sdk' })).status, 400);
  assert.equal((await admin.patch(`/technologies/${other}`, { name: 'Renamed Lib' })).status, 200);
  r = await admin.get('/technologies');
  assert.ok(r.data.rows.some(t => t.name === 'Internal SDK' && t.project_identifier === 'TECH' && t.can_manage === true));
  assert.ok(r.data.rows.some(t => t.name === 'Renamed Lib'));
  assert.equal((await dev.get('/technologies')).data.rows.find(t => t.id === id).can_manage, false);
  assert.equal((await admin.del(`/technologies/${other}`)).status, 200);
  assert.equal((await admin.del(`/technologies/${id}`)).status, 200);
});

test('stages: designer, developer and tester get the task as it moves', async () => {
  const meta = (await admin.get('/meta')).data;
  const st = (n) => meta.statuses.find(s => s.name === n).id;
  const tester = client();
  const t = (await admin.post('/admin/users', { name: 'Tess Tester', email: 'tess@office.local', password: 'password1', global_role_id: ids.employee })).data;
  await tester.post('/auth/login', { email: 'tess@office.local', password: 'password1' });
  const p = (await admin.post('/projects', { name: 'Stage Test', identifier: 'STG' })).data;
  await admin.post(`/projects/${p.id}/members`, { user_id: ids.dev, role_id: ids.devRole });
  // starts in design with no assignee: goes to the designer (admin here)
  let r = await admin.post('/work-packages', { project_id: p.id, subject: 'Login screen', status_id: st('In design'),
    designer_id: (await admin.get('/auth/me')).data.user.id, developer_id: ids.dev, tester_id: t.id });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const wp = r.data;
  assert.equal(wp.assignee_id, wp.designer_id);
  assert.equal(wp.tester_name, 'Tess Tester');
  assert.ok((await tester.get('/projects')).data.some(x => x.id === p.id), 'tester was added to the project');
  // to develop: the developer gets it and is notified
  r = await admin.patch(`/work-packages/${wp.id}`, { status_id: st('In progress') });
  assert.equal(r.data.assignee_id, ids.dev);
  // the developer (edit own only) moves it to testing: tester gets it
  r = await dev.patch(`/work-packages/${wp.id}`, { status_id: st('In testing') });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.assignee_id, t.id);
  const n = (await tester.get('/notifications?unread=1')).data;
  assert.ok(n.some(x => x.wp_id === wp.id && /In Testing/.test(x.message)), JSON.stringify(n));
  // an explicit assignee in the same change wins
  r = await admin.patch(`/work-packages/${wp.id}`, { status_id: st('In progress'), assignee_id: null });
  assert.equal(r.data.assignee_id, null);
  // changing the person of the current stage hands it over when it was unassigned
  r = await admin.patch(`/work-packages/${wp.id}`, { developer_id: t.id });
  assert.equal(r.data.assignee_id, t.id);
  // a developer cannot name someone else as tester
  assert.equal((await dev.patch(`/work-packages/${wp.id}`, { tester_id: ids.out })).status, 403);
  // stage history and filters
  const d = (await admin.get(`/work-packages/${wp.id}`)).data;
  assert.deepEqual(d.stages.map(s => s.stage), ['design', 'develop', 'testing', 'develop']);
  assert.ok(d.stages.slice(0, -1).every(s => s.left_at) && !d.stages.at(-1).left_at);
  r = await admin.get(`/work-packages?project_id=${p.id}&tester_id=${t.id}`);
  assert.deepEqual(r.data.rows.map(x => x.id), [wp.id]);
});

test('backup copies to a folder', async () => {
  const dir = path.join(tmp, 'cloud', 'Project Tracker Backups');
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  assert.equal((await dev.put('/admin/backup-copy', { dir })).status, 403);
  const def = (await admin.get('/admin/backup-copy')).data;
  assert.ok(def.dir.endsWith('Backup copies') && def.dir === def.default_dir, 'defaults to the app folder');
  assert.equal((await admin.put('/admin/backup-copy', { dir: 'not/absolute' })).status, 400);
  let r = await admin.put('/admin/backup-copy', { dir, hours: 4, keep_days: 30 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.last.ok, true, JSON.stringify(r.data.last));
  const copies = fs.readdirSync(path.join(dir, 'database'));
  assert.equal(copies.length, 1);
  const zlib = await import('node:zlib');
  const head = zlib.gunzipSync(fs.readFileSync(path.join(dir, 'database', copies[0]))).subarray(0, 15).toString();
  assert.equal(head, 'SQLite format 3');
  assert.ok(fs.existsSync(path.join(dir, 'HOW TO RESTORE.txt')));
});

test('project board: brief, customer roles and documents', async () => {
  const p = (await admin.post('/projects', { name: 'Board Info', identifier: 'PBI' })).data;
  await admin.post(`/projects/${p.id}/members`, { user_id: ids.dev, role_id: ids.devRole });
  let r = await admin.get(`/projects/${p.id}/board-info`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.documents.map(d => d.key), ['01', '02', '03', '04', '05', '06', '07']);
  assert.equal(r.data.documents[1].name, 'Business Requirements');
  assert.equal(r.data.can.brief, true);
  // save brief, customer and roles
  r = await admin.put(`/projects/${p.id}/board-info`, { description: 'A portal.', customer_name: 'Acme Ltd',
    customer_roles: [{ name: 'Admin', description: 'Runs it' }, { name: 'Agent' }] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await admin.put(`/projects/${p.id}/board-info`, { customer_roles: [{ name: 'A' }, { name: 'a' }] })).status, 400);
  r = await admin.get(`/projects/${p.id}/board-info`);
  assert.equal(r.data.project.customer_name, 'Acme Ltd');
  assert.equal(r.data.project.description, 'A portal.');
  assert.deepEqual(r.data.customer_roles.map(x => x.name), ['Admin', 'Agent']);
  assert.ok(r.data.members.some(m => m.user_id === ids.dev));
  // upload two versions of document 02
  const slotIds = Object.fromEntries(r.data.documents.map(d => [d.key, d.id]));
  const up = async (who, slot, name, body = 'x') => {
    const fd = new FormData(); fd.append('file', new Blob([body]), name);
    return (await fetch(`${base}/projects/${p.id}/documents/${slotIds[slot] ?? 99999}`, { method: 'POST', body: fd, headers: { cookie: who.cookie() } })).status;
  };
  assert.equal(await up(admin, '02', 'brd-v1.docx'), 201);
  assert.equal(await up(admin, '02', 'brd-v2.docx', 'second'), 201);
  assert.equal(await up(admin, '09', 'x.pdf'), 404);
  // a developer can see and download but not upload or edit
  assert.equal(await up(dev, '01', 'x.pdf'), 403);
  assert.equal((await dev.put(`/projects/${p.id}/board-info`, { customer_name: 'X' })).status, 403);
  r = await dev.get(`/projects/${p.id}/board-info`);
  assert.equal(r.data.can.documents, false);
  const d2 = r.data.documents[1];
  assert.equal(d2.latest.filename, 'brd-v2.docx');
  assert.equal(d2.versions.length, 2);
  const file = await fetch(`${base}/attachments/${d2.latest.id}/download`, { headers: { cookie: dev.cookie() } });
  assert.equal(await file.text(), 'second');
  // go live, customer status, links, environments, personas, delivery figures
  r = await admin.put(`/projects/${p.id}/board-info`, { board: { live_version: '2.1', customer_demo: 'Scheduled', customer_approval: 'Pending',
    hosting: { staging: 'https://staging.example.com', production: '' }, environments: ['production', 'localhost', 'bogus'],
    customer_details: { contact_person: 'Ravi', email: 'ravi@example.com' } },
    customer_roles: [{ name: 'Store manager', pain_points: 'Too many calls', challenges: 'Slow network', touch_points: 'Email' }] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await admin.put(`/projects/${p.id}/board-info`, { board: { customer_demo: 'Maybe' } })).status, 400);
  assert.equal((await admin.put(`/projects/${p.id}/board-info`, { board: { repository: { staging: 'javascript:alert(1)' } } })).status, 400);
  await admin.post('/work-packages', { project_id: p.id, subject: 'One' });
  r = await admin.get(`/projects/${p.id}/board-info`);
  const bd = r.data.board;
  assert.equal(bd.live_version, '2.1'); assert.equal(bd.live_phase, null);
  assert.equal(bd.customer_demo, 'Scheduled'); assert.equal(bd.customer_approval, 'Pending');
  assert.deepEqual(bd.environments, ['localhost', 'production']);
  assert.equal(bd.hosting.staging, 'https://staging.example.com');
  assert.equal(bd.customer_details.contact_person, 'Ravi');
  assert.equal(r.data.customer_roles[0].pain_points, 'Too many calls');
  assert.equal(r.data.delivery.tasks, 1);
  assert.ok(Array.isArray(r.data.delivery.testing_status_ids) && r.data.delivery.testing_status_ids.length > 0);
  assert.equal((await dev.put(`/projects/${p.id}/board-info`, { board: { customer_demo: 'Yes' } })).status, 403);
  // approvals: module with first and second approver
  const me = (await admin.get('/auth/me')).data.user.id;
  r = await admin.post(`/projects/${p.id}/approvals`, { module: 'Orders', first_approver_id: me, second_approver_id: ids.dev });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const apId = r.data.id;
  assert.equal((await admin.post(`/projects/${p.id}/approvals`, { module: 'orders' })).status, 400, 'duplicate module');
  assert.equal((await admin.post(`/projects/${p.id}/approvals`, { module: 'Same', first_approver_id: me, second_approver_id: me })).status, 400);
  assert.equal((await admin.post(`/projects/${p.id}/approvals`, { module: '' })).status, 400);
  assert.equal((await dev.post(`/projects/${p.id}/approvals`, { module: 'X' })).status, 403);
  assert.ok((await dev.get('/notifications?unread=1')).data.some(n => /second approver for "Orders"/.test(n.message)));
  assert.equal((await admin.patch(`/approvals/${apId}`, { module: 'Order management', second_approver_id: null })).status, 200);
  r = await admin.get(`/projects/${p.id}/board-info`);
  assert.equal(r.data.approvals[0].module, 'Order management');
  assert.equal(r.data.approvals[0].first_approver_id, me);
  assert.equal(r.data.approvals[0].second_approver_id, null);
  // Done: the approver themselves or a project lead; changing the approver resets it
  await admin.patch(`/approvals/${apId}`, { second_approver_id: ids.dev });
  assert.equal((await dev.post(`/approvals/${apId}/done`, { which: 'first' })).status, 403, 'dev is not the first approver');
  assert.equal((await admin.post(`/approvals/${apId}/done`, { which: 'first' })).status, 200);
  assert.ok((await dev.get('/notifications?unread=1')).data.some(n => /waits for you/.test(n.message)));
  assert.equal((await dev.post(`/approvals/${apId}/done`, { which: 'second' })).status, 200);
  let ap = (await admin.get(`/projects/${p.id}/board-info`)).data.approvals[0];
  assert.ok(ap.first_done_at && ap.second_done_at);
  assert.equal(ap.second_done_by_name, 'Dev One');
  assert.equal((await dev.post(`/approvals/${apId}/done`, { which: 'second', done: false })).status, 200);
  await admin.patch(`/approvals/${apId}`, { first_approver_id: ids.dev, second_approver_id: me });
  ap = (await admin.get(`/projects/${p.id}/board-info`)).data.approvals[0];
  assert.equal(ap.first_done_at, null, 'new approver starts not done');
  assert.equal((await dev.del(`/approvals/${apId}`)).status, 403);
  assert.equal((await admin.del(`/approvals/${apId}`)).status, 200);
  // sections: approvals added without a section went into "Approvals"; new sections come first
  r = await admin.get(`/projects/${p.id}/board-info`);
  assert.deepEqual(r.data.approval_sections.map(x => x.name), ['Approvals']);
  const sec = (await admin.post(`/projects/${p.id}/approval-sections`, { name: 'UAT sign-off' })).data.id;
  assert.equal((await admin.post(`/projects/${p.id}/approval-sections`, { name: 'uat sign-off' })).status, 400);
  assert.equal((await dev.post(`/projects/${p.id}/approval-sections`, { name: 'X' })).status, 403);
  assert.equal((await admin.post(`/projects/${p.id}/approvals`, { module: 'Orders', section_id: sec, first_approver_id: me })).status, 201, 'same module allowed in another section');
  assert.equal((await admin.post(`/projects/${p.id}/approvals`, { module: 'Orders', section_id: sec })).status, 400);
  r = await admin.get(`/projects/${p.id}/board-info`);
  assert.equal(r.data.approval_sections[0].name, 'UAT sign-off');
  assert.equal(r.data.approvals.filter(x => x.section_id === sec).length, 1);
  assert.equal((await admin.patch(`/approval-sections/${sec}`, { name: 'UAT sign-off v2' })).status, 200);
  r = await admin.del(`/approval-sections/${sec}`);
  assert.equal(r.data.approvals_removed, 1);
  // upload limit from Administration applies straight away
  assert.equal((await admin.patch('/admin/settings', { max_upload_mb: 0 })).status, 400);
  assert.equal((await admin.patch('/admin/settings', { max_upload_mb: 1 })).status, 200);
  assert.equal((await admin.get('/meta')).data.maxUploadMb, 1);
  assert.equal(await up(admin, '07', 'big.zip', 'x'.repeat(1.5 * 1024 * 1024)), 400);
  assert.equal(await up(admin, '07', 'small.zip', 'x'.repeat(1000)), 201);
  await admin.patch('/admin/settings', { max_upload_mb: 25 });
  // the document list can be renamed, added to and trimmed
  assert.equal((await admin.post(`/projects/${p.id}/document-slots`, { name: 'Test Cases', detail: 'Regression' })).status, 201);
  assert.equal((await admin.post(`/projects/${p.id}/document-slots`, { name: 'test cases' })).status, 400);
  assert.equal((await dev.post(`/projects/${p.id}/document-slots`, { name: 'X' })).status, 403);
  assert.equal((await admin.patch(`/document-slots/${slotIds['01']}`, { name: 'Product Vision' })).status, 200);
  r = await admin.del(`/document-slots/${slotIds['02']}`);
  assert.equal(r.data.files_removed, 2);
  r = await admin.get(`/projects/${p.id}/board-info`);
  assert.deepEqual(r.data.documents.map(d => `${d.key} ${d.name}`).slice(0, 2), ['01 Product Vision', '02 Personas & Journeys']);
  assert.equal(r.data.documents.at(-1).name, 'Test Cases');
  assert.equal(r.data.documents.at(-1).key, '07');
  assert.equal(r.data.documents.find(d => d.name === 'Design System').latest.filename, 'small.zip');
  // release notes: document name + version, with files
  r = await admin.post(`/projects/${p.id}/release-notes`, { name: 'Release notes', version: '1.4.0' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const rn = r.data.id;
  assert.equal((await admin.post(`/projects/${p.id}/release-notes`, { name: 'release notes', version: '1.4.0' })).status, 400);
  assert.equal((await admin.post(`/projects/${p.id}/release-notes`, { name: 'No version' })).status, 400);
  assert.equal((await dev.post(`/projects/${p.id}/release-notes`, { name: 'X', version: '1' })).status, 403);
  const upNote = async (who, body, name) => {
    const fd = new FormData(); fd.append('file', new Blob([body]), name);
    return fetch(`${base}/release-notes/${rn}/files`, { method: 'POST', body: fd, headers: { cookie: who.cookie() } });
  };
  assert.equal((await upNote(admin, 'notes v1', 'rn-1.4.0.pdf')).status, 201);
  assert.equal((await upNote(admin, 'changelog', 'changelog.txt')).status, 201);
  assert.equal((await upNote(dev, 'x', 'x.txt')).status, 403);
  r = await dev.get(`/projects/${p.id}/board-info`);
  const note = r.data.release_notes[0];
  assert.equal(note.version, '1.4.0');
  assert.deepEqual(note.files.map(f => f.filename).sort(), ['changelog.txt', 'rn-1.4.0.pdf']);
  assert.ok(r.data.documents.every(d => d.versions.every(v => !v.doc_slot.startsWith('rn:'))), 'release note files stay out of documents');
  assert.equal((await admin.del(`/release-notes/${rn}/files/${note.files[0].id}`)).status, 200);
  assert.equal((await admin.patch(`/release-notes/${rn}`, { version: '1.4.1' })).status, 200);
  r = await admin.del(`/release-notes/${rn}`);
  assert.equal(r.data.files_removed, 1);
  assert.equal((await admin.get(`/projects/${p.id}/board-info`)).data.release_notes.length, 0);
});
