// End-to-end smoke test of the Ticket Board against a running app.
// Raises a ticket, replies, changes status, assigns, closes, then deletes it again.
//   node scripts/ticket-smoke.mjs http://localhost:4000 admin@office.local "your password"
// Use an administrator account. Nothing is left behind (the ticket is deleted at the end).
const [base = 'http://localhost:4000', email, password] = process.argv.slice(2);
if (!email || !password) { console.log('Usage: node scripts/ticket-smoke.mjs <url> <admin email> <password>'); process.exit(2); }
const api = `${base.replace(/\/$/, '')}/api`;
const jar = {};
const cookie = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
async function call(method, url, body) {
  const isForm = body instanceof FormData;
  const headers = { cookie: cookie(), 'x-csrf-token': jar.pt_csrf || '' };
  if (body && !isForm) headers['content-type'] = 'application/json';
  const res = await fetch(api + url, { method, headers, body: isForm ? body : body ? JSON.stringify(body) : undefined });
  for (const sc of res.headers.getSetCookie()) { const [kv] = sc.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); }
  const data = (res.headers.get('content-type') || '').includes('json') ? await res.json() : null;
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${data?.error || ''}`);
  return data;
}
const step = (s) => console.log(`  ✓ ${s}`);
let no;
try {
  await call('GET', '/health');
  await call('POST', '/auth/login', { email, password });
  const me = (await call('GET', '/auth/me')).user;
  const fd = new FormData(); fd.append('subject', '[smoke test] please ignore'); fd.append('description', 'Created by scripts/ticket-smoke.mjs');
  no = (await call('POST', '/tickets/raise', fd)).ticket_no; step(`raised ticket ${no}`);
  let t = await call('GET', `/tickets/${no}`);
  if (t.ticket.status !== 'open' || t.ticket.group_name === '') throw new Error('new ticket is not open');
  const reply = new FormData(); reply.append('body', 'Smoke test reply'); reply.append('status', 'pending');
  await call('POST', `/tickets/${no}/reply`, reply); step('replied and set Pending');
  await call('PATCH', `/tickets/${no}`, { status: 'hold' }); await call('PATCH', `/tickets/${no}`, { status: 'open' }); step('hold and back to Open');
  await call('PATCH', `/tickets/${no}`, { priority: 'high' }); step('priority changed');
  await call('PATCH', `/tickets/${no}`, { assignee_id: me.id }).catch(() => call('PATCH', `/tickets/${no}`, { assignee_id: t.engineers[0]?.id })); step('assigned');
  await call('POST', `/tickets/${no}/close`, { notes: 'Smoke test done' }); step('closed from Tickets Raised');
  t = await call('GET', `/tickets/${no}`);
  if (t.ticket.status !== 'solved') throw new Error('ticket did not close');
  const thread = await call('GET', `/tickets/${no}/thread`);
  if (thread.messages.some(m => m.body.includes('Smoke test reply')) !== true) throw new Error('reply missing from the requester view');
  step(`thread has ${t.messages.length} entries`);
} catch (e) {
  console.error(`  ✗ ${e.message}`); process.exitCode = 1;
} finally {
  if (no) { await call('DELETE', `/tickets/${no}`).then(() => step(`deleted ticket ${no}`)).catch(e => console.error(`  ✗ cleanup: ${e.message}`)); }
}
