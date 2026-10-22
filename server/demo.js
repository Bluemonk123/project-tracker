// Fills an empty database with sample people, projects, tasks and meetings so you can try the app.
// Usage: npm run demo
import { get, all, run, tx, hashPassword } from './db.js';

if (get('SELECT COUNT(*) AS n FROM projects').n > 0) {
  console.log('The database already has projects, so demo data was not added.');
  process.exit(0);
}

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const role = (name, scope) => get('SELECT id FROM roles WHERE name = ? AND scope = ?', name, scope).id;
const status = (name) => get('SELECT id FROM statuses WHERE name = ?', name).id;
const type = (name) => get('SELECT id FROM types WHERE name = ?', name).id;
const prio = (name) => get('SELECT id FROM priorities WHERE name = ?', name).id;
const PASSWORD = 'demo12345';

tx(() => {
  let adminId = get('SELECT id FROM users WHERE is_admin = 1 ORDER BY id LIMIT 1')?.id;
  if (!adminId) {
    adminId = run('INSERT INTO users(name, email, password_hash, is_admin, global_role_id, job_title) VALUES(?,?,?,?,?,?)',
      'Office Admin', 'admin@office.local', hashPassword(PASSWORD), 1, role('Manager', 'global'), 'Administrator').id;
  }
  const people = [
    ['Priya Sharma', 'priya@office.local', 'Manager', 'Delivery manager'],
    ['Rahul Verma', 'rahul@office.local', 'Employee', 'Senior developer'],
    ['Anita Desai', 'anita@office.local', 'Employee', 'Frontend developer'],
    ['Vikram Singh', 'vikram@office.local', 'Employee', 'Backend developer'],
    ['Meera Iyer', 'meera@office.local', 'Employee', 'QA engineer'],
    ['Karan Mehta', 'karan@office.local', 'Employee', 'Mobile developer'],
    ['Sneha Kapoor', 'sneha@office.local', 'Employee', 'Business analyst'],
  ];
  const u = {};
  for (const [name, email, r, title] of people) {
    u[name.split(' ')[0]] = run('INSERT INTO users(name, email, password_hash, global_role_id, job_title) VALUES(?,?,?,?,?)',
      name, email, hashPassword(PASSWORD), role(r, 'global'), title).id;
  }
  const team = (name, lead, members) => {
    const id = run('INSERT INTO teams(name, description, lead_id) VALUES(?,?,?)', name, null, u[lead]).id;
    for (const m of members) run('INSERT OR IGNORE INTO team_members(team_id, user_id) VALUES(?,?)', id, u[m]);
    return id;
  };
  team('Web team', 'Rahul', ['Rahul', 'Anita', 'Vikram']);
  team('Mobile team', 'Karan', ['Karan', 'Anita']);
  team('Quality', 'Meera', ['Meera']);

  const projects = [
    { name: 'Customer Portal', key: 'CRM', color: '#0070C0', status: 'on_track', manager: 'Priya',
      desc: 'Self-service portal where customers raise requests, track orders and download invoices.',
      members: [['Rahul', 'Team lead'], ['Anita', 'Developer'], ['Vikram', 'Developer'], ['Meera', 'QA / Tester'], ['Sneha', 'Developer']] },
    { name: 'HR Management System', key: 'HRMS', color: '#33B014', status: 'at_risk', manager: 'Priya',
      desc: 'Leave, attendance and payroll inputs for all employees.', status_explanation: 'Payroll integration is waiting on the vendor API.',
      members: [['Vikram', 'Team lead'], ['Rahul', 'Developer'], ['Meera', 'QA / Tester'], ['Sneha', 'Developer']] },
    { name: 'Field Sales App', key: 'SALES', color: '#F39219', status: 'on_track', manager: 'Priya',
      desc: 'Android and iOS app for the field sales team: visits, orders and offline sync.',
      members: [['Karan', 'Team lead'], ['Anita', 'Developer'], ['Meera', 'QA / Tester']] },
  ];

  for (const p of projects) {
    const pid = run(`INSERT INTO projects(name, identifier, description, color, status, status_explanation, manager_id, start_date, end_date, created_by)
                     VALUES(?,?,?,?,?,?,?,?,?,?)`, p.name, p.key, p.desc, p.color, p.status, p.status_explanation || null, u[p.manager], day(-45), day(75), adminId).id;
    run('INSERT INTO project_members(project_id, user_id, role_id) VALUES(?,?,?)', pid, adminId, role('Project manager', 'project'));
    run('INSERT OR IGNORE INTO project_members(project_id, user_id, role_id) VALUES(?,?,?)', pid, u[p.manager], role('Project manager', 'project'));
    for (const [m, r] of p.members) run('INSERT OR IGNORE INTO project_members(project_id, user_id, role_id) VALUES(?,?,?)', pid, u[m], role(r, 'project'));
    const v1 = run('INSERT INTO versions(project_id, name, status, start_date, due_date) VALUES(?,?,?,?,?)', pid, 'Sprint 7', 'open', day(-7), day(7)).id;
    const v2 = run('INSERT INTO versions(project_id, name, status, start_date, due_date) VALUES(?,?,?,?,?)', pid, 'Release 2.0', 'open', day(8), day(40)).id;

    let n = 0;
    const wp = (o) => {
      n++;
      const id = run(`INSERT INTO work_packages(project_id, number, type_id, subject, description, status_id, priority_id, assignee_id, responsible_id,
                      author_id, parent_id, version_id, start_date, due_date, estimated_hours, done_ratio, position)
                      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        pid, n, type(o.type || 'Task'), o.subject, o.desc || null, status(o.status || 'New'), prio(o.prio || 'Normal'),
        o.to ? u[o.to] : null, u[p.manager], u[p.manager], o.parent || null, o.version === 2 ? v2 : v1,
        o.start != null ? day(o.start) : null, o.due != null ? day(o.due) : null, o.est || null, o.done || 0, n).id;
      run('INSERT INTO journals(wp_id, user_id, changes, created_at) VALUES(?,?,?,datetime(\'now\', ?))', id, u[p.manager], JSON.stringify({ created: [null, true] }), `-${10 - Math.min(n, 9)} days`);
      run('INSERT OR IGNORE INTO wp_watchers(wp_id, user_id) VALUES(?,?)', id, u[p.manager]);
      if (o.to) run('INSERT OR IGNORE INTO wp_watchers(wp_id, user_id) VALUES(?,?)', id, u[o.to]);
      return id;
    };
    const dev1 = p.members[0][0], dev2 = p.members[1][0], qa = p.members.find(m => m[1] === 'QA / Tester')[0];
    const r1 = wp({ type: 'Requirement', subject: 'User sign-in and password reset', status: 'Done', start: -30, due: -20, done: 100,
      desc: '## Goal\nUsers sign in with email and password, and can reset a forgotten password by email.\n\n## Acceptance\n- Lock account after 5 failed tries\n- Reset link valid for 30 minutes' });
    wp({ subject: 'Design sign-in screens', to: dev2, status: 'Done', start: -28, due: -24, est: 8, done: 100, parent: r1 });
    wp({ subject: 'Sign-in API and session handling', to: dev1, status: 'Done', start: -26, due: -21, est: 12, done: 100, parent: r1 });
    const r2 = wp({ type: 'Requirement', subject: 'Dashboard with key numbers', status: 'In progress', start: -10, due: 6, prio: 'High',
      desc: 'Landing page after sign-in showing open items, recent activity and alerts.' });
    const t1 = wp({ subject: 'Dashboard layout and widgets', to: dev2, status: 'In progress', start: -6, due: 2, est: 16, done: 60, parent: r2, prio: 'High' });
    const t2 = wp({ subject: 'Aggregation queries for dashboard', to: dev1, status: 'In review', start: -8, due: -1, est: 10, done: 90, parent: r2 });
    wp({ type: 'Bug', subject: 'Totals show wrong value after midnight', to: dev1, status: 'To do', start: 0, due: 1, prio: 'Immediate', est: 3, parent: r2 });
    wp({ subject: 'Test dashboard on slow networks', to: qa, status: 'New', start: 3, due: 6, est: 6, parent: r2 });
    const r3 = wp({ type: 'Requirement', subject: 'Export reports to Excel', status: 'In specification', start: 8, due: 30, version: 2 });
    wp({ type: 'Feature', subject: 'Excel export service', to: dev1, status: 'New', start: 10, due: 20, est: 14, parent: r3, version: 2 });
    wp({ type: 'Feature', subject: 'Download button on every report', to: dev2, status: 'New', start: 18, due: 24, est: 5, parent: r3, version: 2 });
    wp({ type: 'Bug', subject: 'Session expires too early on Safari', to: dev2, status: 'On hold', start: -12, due: -3, prio: 'High', est: 4 });
    wp({ subject: 'Write deployment checklist', to: qa, status: 'To do', start: 1, due: 4, est: 2 });
    wp({ type: 'Milestone', subject: 'Sprint 7 demo', start: 7, due: 7 });
    wp({ type: 'Milestone', subject: 'Release 2.0 go-live', start: 40, due: 40, version: 2 });
    run('INSERT INTO wp_relations(from_id, to_id, type) VALUES(?,?,?)', t2, t1, 'precedes');
    run('UPDATE projects SET wp_seq = ? WHERE id = ?', n, pid);

    // time entries for the last 10 working days
    for (let d = -10; d <= 0; d++) {
      const date = new Date(); date.setDate(date.getDate() + d);
      if (date.getDay() === 0 || date.getDay() === 6) continue;
      for (const [m] of p.members.slice(0, 3)) {
        run('INSERT INTO time_entries(project_id, wp_id, user_id, spent_on, hours, activity) VALUES(?,?,?,?,?,?)',
          pid, d > -5 ? t1 : t2, u[m], iso(date), [2, 3, 4, 2.5][Math.abs(d) % 4], 'Development');
      }
    }

    // daily stand-ups (weekdays, 2 weeks) and a weekly review
    const memberIds = all('SELECT user_id FROM project_members WHERE project_id = ?', pid).map(x => x.user_id);
    const series = `demo-${p.key}-daily`;
    for (let d = -3; d <= 10; d++) {
      const date = new Date(); date.setDate(date.getDate() + d);
      if (date.getDay() === 0 || date.getDay() === 6) continue;
      const mid = run(`INSERT INTO meetings(project_id, series_id, title, kind, starts_at, duration_minutes, location, status, created_by)
                       VALUES(?,?,?,?,?,?,?,?,?)`, pid, series, `${p.key} daily stand-up`, 'daily', `${iso(date)} 10:00`, 15,
        'Conference room B', d < 0 ? 'closed' : 'open', u[p.manager]).id;
      for (const uid of memberIds) run('INSERT INTO meeting_participants(meeting_id, user_id, attended) VALUES(?,?,?)', mid, uid, d < 0 ? 1 : null);
      run('INSERT INTO meeting_agenda_items(meeting_id, title, position) VALUES(?,?,0)', mid, 'Round the table: yesterday, today, blockers');
      if (d < 0) {
        run('INSERT INTO standup_updates(meeting_id, user_id, yesterday, today, blockers) VALUES(?,?,?,?,?)', mid, u[dev1], 'Finished aggregation queries', 'Code review fixes', null);
        run('INSERT INTO standup_updates(meeting_id, user_id, yesterday, today, blockers) VALUES(?,?,?,?,?)', mid, u[dev2], 'Dashboard widgets', 'Charts and empty states', d === -1 ? 'Waiting for final icons from design' : null);
      }
    }
    const weekly = `demo-${p.key}-weekly`;
    for (const d of [-7, 0, 7, 14]) {
      const date = new Date(); date.setDate(date.getDate() + d - ((date.getDay() + 2) % 7)); // Fridays
      const mid = run(`INSERT INTO meetings(project_id, series_id, title, kind, starts_at, duration_minutes, location, status, created_by, minutes)
                       VALUES(?,?,?,?,?,?,?,?,?,?)`, pid, weekly, `${p.name} weekly review`, 'weekly', `${iso(date)} 16:00`, 60, 'Main meeting room',
        d < 0 ? 'closed' : 'open', u[p.manager], d < 0 ? 'Sprint on track. Agreed to move Excel export to Release 2.0.' : null).id;
      for (const uid of memberIds) run('INSERT INTO meeting_participants(meeting_id, user_id) VALUES(?,?)', mid, uid);
      ['Progress against sprint goal', 'Overdue and blocked work', 'Risks and decisions', 'Plan for next week'].forEach((t, i) =>
        run('INSERT INTO meeting_agenda_items(meeting_id, title, duration, position) VALUES(?,?,?,?)', mid, t, 15, i));
    }

    run('INSERT INTO wiki_pages(project_id, title, content, updated_by) VALUES(?,?,?,?)', pid, 'Overview',
      `# ${p.name}\n\n${p.desc}\n\n## Environments\n| Name | Address |\n|---|---|\n| Test | http://test-${p.key.toLowerCase()}.office.local |\n| Live | http://${p.key.toLowerCase()}.office.local |\n\n## Contacts\n- Project manager: ${p.manager}\n`, u[p.manager]);
    run('INSERT INTO news(project_id, title, body, author_id) VALUES(?,?,?,?)', pid, 'Sprint 7 started', 'Focus this sprint: the dashboard. Please log time daily.', u[p.manager]);
  }
});

console.log('\n  Demo data added.');
console.log(`  Every demo person can sign in with password: ${PASSWORD}`);
console.log('  e.g. priya@office.local (manager), rahul@office.local (developer), meera@office.local (QA)\n');
