// Ticket Board (helpdesk) end-to-end API test. Runs against a throwaway database.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-tickets-'));
process.env.DATA_DIR = tmp;
const { createApp } = await import('../index.js');
const { get, run, all } = await import('../db.js');
const { resetRateLimits } = await import('../routes/tickets.js');

let server, base;
before(async () => {
  server = createApp().listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

function client({ csrf = true } = {}) {
  const jar = {};
  const cookie = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
  const call = async (method, url, body) => {
    if (csrf && method !== 'GET' && !jar.pt_csrf) await call('GET', '/health');
    const isForm = body instanceof FormData;
    const headers = { cookie: cookie() };
    if (csrf) headers['x-csrf-token'] = jar.pt_csrf || '';
    if (!isForm) headers['Content-Type'] = 'application/json';
    const res = await fetch(base + url, { method, headers, body: isForm ? body : body ? JSON.stringify(body) : undefined });
    for (const sc of res.headers.getSetCookie()) {
      const [kv] = sc.split(';'); const i = kv.indexOf('=');
      if (kv.slice(i + 1)) jar[kv.slice(0, i)] = kv.slice(i + 1); else delete jar[kv.slice(0, i)];
    }
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, data: ct.includes('json') ? await res.json() : await res.text(), headers: res.headers };
  };
  return { jar, get: u => call('GET', u), post: (u, b) => call('POST', u, b), patch: (u, b) => call('PATCH', u, b), put: (u, b) => call('PUT', u, b), del: (u, b) => call('DELETE', u, b) };
}
const form = (fields, files = []) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) fd.append(k, String(v));
  for (const [name, bytes] of files) fd.append('files', new Blob([bytes]), name);
  return fd;
};
const PNG = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const notes = (uid) => all('SELECT * FROM notifications WHERE user_id = ? ORDER BY id', uid);

const admin = client(), agent = client(), staff = client(), other = client(), guest = client();
const ids = {};

test('setup: admin, an agent role, a member of staff', async () => {
  await admin.post('/setup', { name: 'Asha Admin', email: 'admin@office.local', password: 'secret123' });
  const meta = (await admin.get('/meta')).data;
  const employee = meta.roles.find(r => r.name === 'Employee').id;
  let r = await admin.post('/admin/roles', { name: 'Helpdesk agent', scope: 'global', permissions: ['tickets.view', 'tickets.create', 'tickets.edit'] });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const agentRole = r.data.id;
  r = await admin.post('/admin/roles', { name: 'Board viewer', scope: 'global', permissions: ['tickets.view'] });
  ids.viewerRole = r.data.id;
  ids.agent = (await admin.post('/admin/users', { name: 'Ravi Agent', email: 'ravi@office.local', password: 'password1', global_role_id: agentRole })).data.id;
  ids.staff = (await admin.post('/admin/users', { name: 'Sam Staff', email: 'sam@office.local', password: 'password1', global_role_id: employee })).data.id;
  ids.other = (await admin.post('/admin/users', { name: 'Olga Other', email: 'olga@office.local', password: 'password1', global_role_id: employee })).data.id;
  ids.admin = get("SELECT id FROM users WHERE email = 'admin@office.local'").id;
  for (const [c, e] of [[agent, 'ravi'], [staff, 'sam'], [other, 'olga']]) assert.equal((await c.post('/auth/login', { email: `${e}@office.local`, password: 'password1' })).status, 200);
  const perms = (await agent.get('/auth/me')).data.permissions;
  assert.ok(perms.includes('tickets.edit'));
});

test('CSRF: a change without the token is refused', async () => {
  const bare = client({ csrf: false });
  const r = await bare.post('/auth/login', { email: 'sam@office.local', password: 'password1' });
  assert.equal(r.status, 403);
  assert.equal(r.data.code, 'csrf');
});

test('intake 1: Raise Ticket creates an open Support ticket and alerts admins and agents', async () => {
  const r = await staff.post('/tickets/raise', form({ subject: '', description: 'Printer on floor 2 is offline\nsecond line' }, [['shot.png', PNG]]));
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.ticket_no, 10000001);
  assert.deepEqual(r.data.warnings, []);
  ids.t1 = r.data.ticket_no;
  const t = get('SELECT * FROM tickets WHERE ticket_no = ?', ids.t1);
  assert.equal(t.status, 'open'); assert.equal(t.group_name, 'Support'); assert.equal(t.channel, 'web'); assert.equal(t.requester_user_id, ids.staff);
  assert.ok(notes(ids.admin).some(n => n.reason === 'ticket_new' && n.message.startsWith('New Ticket 10000001')));
  assert.ok(notes(ids.agent).some(n => n.reason === 'ticket_new'));
  assert.equal(get('SELECT COUNT(*) AS n FROM audit_log WHERE action = ? AND entity_id = ?', 'TICKET_CREATED', t.id).n, 1);
  assert.equal((await staff.post('/tickets/raise', form({ description: '  ' }))).status, 400);
});

test('attachments: bad files are refused, the ticket is still created', async () => {
  const docxMacro = Buffer.concat([Buffer.from([0x50, 0x4B, 0x03, 0x04]), Buffer.from('[Content_Types].xml word/vbaProject.bin')]);
  const r = await staff.post('/tickets/raise', form({ description: 'Bad files' }, [
    ['fake.png', Buffer.from('<html>not a png</html>')],
    ['logo.svg', Buffer.from('<svg/>')],
    ['book.xlsm', Buffer.from([0x50, 0x4B, 0x03, 0x04, 1, 2])],
    ['big.png', Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)])],
    ['macro.docx', docxMacro],
  ]));
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.warnings.length, 5, JSON.stringify(r.data.warnings));
  assert.match(r.data.warnings.join(' '), /do not match a \.png/);
  assert.match(r.data.warnings.join(' '), /macros/);
  assert.match(r.data.warnings.join(' '), /over 5 MB/);
  const t = get('SELECT id FROM tickets WHERE ticket_no = ?', r.data.ticket_no);
  assert.equal(get('SELECT COUNT(*) AS n FROM ticket_attachments WHERE ticket_id = ?', t.id).n, 0);
  run('DELETE FROM tickets WHERE id = ?', t.id);
  // a good file is stored under a generated name and can be downloaded by an agent, not by another member of staff
  const a = get('SELECT * FROM ticket_attachments WHERE ticket_id = (SELECT id FROM tickets WHERE ticket_no = ?)', ids.t1);
  assert.match(a.stored_name, /^tkt_10000001_1_\d+[0-9a-f]{4}\.png$/);
  assert.equal((await agent.get(`/ticket-attachments/${a.id}`)).status, 200);
  assert.equal((await staff.get(`/ticket-attachments/${a.id}`)).status, 200);
  assert.equal((await other.get(`/ticket-attachments/${a.id}`)).status, 404);
});

test('intake 2: login page form (no sign-in), email checked, rate limited', async () => {
  resetRateLimits();
  let r = await guest.post('/public/contact', form({ name: 'Visitor', email: 'not-an-email', description: 'Cannot sign in' }));
  assert.equal(r.status, 400);
  r = await guest.post('/public/contact', form({ name: '[ACME] Fake', description: 'x' }));
  assert.equal(r.status, 400);
  r = await guest.post('/public/contact', form({ name: 'Vera Visitor', email: 'Vera@Example.com', description: 'Cannot sign in' }));
  assert.equal(r.status, 201, JSON.stringify(r.data));
  ids.tGuest = r.data.ticket_no;
  const t = get('SELECT * FROM tickets WHERE ticket_no = ?', ids.tGuest);
  assert.equal(t.feedback, '[From login page] Cannot sign in');
  assert.equal(t.requester_email, 'vera@example.com');
  assert.equal(t.requester_kind, 'guest');
  assert.equal(t.group_name, 'Support');
  for (let i = 0; i < 2; i++) await guest.post('/public/contact', form({ name: 'Spam', description: 'x' }));
  r = await guest.post('/public/contact', form({ name: 'Spam', description: 'x' }));
  assert.equal(r.status, 429);
  run("DELETE FROM tickets WHERE raised_by = 'Spam'");
  resetRateLimits();
});

test('permissions: no Ticket Board permission, no board', async () => {
  for (const [m, u, b] of [['get', '/ticket-board'], ['get', `/tickets/${ids.t1}`], ['patch', `/tickets/${ids.t1}`, { priority: 'high' }],
    ['post', `/tickets/${ids.t1}/take`, {}], ['post', `/tickets/${ids.t1}/reply`, { body: 'hi' }], ['post', '/ticket-board/tickets', { subject: 'x', description: 'y', requester_name: 'Z' }]]) {
    assert.equal((await other[m](u, b)).status, 403, `${m} ${u}`);
  }
  // Enable only: can open the board, cannot add or edit
  await admin.patch(`/admin/users/${ids.other}`, { global_role_id: ids.viewerRole });
  assert.equal((await other.get('/ticket-board')).status, 200);
  assert.equal((await other.get('/ticket-board')).data.can.add, false);
  assert.equal((await other.patch(`/tickets/${ids.t1}`, { priority: 'high' })).status, 403);
  assert.equal((await other.post('/ticket-board/tickets', { subject: 'x', description: 'y', requester_name: 'Z' })).status, 403);
});

test('intake 5: agent New ticket with channel agent and a first activity line', async () => {
  let r = await agent.post('/ticket-board/tickets', { requester_name: 'Phone Caller', requester_email: 'caller@example.com', subject: '', description: 'x' });
  assert.equal(r.status, 400); // subject required here
  r = await agent.post('/ticket-board/tickets', { requester_user_id: ids.staff, subject: 'VPN drops', priority: 'urgent', ticket_type: 'issue', group_name: 'Development', description: 'Every 10 minutes' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  ids.t2 = r.data.ticket_no;
  const t = get('SELECT * FROM tickets WHERE ticket_no = ?', ids.t2);
  assert.equal(t.channel, 'agent'); assert.equal(t.priority, 'urgent'); assert.equal(t.group_name, 'Development');
  assert.equal(get('SELECT body FROM ticket_messages WHERE ticket_id = ? ORDER BY id LIMIT 1', t.id).body, 'Ticket created by Ravi Agent');
  assert.equal((await agent.post('/ticket-board/tickets', { requester_name: 'X', subject: 'y', description: 'z', priority: 'low' })).status, 400);
});

test('dashboard: counts, charts, views and filters match the data', async () => {
  const r = await agent.get('/ticket-board');
  assert.equal(r.status, 200);
  const d = r.data;
  assert.equal(d.counts.total, 3);
  assert.equal(d.counts.unsolved, 3);
  assert.equal(d.counts.unassigned, 3);
  assert.equal(d.charts.status.open, 3);
  assert.equal(d.charts.priority.urgent, 1);
  assert.equal(d.charts.group.Development, 1);
  assert.equal(d.view, 'unsolved'); // nothing assigned to me yet
  assert.equal(d.views.length, 7);
  assert.equal(d.rows.length, 3);
  assert.ok(d.rows[0].sla.label);
  const f = await agent.get('/ticket-board?card=unassigned&priority=urgent');
  assert.deepEqual(f.data.rows.map(x => x.ticket_no), [ids.t2]);
  assert.equal(f.data.card, 'unassigned');
  assert.equal((await agent.get('/ticket-board?view=urgent_high')).data.rows.length, 1);
});

test('reply + Submit as Pending: stored, status set, logged, staff requester alerted; auto-assigned to replier', async () => {
  const before = notes(ids.staff).length;
  let r = await agent.post(`/tickets/${ids.t1}/reply`, form({ body: '', status: 'open' }));
  assert.equal(r.status, 400);
  assert.match(r.data.error, /Write a reply or change the status/);
  r = await agent.post(`/tickets/${ids.t1}/reply`, form({ body: 'Can you send the printer name?', status: 'pending' }, [['log.pdf', Buffer.from('%PDF-1.4 test')]]));
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const t = get('SELECT * FROM tickets WHERE ticket_no = ?', ids.t1);
  assert.equal(t.status, 'pending');
  assert.equal(t.assignee_id, ids.agent);
  const lines = all("SELECT body FROM ticket_messages WHERE ticket_id = ? AND author_type = 'system'", t.id).map(m => m.body);
  assert.ok(lines.includes('Assigned to Ravi Agent (replied)'));
  assert.ok(lines.includes('Status changed from Open to Pending'));
  const n = notes(ids.staff).slice(before);
  assert.equal(n.length, 1);
  assert.match(n[0].message, /^Reply on ticket 10000001: Ravi Agent replied: Can you send the printer name\? Status is now Pending\./);
  assert.equal(n[0].link, '/tickets-raised?ticket=10000001');
  assert.equal(get('SELECT COUNT(*) AS n FROM ticket_attachments WHERE message_id IS NOT NULL AND ticket_id = ?', t.id).n, 1);
  // internal note: never reaches the requester
  const before2 = notes(ids.staff).length;
  r = await agent.post(`/tickets/${ids.t1}/reply`, form({ body: 'Secret: printer is being replaced', internal: '1' }));
  assert.equal(r.status, 201);
  assert.equal(notes(ids.staff).length, before2);
  // the view now defaults to "Your unsolved tickets"
  assert.equal((await agent.get('/ticket-board')).data.view, 'mine');
});

test('SLA: hold pauses the clock, reopening adds the paused time; breached shows and counts', async () => {
  const t0 = get('SELECT * FROM tickets WHERE ticket_no = ?', ids.t2);
  assert.equal((await agent.patch(`/tickets/${ids.t2}`, { status: 'hold' })).status, 200);
  let d = (await agent.get(`/tickets/${ids.t2}`)).data;
  assert.equal(d.ticket.sla.state, 'paused');
  run('UPDATE tickets SET hold_started_at = ? WHERE id = ?', new Date(Date.now() - 2 * 3600e3).toISOString(), t0.id);
  await agent.patch(`/tickets/${ids.t2}`, { status: 'open' });
  const t = get('SELECT * FROM tickets WHERE id = ?', t0.id);
  assert.ok(Math.abs(t.sla_paused_seconds - 7200) < 5, String(t.sla_paused_seconds));
  assert.equal(t.hold_started_at, null);
  d = (await agent.get(`/tickets/${ids.t2}`)).data;
  assert.equal(d.ticket.sla.state, 'ok'); // urgent 4h + 2h paused
  assert.match(d.ticket.sla.label, /^5h left$/);
  run('UPDATE tickets SET raised_on = ? WHERE id = ?', new Date(Date.now() - 7 * 3600e3).toISOString(), t0.id);
  d = (await agent.get(`/tickets/${ids.t2}`)).data;
  assert.equal(d.ticket.sla.state, 'breached');
  assert.equal(d.ticket.sla.label, 'Breached 1h');
  assert.equal((await agent.get('/ticket-board')).data.counts.breached, 1);
  assert.equal((await agent.get('/ticket-board?card=breached')).data.rows[0].ticket_no, ids.t2);
});

test('field edits validate, log and audit; assigning alerts the assignee; engineers come from Support teams', async () => {
  assert.equal((await agent.patch(`/tickets/${ids.t2}`, { priority: 'low' })).status, 400);
  assert.equal((await agent.patch(`/tickets/${ids.t2}`, { subject: '  ' })).status, 400);
  assert.equal((await agent.patch(`/tickets/${ids.t2}`, { group_name: 'Nope' })).status, 400);
  const tid = get('SELECT id FROM tickets WHERE ticket_no = ?', ids.t2).id;
  const auditBefore = get("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'TICKET_UPDATED' AND entity_id = ?", tid).n;
  const staffBefore = notes(ids.staff).length;
  let r = await agent.patch(`/tickets/${ids.t2}`, { priority: 'high' });
  assert.equal(r.status, 200);
  assert.ok(all("SELECT body FROM ticket_messages WHERE ticket_id = ?", tid).some(m => m.body === 'Priority changed from urgent to high'));
  assert.equal(get("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'TICKET_UPDATED' AND entity_id = ?", tid).n, auditBefore + 1);
  assert.match(notes(ids.staff).slice(staffBefore)[0].message, /^Ticket 10000006 updated: Priority changed from urgent to high\./);
  // assign to admin: admin is alerted
  r = await agent.patch(`/tickets/${ids.t2}`, { assignee_id: ids.admin });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(notes(ids.admin).some(n => n.reason === 'ticket_assigned' && n.message === 'Ticket 10000006 assigned to you — Ravi Agent assigned you: VPN drops'));
  assert.ok(all("SELECT body FROM ticket_messages WHERE ticket_id = ?", tid).some(m => m.body === 'Assigned to Asha Admin'));
  // a "Support" team limits the engineers to its lead and members
  const team = (await admin.post('/teams', { name: 'Support Desk', lead_id: ids.agent })).data;
  assert.ok(team.id, JSON.stringify(team));
  const engs = (await agent.get(`/tickets/${ids.t2}`)).data.engineers;
  assert.ok(engs.some(e => e.id === ids.agent && e.is_me));
  assert.equal(engs.filter(e => !e.former).length, 1);
  assert.equal((await agent.patch(`/tickets/${ids.t2}`, { assignee_id: ids.staff })).status, 400);
  assert.equal((await agent.post(`/tickets/${ids.t2}/take`)).status, 200);
  assert.equal(get('SELECT assignee_id FROM tickets WHERE id = ?', tid).assignee_id, ids.agent);
  assert.ok(all("SELECT body FROM ticket_messages WHERE ticket_id = ?", tid).some(m => m.body === 'Assignee changed from Asha Admin to Ravi Agent'));
});

test('requester view: request, public replies and changes, never internal notes; others get 404', async () => {
  let r = await staff.get(`/tickets/${ids.t1}/thread`);
  assert.equal(r.status, 200);
  const bodies = r.data.messages.map(m => m.body);
  assert.ok(bodies.includes('Can you send the printer name?'));
  assert.ok(bodies.includes('Status changed from Open to Pending'));
  assert.ok(!bodies.some(b => b.includes('Secret')));
  assert.equal(r.data.ticket.handled_by, 'Ravi Agent');
  assert.equal(r.data.can.close, false);
  assert.equal((await other.get(`/tickets/${ids.t1}/thread`)).status, 404);
  assert.equal((await other.get('/tickets/99999999/thread')).status, 404);
  assert.equal((await admin.get(`/tickets/${ids.t1}/thread`)).status, 200);
  // Tickets Raised: own tickets only, admins all
  assert.deepEqual((await staff.get('/tickets-raised')).data.rows.map(x => x.ticket_no).sort(), [ids.t1, ids.t2]);
  assert.equal((await other.get('/tickets-raised')).data.rows.length, 0);
  assert.equal((await admin.get('/tickets-raised')).data.rows.length, 3);
});

test('extra 1: requester reply reopens a pending ticket and alerts the assignee', async () => {
  const before = notes(ids.agent).length;
  const r = await staff.post(`/tickets/${ids.t1}/thread/reply`, form({ body: 'It is PRN-204' }));
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.status, 'open');
  const n = notes(ids.agent).slice(before);
  assert.equal(n.length, 1);
  assert.match(n[0].message, /^Reply on ticket 10000001 — Sam Staff replied: It is PRN-204/);
  assert.equal((await admin.post(`/tickets/${ids.t1}/thread/reply`, form({ body: 'not mine' }))).status, 403);
});

test('close from Tickets Raised: admin only, notes in the thread, requester alerted', async () => {
  assert.equal((await staff.post(`/tickets/${ids.t1}/close`, { notes: 'x' })).status, 403);
  assert.equal((await agent.post(`/tickets/${ids.t1}/close`, { notes: 'x' })).status, 403);
  const before = notes(ids.staff).length;
  const r = await admin.post(`/tickets/${ids.t1}/close`, { notes: 'Printer replaced' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const t = get('SELECT * FROM tickets WHERE ticket_no = ?', ids.t1);
  assert.equal(t.status, 'solved'); assert.ok(t.solved_at); assert.match(t.notes, /Printer replaced$/);
  const thread = (await staff.get(`/tickets/${ids.t1}/thread`)).data;
  assert.ok(thread.messages.some(m => m.body === 'Closing note: Printer replaced'));
  assert.ok(thread.messages.some(m => m.body === 'Closed from Tickets Raised — Printer replaced'));
  assert.equal(thread.ticket.simple_status, 'Closed');
  assert.match(notes(ids.staff).slice(before)[0].message, /Ticket 10000001 is Solved: Asha Admin closed your ticket\. Closing notes: Printer replaced/);
  assert.equal((await admin.post(`/tickets/${ids.t1}/close`, {})).status, 400);
  const board = (await agent.get('/ticket-board?card=solved')).data;
  assert.deepEqual(board.rows.map(x => x.ticket_no), [ids.t1]);
  assert.ok(board.rows[0].age);
});

test('admin: SLA hours, groups (deactivated stays) and macros', async () => {
  assert.equal((await agent.get('/admin/ticket-settings')).status, 403);
  let r = await admin.put('/admin/ticket-settings/sla', { urgent: 2, high: 6, normal: 48 });
  assert.equal(r.status, 200);
  assert.deepEqual((await admin.get('/admin/ticket-settings')).data.sla, { urgent: 2, high: 6, normal: 48 });
  const g = (await admin.get('/admin/ticket-settings')).data.groups.find(x => x.name === 'Research');
  assert.equal((await admin.patch(`/admin/ticket-groups/${g.id}`, { active: false })).status, 200);
  assert.ok(!(await agent.get(`/tickets/${ids.t2}`)).data.options.groups.includes('Research'));
  r = await admin.post('/admin/ticket-macros', { name: 'Thanks', body_template: 'Hi {customer_first_name}, thanks. {agent_first_name}', set_status: 'solved' });
  assert.equal(r.status, 201);
  assert.equal((await admin.post('/admin/ticket-macros', { name: 'Bad', body_template: 'x', set_status: 'closed' })).status, 400);
  const macros = (await agent.get(`/tickets/${ids.t2}`)).data.macros;
  assert.ok(macros.some(m => m.name === 'Thanks' && m.set_status === 'solved'));
});

test('email settings: admin only, password never sent back, nothing sent when not set up', async () => {
  assert.equal((await agent.get('/admin/email')).status, 403);
  let r = await admin.put('/admin/email', { main: { host: 'smtp.example.com', port: 587, user: 'helpdesk', pass: 'pw-123', from: 'helpdesk@example.com' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await admin.get('/admin/email');
  assert.equal(r.data.main.has_pass, true);
  assert.equal(JSON.stringify(r.data).includes('pw-123'), false);
  assert.equal((await admin.put('/admin/email', { main: { host: 'smtp.example.com', from: 'nope' } })).status, 400);
  await admin.put('/admin/email', { main: null, backup: null });
});

test('delete: administrators only, files removed, numbers never reused', async () => {
  const r = await staff.post('/tickets/raise', form({ description: 'Spam' }, [['a.png', PNG]]));
  const no = r.data.ticket_no;
  const stored = get('SELECT stored_name FROM ticket_attachments WHERE ticket_id = (SELECT id FROM tickets WHERE ticket_no = ?)', no).stored_name;
  assert.equal((await agent.del(`/tickets/${no}`)).status, 403);
  assert.equal((await admin.del(`/tickets/${no}`)).status, 200);
  assert.equal(fs.existsSync(path.join(tmp, 'uploads', stored)), false);
  assert.equal(get("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'TICKET_DELETED'").n, 1);
  const next = (await staff.post('/tickets/raise', form({ description: 'Next' }))).data.ticket_no;
  assert.equal(next, no + 1);
});

test('Task Board: open tickets in a first column for Ticket Board users only', async () => {
  const q = '/board?from=2020-01-01&to=2030-12-31';
  const r = await agent.get(q);
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.data.tickets));
  assert.ok(r.data.tickets.length > 0);
  assert.ok(r.data.tickets.every(t => t.status !== 'solved'));
  assert.equal((await agent.get(q + '&assignee_id=none')).data.tickets.every(t => !t.assignee_id), true);
  assert.equal((await staff.get(q)).data.tickets, null);
});
