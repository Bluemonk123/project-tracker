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
  const employee = undefined;
  // Ticket Board access comes from the global role
  let r = await admin.post('/admin/roles', { name: 'Helpdesk agent', scope: 'global', permissions: ['tickets.view', 'tickets.create', 'tickets.edit', 'tickets.assign'] });
  ids.agentRole = r.data.id;
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const agentRole = r.data.id;
  r = await admin.post('/admin/roles', { name: 'Board viewer', scope: 'global', permissions: ['tickets.view'] });
  ids.viewerRole = r.data.id;
  ids.agent = (await admin.post('/admin/users', { name: 'Ravi Agent', email: 'ravi@office.local', password: 'password1', role_ids: [agentRole].filter(Boolean) })).data.id;
  ids.staff = (await admin.post('/admin/users', { name: 'Sam Staff', email: 'sam@office.local', password: 'password1', role_ids: [employee].filter(Boolean) })).data.id;
  ids.other = (await admin.post('/admin/users', { name: 'Olga Other', email: 'olga@office.local', password: 'password1', role_ids: [employee].filter(Boolean) })).data.id;
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
  await admin.patch(`/admin/users/${ids.other}`, { role_ids: [ids.viewerRole].filter(Boolean) });
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
  const sb = (await staff.get(q)).data; // everyone on the Task Board sees the column; only Ticket Board users can open tickets
  assert.ok(Array.isArray(sb.tickets) && sb.can_open_tickets === false && sb.can_convert === false);
});

test('convert a ticket into a task: linked, files carried over, solved when the task closes', async () => {
  const proj = (await admin.post('/projects', { name: 'Helpdesk Work', identifier: 'HDW' })).data;
  assert.ok(proj.id, JSON.stringify(proj));
  const meta = (await admin.get('/meta')).data;
  const newStatus = meta.statuses.find(s => s.board_column === 'new');
  const closed = meta.statuses.find(s => s.is_closed);
  const raised = (await staff.post('/tickets/raise', form({ subject: 'Export is slow', description: 'Takes 5 minutes' }, [['s.png', PNG]]))).data.ticket_no;
  assert.equal((await other.post(`/tickets/${raised}/convert`, { project_id: proj.id })).status, 403);
  let r = await admin.post(`/tickets/${raised}/convert`, { project_id: proj.id, status_id: newStatus.id });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const wp = r.data;
  assert.equal(wp.subject, 'Export is slow');
  assert.match(wp.description, /Takes 5 minutes/);
  assert.equal(wp.status_id, newStatus.id);
  const t = get('SELECT * FROM tickets WHERE ticket_no = ?', raised);
  assert.equal(t.wp_id, wp.id);
  assert.ok(all('SELECT body FROM ticket_messages WHERE ticket_id = ?', t.id).some(m => m.body === `Converted to task ${wp.key}`));
  const detail = (await admin.get(`/work-packages/${wp.id}`)).data;
  assert.equal(detail.ticket.ticket_no, raised);
  assert.equal(detail.attachments.length, 1);
  assert.equal((await admin.get(`/tickets/${raised}`)).data.linked_task.key, wp.key);
  assert.equal((await admin.post(`/tickets/${raised}/convert`, { project_id: proj.id })).status, 400);
  const board = (await admin.get('/board?from=2020-01-01&to=2030-12-31')).data;
  assert.ok(!board.tickets.some(x => x.ticket_no === raised), 'converted ticket leaves the Tickets column');
  assert.equal(board.rows.find(x => x.id === wp.id).ticket_no, raised);
  // deleting the task's copy of the file keeps the ticket's file
  const a = detail.attachments[0];
  await admin.del(`/attachments/${a.id}`);
  assert.equal(fs.existsSync(path.join(tmp, 'uploads', a.stored_name)), true);
  // closing the task solves the ticket and tells the requester
  const before = notes(ids.staff).length;
  r = await admin.patch(`/work-packages/${wp.id}`, { status_id: closed.id });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(get('SELECT status FROM tickets WHERE id = ?', t.id).status, 'solved');
  assert.ok(notes(ids.staff).slice(before).some(n => n.message.startsWith(`Ticket ${raised} is Solved`)));
  ids.proj = proj; ids.wp = wp;
});

test('email intake: new email -> ticket, reply -> same ticket, auto-replies and duplicates skipped', async () => {
  const { simpleParser } = await import('mailparser');
  const { handleParsed, stripQuoted, checkMailbox } = await import('../inbound.js');
  const mail = (headers, body) => simpleParser(Buffer.from(`${headers.join('\r\n')}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`));
  let out = handleParsed(await mail(['From: "Nora Client" <nora@client.com>', 'To: support@office.local', 'Subject: Fwd: Invoice page broken', 'Message-ID: <a1@client.com>'], 'The invoice page shows a blank screen.'));
  assert.equal(out.action, 'created', JSON.stringify(out));
  const t = get('SELECT * FROM tickets WHERE ticket_no = ?', out.ticket_no);
  assert.equal(t.channel, 'email'); assert.equal(t.subject, 'Invoice page broken'); assert.equal(t.raised_by, 'Nora Client');
  assert.equal(t.requester_email, 'nora@client.com'); assert.equal(t.requester_kind, 'guest'); assert.equal(t.email_message_id, '<a1@client.com>');
  // same email again: skipped
  assert.equal(handleParsed(await mail(['From: nora@client.com', 'Subject: Invoice page broken', 'Message-ID: <a1@client.com>'], 'x')).reason, 'already added');
  // reply to our alert (ticket number in In-Reply-To), quoted text dropped, pending ticket reopens
  run("UPDATE tickets SET status = 'pending' WHERE id = ?", t.id);
  out = handleParsed(await mail(['From: Nora <NORA@client.com>', `Subject: Re: [Project Tracker] Reply on ticket ${t.ticket_no}`, `In-Reply-To: <ticket-${t.ticket_no}-abc@office.local>`, 'Message-ID: <a2@client.com>'],
    `It happens in Chrome too.\r\n\r\nOn Tue, 17 Nov 2026 at 10:00, Helpdesk wrote:\r\n> Which browser?`));
  assert.equal(out.action, 'reply', JSON.stringify(out));
  const msgs = all("SELECT * FROM ticket_messages WHERE ticket_id = ? AND author_type = 'requester'", t.id);
  assert.equal(msgs.at(-1).body, 'It happens in Chrome too.');
  assert.equal(get('SELECT status FROM tickets WHERE id = ?', t.id).status, 'open');
  // someone else quoting the ticket number gets a new ticket, not a reply on Nora's
  out = handleParsed(await mail(['From: mallory@else.com', `Subject: ticket ${t.ticket_no}`, 'Message-ID: <m1@else.com>'], 'hi'));
  assert.equal(out.action, 'created');
  run('DELETE FROM tickets WHERE ticket_no = ?', out.ticket_no);
  // a member of staff emailing in is matched to their account
  out = handleParsed(await mail(['From: Sam <sam@office.local>', 'Subject: Laptop slow', 'Message-ID: <s1@office.local>'], 'Very slow'));
  assert.equal(get('SELECT requester_user_id FROM tickets WHERE ticket_no = ?', out.ticket_no).requester_user_id, ids.staff);
  // out-of-office and bounces are ignored
  assert.equal(handleParsed(await mail(['From: nora@client.com', 'Subject: Out of office', 'Auto-Submitted: auto-replied', 'Message-ID: <oo@client.com>'], 'away')).action, 'skipped');
  assert.equal(handleParsed(await mail(['From: MAILER-DAEMON@client.com', 'Subject: Undeliverable', 'Message-ID: <b1@client.com>'], 'bounce')).action, 'skipped');
  assert.equal(stripQuoted('New text\n\n-----Original Message-----\nFrom: x'), 'New text');
  // an unreachable mail server is reported, not thrown
  const r = await checkMailbox({ cfg: { host: '127.0.0.1', port: 1, secure: false, user: 'x', pass: 'y', folder: 'INBOX' } });
  assert.equal(r.ok, false);
  assert.ok(r.error);
});

test('email settings: incoming mailbox saved without echoing the password; task source', async () => {
  let r = await admin.put('/admin/email/inbound', { enabled: true, host: '', user: '' });
  assert.equal(r.status, 400);
  r = await admin.put('/admin/email/inbound', { enabled: false, host: 'imap.example.com', port: 993, user: 'support@example.com', pass: 'imap-secret', address: 'support@example.com', minutes: 5 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await admin.get('/admin/email');
  assert.equal(r.data.inbound.host, 'imap.example.com'); assert.equal(r.data.inbound.has_pass, true); assert.equal(r.data.inbound.minutes, 5);
  assert.equal(JSON.stringify(r.data).includes('imap-secret'), false);
  assert.equal((await agent.put('/admin/email/inbound', { host: 'x' })).status, 403);
  // source: converted from a web ticket = ticket; created in the project = project
  assert.equal((await admin.get(`/work-packages/${ids.wp.id}`)).data.source, 'ticket');
  const plain = (await admin.post('/work-packages', { project_id: ids.proj.id, subject: 'Plain task' })).data;
  assert.equal(plain.source, 'project');
  const emailTicket = get("SELECT ticket_no FROM tickets WHERE channel = 'email' AND wp_id IS NULL ORDER BY id LIMIT 1").ticket_no;
  const wp = (await admin.post(`/tickets/${emailTicket}/convert`, { project_id: ids.proj.id })).data;
  assert.equal(wp.source, 'email');
  assert.equal((await admin.get(`/work-packages?source=email&status=all`)).data.rows.map(x => x.id).includes(wp.id), true);
});

test('priority levels P1-P4 and criticality C1-C3 on tasks', async () => {
  const meta = (await admin.get('/meta')).data;
  assert.deepEqual(meta.priorities.map(p => p.name), ['P4 - Low', 'P3 - Normal', 'P2 - High', 'P1 - Immediate']);
  assert.deepEqual(meta.criticalities.map(c => c.name), ['C3', 'C2', 'C1']);
  const c1 = meta.criticalities.find(c => c.name === 'C1').id;
  const p1 = meta.priorities.find(p => p.name === 'P1 - Immediate').id;
  let r = await admin.post('/work-packages', { project_id: ids.proj.id, subject: 'Data loss on save', priority_id: p1, criticality_id: c1 });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.criticality_name, 'C1');
  assert.equal(r.data.priority_name, 'P1 - Immediate');
  const id = r.data.id;
  assert.equal((await admin.post('/work-packages', { project_id: ids.proj.id, subject: 'x', criticality_id: 9999 })).status, 400);
  assert.ok((await admin.get(`/work-packages?criticality_id=${c1}&status=all`)).data.rows.some(x => x.id === id));
  r = await admin.patch(`/work-packages/${id}`, { criticality_id: null });
  assert.equal(r.data.criticality_id, null);
  assert.ok((await admin.get(`/work-packages?criticality_id=none&status=all`)).data.rows.some(x => x.id === id));
  // admins can add a level
  assert.equal((await admin.post('/admin/criticalities', { name: 'C4', color: '#888888' })).status, 201);
  assert.equal((await agent.post('/admin/criticalities', { name: 'C5' })).status, 403);
});

test('import tasks (admin): dates, status, source, requester, closed date and remarks kept', async () => {
  const meta = (await admin.get('/meta')).data;
  const st = (col) => meta.statuses.find(s => s.board_column === col).id;
  const p2 = meta.priorities.find(p => p.name.startsWith('P2')).id;
  const c1 = meta.criticalities.find(c => c.name === 'C1').id;
  const rows = [
    { ref: 'S.No 1', subject: 'Inactivate accounts', description: 'Source Method: Mail - Ankita', status_id: st('closed'), priority_id: p2, criticality_id: c1,
      source: 'email', requested_by: 'Ankita', created_on: '2025-10-31', updated_on: '2026-01-08', closed_on: '2026-02-23',
      remarks: [{ author: 'Asha', body: 'old remark' }, { author: 'Suresh', body: 'Corrected manually' }] },
    { ref: 'S.No 2', subject: 'Sales tagging', status_id: st('develop'), priority_id: p2, source: 'ticket', requested_by: 'Kiran Bala', created_on: '2025-10-29' },
  ];
  assert.equal((await agent.post('/admin/import/tasks', { project_id: ids.proj.id, rows })).status, 403);
  assert.equal((await admin.post('/admin/import/tasks', { project_id: ids.proj.id, rows: [{ ...rows[0], created_on: '31/10/2025' }] })).status, 400);
  const r = await admin.post('/admin/import/tasks', { project_id: ids.proj.id, rows });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.created, 2);
  const w = (await admin.get(`/work-packages/${r.data.items[0].id}`)).data;
  assert.equal(w.source, 'email'); assert.equal(w.requested_by, 'Ankita'); assert.equal(w.closed_on, '2026-02-23');
  assert.equal(w.created_at.slice(0, 10), '2025-10-31'); assert.equal(w.criticality_name, 'C1');
  const comments = w.journals.filter(j => j.notes && !j.changes).map(j => [j.user_name, j.notes]);
  assert.deepEqual(comments, [['Asha Admin', 'old remark'], ['Suresh', 'Corrected manually']]);
  const w2 = (await admin.get(`/work-packages/${r.data.items[1].id}`)).data;
  assert.equal(w2.closed_on, null); assert.equal(w2.board_column, 'develop');
  // closing in the app sets the closed date; reopening clears it
  await admin.patch(`/work-packages/${w2.id}`, { status_id: st('closed') });
  assert.ok((await admin.get(`/work-packages/${w2.id}`)).data.closed_on);
  await admin.patch(`/work-packages/${w2.id}`, { status_id: st('new') });
  assert.equal((await admin.get(`/work-packages/${w2.id}`)).data.closed_on, null);
  await admin.patch(`/work-packages/${w2.id}`, { requested_by: 'Anuj' });
  assert.equal((await admin.get(`/work-packages/${w2.id}`)).data.requested_by, 'Anuj');
});

test('tasks: subject, problem (description) and solution', async () => {
  let r = await admin.post('/work-packages', { project_id: ids.proj.id, subject: 'Export slow', description: 'Takes 5 minutes', solution: 'Added an index' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.solution, 'Added an index');
  r = await admin.patch(`/work-packages/${r.data.id}`, { solution: 'Added an index and caching' });
  assert.equal(r.data.solution, 'Added an index and caching');
  const j = (await admin.get(`/work-packages/${r.data.id}`)).data.journals.at(-1);
  assert.ok(JSON.parse(j.changes).solution);
});

test('tasks: module field with suggestions and filter', async () => {
  const a = (await admin.post('/work-packages', { project_id: ids.proj.id, subject: 'Merge contacts', module: 'Account Master' })).data;
  assert.equal(a.module, 'Account Master');
  await admin.post('/work-packages', { project_id: ids.proj.id, subject: 'Invoice PDF', module: 'Invoices' });
  const mods = (await admin.get(`/projects/${ids.proj.id}/modules`)).data.map(x => x.module);
  assert.ok(mods.includes('Account Master') && mods.includes('Invoices'));
  const rows = (await admin.get(`/work-packages?project_id=${ids.proj.id}&module=Invoices&status=all`)).data.rows;
  assert.deepEqual(rows.map(x => x.subject), ['Invoice PDF']);
  assert.equal((await admin.patch(`/work-packages/${a.id}`, { module: '' })).data.module, null);
});

test('working calendar: priority days, off days, holidays drive due dates', async () => {
  const cal = (await admin.get('/work-calendar')).data;
  assert.deepEqual(cal.off_days, [0, 6]);
  assert.equal(cal.hours_per_day, 8);
  const pr = Object.fromEntries(cal.priorities.map(p => [p.name.slice(0, 2), p.id]));
  assert.equal(cal.priority_days[pr.P2], 3);
  assert.equal((await agent.put('/work-calendar', { off_days: [0], hours_per_day: 8, priority_days: {} })).status, 403);
  assert.equal((await admin.put('/work-calendar', { off_days: [0, 1, 2, 3, 4, 5, 6], hours_per_day: 8 })).status, 400);
  const pd = { [pr.P1]: 1, [pr.P2]: 3, [pr.P3]: 5, [pr.P4]: 10 };
  assert.equal((await admin.put('/work-calendar', { off_days: [0, 6], hours_per_day: 9, priority_days: pd })).status, 200);
  // Fri 2026-12-04 + 3 working days with Mon 2026-12-07 a holiday -> Fri, Tue, Wed = 2026-12-09
  assert.equal((await admin.post('/holidays', { day: '2026-12-07', name: 'Company day' })).status, 201);
  let r = await admin.post('/work-packages', { project_id: ids.proj.id, subject: 'Due by priority', priority_id: pr.P2, start_date: '2026-12-04' });
  assert.equal(r.data.due_date, '2026-12-09');
  // changing priority recalculates; P1 = the start day
  r = await admin.patch(`/work-packages/${r.data.id}`, { priority_id: pr.P1 });
  assert.equal(r.data.due_date, '2026-12-04');
  // a hand-picked due date stays, and the priority does not change
  r = await admin.patch(`/work-packages/${r.data.id}`, { due_date: '2026-12-20' });
  assert.equal(r.data.due_date, '2026-12-20'); assert.equal(r.data.priority_id, pr.P1);
  // a task created without dates starts today
  const t = (await admin.post('/work-packages', { project_id: ids.proj.id, subject: 'Starts today', priority_id: pr.P3 })).data;
  assert.ok(t.start_date && t.due_date && t.due_date >= t.start_date);
  const hid = (await admin.get('/work-calendar')).data.holidays[0].id;
  assert.equal((await admin.del(`/holidays/${hid}`)).status, 200);
});

test('users can be added without a password and set one later', async () => {
  const meta = (await admin.get('/meta')).data;
  const emp = undefined;
  const r = await admin.post('/admin/users', { name: 'Mehak', email: 'mehak@example.com', role_ids: [emp].filter(Boolean) });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal((await admin.get('/admin/users')).data.find(u => u.id === r.data.id).has_password, 0);
  const c = client();
  assert.equal((await c.post('/auth/login', { email: 'mehak@example.com', password: '' })).status, 401);
  assert.equal((await c.post('/auth/login', { email: 'mehak@example.com', password: 'anything1' })).status, 401);
  assert.equal((await admin.post('/admin/users', { name: 'X', email: 'x@example.com', password: 'short' })).status, 400);
});

test('tasks: location (local / staging / production / external)', async () => {
  const w = (await admin.post('/work-packages', { project_id: ids.proj.id, subject: 'Where is it', location: 'staging' })).data;
  assert.equal(w.location, 'staging');
  assert.equal((await admin.patch(`/work-packages/${w.id}`, { location: 'moon' })).status, 400);
  assert.equal((await admin.patch(`/work-packages/${w.id}`, { location: 'production' })).data.location, 'production');
  assert.equal((await admin.patch(`/work-packages/${w.id}`, { location: null })).data.location, null);
});

test('task board: type and location filters', async () => {
  const meta = (await admin.get('/meta')).data;
  const bug = meta.types.find(t => t.name === 'Bug').id;
  const a = (await admin.post('/work-packages', { project_id: ids.proj.id, subject: 'Staging bug', type_id: bug, location: 'staging' })).data;
  const q = `/board?from=2020-01-01&to=2030-12-31&project_id=${ids.proj.id}`;
  let rows = (await admin.get(q + `&type_id=${bug}`)).data.rows;
  assert.ok(rows.length && rows.every(r => r.type_id === bug));
  rows = (await admin.get(q + '&location=staging')).data.rows;
  assert.ok(rows.some(r => r.id === a.id) && rows.every(r => r.location === 'staging'));
  rows = (await admin.get(q + '&location=none')).data.rows;
  assert.ok(rows.every(r => r.location === null));
});

test('work list CSV export follows the filters, with task details', async () => {
  const meta = (await admin.get('/meta')).data;
  const bug = meta.types.find(t => t.name === 'Bug').id;
  let r = await admin.get(`/work-packages/export.csv?project_id=${ids.proj.id}&status=all&type_id=${bug}`);
  assert.equal(r.status, 200);
  const lines = r.data.replace(/^﻿/, '').split('\r\n');
  assert.ok(lines[0].startsWith('ID,Project,Type,Subject,Module,Problem,Solution,Stage,Status,Priority,Location,Assignee,Requester,Source'));
  assert.ok(lines.length > 1 && lines.slice(1).every(l => l.split(',')[2] === 'Bug'));
  assert.ok(r.data.includes('On Staging'));
  r = await admin.get(`/work-packages/export.csv?project_id=${ids.proj.id}&status=all`);
  assert.ok(r.data.split('\r\n').length > lines.length);
});

test('email intake: "Requestor - email" in the body raises the ticket for that user', async () => {
  const { simpleParser } = await import('mailparser');
  const { handleParsed } = await import('../inbound.js');
  const { requestorInBody } = await import('../routes/tickets.js');
  const mail = (headers, body) => simpleParser(Buffer.from(`${headers.join('\r\n')}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`));
  for (const [line, want] of [['Requestor - sam@office.local', 'sam@office.local'], ['requester: <SAM@office.local>', 'sam@office.local'],
    ['Requestor – Sam Staff <sam@office.local>', 'sam@office.local'], ['Requestor: mailto:sam@office.local', 'sam@office.local'], ['No requestor here', null]]) {
    assert.equal(requestorInBody(`Hello\n${line}\nThanks`), want, line);
  }
  // a user (Ravi) sends it naming another user (Sam): Sam is the requester
  let out = handleParsed(await mail(['From: Ravi Agent <ravi@office.local>', 'Subject: Laptop not booting', 'Message-ID: <rq1@office.local>'],
    'The laptop at reception does not boot.\n\nRequestor - sam@office.local\n\nRegards, Ravi'));
  assert.equal(out.action, 'created');
  let t = get('SELECT * FROM tickets WHERE ticket_no = ?', out.ticket_no);
  assert.equal(t.requester_user_id, ids.staff);
  assert.equal(t.requester_email, 'sam@office.local');
  assert.ok(all('SELECT body FROM ticket_messages WHERE ticket_id = ?', t.id).some(m => /on behalf of Sam Staff/.test(m.body)));
  // Sam can then reply by email to that ticket
  out = handleParsed(await mail(['From: sam@office.local', `Subject: Re: Ticket ${t.ticket_no} received`, 'Message-ID: <rq2@office.local>'], 'It shows a black screen.'));
  assert.equal(out.action, 'reply');
  // an unknown requestor email: the sender stays the requester
  out = handleParsed(await mail(['From: ravi@office.local', 'Subject: Printer jam', 'Message-ID: <rq3@office.local>'], 'Requestor - nobody@else.com'));
  t = get('SELECT * FROM tickets WHERE ticket_no = ?', out.ticket_no);
  assert.equal(t.requester_email, 'ravi@office.local');
  // an outsider cannot raise a ticket in a user's name
  out = handleParsed(await mail(['From: mallory@evil.com', 'Subject: Reset my password', 'Message-ID: <rq4@evil.com>'], 'Requestor - sam@office.local'));
  t = get('SELECT * FROM tickets WHERE ticket_no = ?', out.ticket_no);
  assert.equal(t.requester_email, 'mallory@evil.com');
  assert.equal(t.requester_user_id, null);
  // no line: the sender is the requester, as before
  out = handleParsed(await mail(['From: sam@office.local', 'Subject: Mouse broken', 'Message-ID: <rq5@office.local>'], 'Please replace it.'));
  assert.equal(get('SELECT requester_user_id FROM tickets WHERE ticket_no = ?', out.ticket_no).requester_user_id, ids.staff);
});

test('change requester: administrators only, logged in the thread', async () => {
  const t = get("SELECT * FROM tickets WHERE requester_user_id IS NOT NULL ORDER BY id LIMIT 1");
  assert.equal((await agent.put(`/tickets/${t.ticket_no}/requester`, { user_id: ids.other })).status, 403);
  assert.equal((await admin.put(`/tickets/${t.ticket_no}/requester`, { user_id: 999999 })).status, 400);
  const r = await admin.put(`/tickets/${t.ticket_no}/requester`, { user_id: ids.other });
  assert.equal(r.status, 200);
  const n = get('SELECT * FROM tickets WHERE id = ?', t.id);
  assert.equal(n.requester_user_id, ids.other);
  assert.equal(n.requester_email, 'olga@office.local');
  assert.ok(all('SELECT body FROM ticket_messages WHERE ticket_id = ?', t.id).some(m => /Requester changed from .* to Olga Other/.test(m.body)));
  assert.equal((await admin.get(`/tickets/${t.ticket_no}`)).data.can.change_requester, true);
  assert.equal((await agent.get(`/tickets/${t.ticket_no}`)).data.can.change_requester, false);
});

test('change the assignee: needs its own permission; taking a ticket yourself does not', async () => {
  const t = get("SELECT * FROM tickets WHERE status <> 'solved' ORDER BY id DESC LIMIT 1");
  await admin.patch(`/tickets/${t.ticket_no}`, { assignee_id: null });
  // the agent's role without "Change the assignee"
  const role = (await admin.get('/admin/roles')).data.find(r => r.id === ids.agentRole);
  await admin.patch(`/admin/roles/${ids.agentRole}`, { permissions: role.permissions.filter(p => p !== 'tickets.assign') });
  assert.equal((await agent.patch(`/tickets/${t.ticket_no}`, { assignee_id: ids.admin })).status, 403);
  assert.equal((await agent.post(`/tickets/${t.ticket_no}/take`)).status, 200); // taking it yourself is fine
  assert.equal(get('SELECT assignee_id FROM tickets WHERE id = ?', t.id).assignee_id, ids.agent);
  assert.equal((await agent.get(`/tickets/${t.ticket_no}`)).data.can.assign, false);
  await admin.patch(`/admin/roles/${ids.agentRole}`, { permissions: role.permissions });
  assert.equal((await agent.get(`/tickets/${t.ticket_no}`)).data.can.assign, true);
});

test('assignees: Support Team members who can work on tickets (not other team members)', async () => {
  const team = (await admin.get('/teams')).data;
  const list = Array.isArray(team) ? team : team.teams || [];
  const support = list.find(t => /support|ticket/i.test(t.name));
  assert.ok(support, 'a support team exists in the test data');
  // Olga (Board viewer: can only open the board) joins the Support Team
  const members = (support.members || []).map(m => m.user_id ?? m.id ?? m);
  await admin.patch(`/teams/${support.id}`, { member_ids: [...new Set([...members, ids.other])] });
  const t = get("SELECT ticket_no FROM tickets ORDER BY id DESC LIMIT 1");
  const engs = (await admin.get(`/tickets/${t.ticket_no}`)).data.engineers.map(e => e.id);
  assert.ok(!engs.includes(ids.other), 'cannot work on tickets, so not assignable');
  assert.ok(engs.includes(ids.agent));
});

test('Enable Ticket Board on one person (on top of their role)', async () => {
  const roles = (await admin.get('/admin/roles')).data;
  const employee = undefined;
  const u = (await admin.post('/admin/users', { name: 'Dual Role', email: 'dual@office.local', password: 'password1', role_ids: [employee].filter(Boolean) })).data.id;
  const c = client(); await c.post('/auth/login', { email: 'dual@office.local', password: 'password1' });
  let perms = (await c.get('/auth/me')).data.permissions;
  assert.ok(!perms.includes('tickets.view'));
  assert.equal((await admin.patch(`/admin/users/${u}`, { ticket_access: 'nonsense' })).status, 400);
  assert.equal((await admin.patch(`/admin/users/${u}`, { ticket_access: 'work' })).status, 200);
  perms = (await c.get('/auth/me')).data.permissions;
  assert.ok(perms.includes('tickets.view') && perms.includes('tickets.edit') && !perms.includes('tickets.assign'));
  await admin.patch(`/admin/users/${u}`, { ticket_access: 'lead' });
  assert.ok((await c.get('/auth/me')).data.permissions.includes('tickets.assign'));
  // other employees are not affected
  assert.ok(!(await staff.get('/auth/me')).data.permissions.includes('tickets.view'));
  await admin.patch(`/admin/users/${u}`, { ticket_access: null });
  assert.ok(!(await c.get('/auth/me')).data.permissions.includes('tickets.view'));
});

test('Ticket Board permissions in a project role give board access', async () => {
  const roles = (await admin.get('/admin/roles')).data;
  const employee = undefined;
  const role = (await admin.post('/admin/roles', { name: 'Support on project', scope: 'project', permissions: ['project.view', 'tickets.view', 'tickets.edit', 'bogus'] })).data.id;
  const saved = (await admin.get('/admin/roles')).data.find(r => r.id === role);
  assert.deepEqual([...saved.permissions].sort(), ['project.view', 'tickets.edit', 'tickets.view']);
  const u = (await admin.post('/admin/users', { name: 'Proj Support', email: 'projsup@office.local', password: 'password1', role_ids: [employee].filter(Boolean) })).data.id;
  const c = client(); await c.post('/auth/login', { email: 'projsup@office.local', password: 'password1' });
  assert.ok(!(await c.get('/auth/me')).data.permissions.includes('tickets.view'));
  const pid = get('SELECT id FROM projects ORDER BY id LIMIT 1').id;
  assert.equal((await admin.post(`/projects/${pid}/members`, { user_id: u, role_id: role })).status < 300, true);
  const perms = (await c.get('/auth/me')).data.permissions;
  assert.ok(perms.includes('tickets.view') && perms.includes('tickets.edit') && !perms.includes('tickets.assign'));
  assert.equal((await c.get('/ticket-board')).status, 200);
});

test('email tickets keep the whole original email (with the quoted trail) to view and download', async () => {
  const { simpleParser } = await import('mailparser');
  const { handleParsed } = await import('../inbound.js');
  const src = Buffer.from(['From: "Trail Person" <trail@client.com>', 'To: support@office.local', 'Subject: Printer down', 'Message-ID: <trail1@client.com>',
    'Content-Type: text/plain; charset=utf-8', '', 'Still broken, see below.', '', 'On Mon, Nov 23, 2026 at 10:00 AM IT <it@client.com> wrote:', '> Please restart the printer.'].join('\r\n'));
  const out = handleParsed(await simpleParser(src), src);
  assert.equal(out.action, 'created');
  const d = (await admin.get(`/tickets/${out.ticket_no}`)).data;
  assert.ok(!d.ticket.feedback.includes('restart the printer'), 'the ticket text keeps only the new part');
  assert.ok(d.ticket.email?.id, 'the original email is kept');
  const full = (await admin.get(`/ticket-emails/${d.ticket.email.id}`)).data;
  assert.ok(full.text.includes('Please restart the printer.'), 'the full email has the trail');
  assert.match(full.from, /trail@client\.com/);
  const dl = await admin.get(`/ticket-emails/${d.ticket.email.id}/download`);
  assert.equal(dl.status, 200);
  assert.equal((await staff.get(`/ticket-emails/${d.ticket.email.id}`)).status, 404, 'not for other staff');
});

test('alerts: own only; administrators can see everyone; email tickets alert everyone; live stream', async () => {
  const staffId = get("SELECT id FROM users WHERE email = 'staff@office.local'")?.id ?? (await staff.get('/auth/me')).data.user.id;
  // live connection for staff: wait for a "notify" event
  const ctrl = new AbortController();
  const res = await fetch(base + '/notifications/stream', { headers: { cookie: Object.entries(staff.jar).map(([k, v]) => `${k}=${v}`).join('; ') }, signal: ctrl.signal });
  assert.equal(res.status, 200);
  const reader = res.body.getReader();
  const gotEvent = (async () => { let txt = ''; while (!txt.includes('event: notify')) { const { value, done } = await reader.read(); if (done) break; txt += new TextDecoder().decode(value); } return txt; })();

  const { simpleParser } = await import('mailparser');
  const { handleParsed } = await import('../inbound.js');
  const src = Buffer.from(['From: "Mail Person" <everyone-alert@client.com>', 'To: support@office.local', 'Subject: Everyone sees this', 'Message-ID: <alert-all@client.com>',
    'Content-Type: text/plain; charset=utf-8', '', 'Hello support.'].join('\r\n'));
  const out = handleParsed(await simpleParser(src), src);
  assert.equal(out.action, 'created');
  const txt = await Promise.race([gotEvent, new Promise((_, rej) => setTimeout(() => rej(new Error('no live event')), 3000))]);
  assert.match(txt, /event: notify/);
  ctrl.abort();
  // every active person got the new-ticket alert, also people without Ticket Board access
  const active = all("SELECT id FROM users WHERE status = 'active'").map(u => u.id);
  for (const uid of active) assert.ok(notes(uid).some(n => n.reason === 'ticket_new' && n.message.includes(out.ticket_no)), `user ${uid} alerted`);
  // each person sees only their own; administrators can see everyone's
  const mine = (await staff.get('/notifications')).data;
  assert.ok(mine.length && mine.every(n => n.user_id === staffId));
  assert.equal((await staff.get('/notifications?scope=all')).status, 403);
  const everyone = (await admin.get('/notifications?scope=all')).data;
  assert.ok(new Set(everyone.map(n => n.user_id)).size > 1 && everyone[0].recipient_name);
});
