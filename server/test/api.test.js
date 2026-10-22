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
  return { get: u => call('GET', u), post: (u, b) => call('POST', u, b), patch: (u, b) => call('PATCH', u, b), put: (u, b) => call('PUT', u, b), del: (u, b) => call('DELETE', u, b) };
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
