// Permission catalogue. Roles store arrays of these keys.
// Project permissions can also be put in a GLOBAL role: they then apply to every project
// (that is how a "Manager" monitors all projects without being a member of each one).

export const GLOBAL_PERMISSIONS = [
  { key: 'admin.users',      group: 'Administration', label: 'Manage users' },
  { key: 'admin.roles',      group: 'Administration', label: 'Manage roles and permissions' },
  { key: 'admin.settings',   group: 'Administration', label: 'Manage types, statuses, priorities and settings' },
  { key: 'teams.manage',     group: 'Administration', label: 'Manage teams' },
  { key: 'projects.create',  group: 'Projects',       label: 'Create projects' },
  { key: 'reports.view',     group: 'Reports',        label: 'View portfolio and workload reports' },
  // Ticket Board (one for the whole company, so in global roles). Who can be ASSIGNED tickets: people with
  // "Work on tickets" who are also in the Support Team (Teams page). Administrators always have all of them.
  { key: 'tickets.view',     group: 'Ticket Board',   label: 'Open the Ticket Board and see all tickets' },
  { key: 'tickets.create',   group: 'Ticket Board',   label: 'Create tickets from the board (New ticket)' },
  { key: 'tickets.edit',     group: 'Ticket Board',   label: 'Work on tickets: reply, add notes, change fields, take tickets' },
  { key: 'tickets.assign',   group: 'Ticket Board',   label: 'Ticket lead: assign tickets to other engineers' },
];
export const TICKET_PERMISSIONS = []; // (ticket roles were merged into global roles)

export const PROJECT_PERMISSIONS = [
  { key: 'project.view',      group: 'Project',        label: 'View project' },
  { key: 'project.edit',      group: 'Project',        label: 'Edit project details and status' },
  { key: 'board.view',        group: 'Project',        label: 'Open the Project Board' },
  { key: 'project.brief',     group: 'Project',        label: 'Edit project brief, customer and customer user roles' },
  { key: 'project.documents', group: 'Project',        label: 'Upload project documents' },
  { key: 'project.members',   group: 'Project',        label: 'Manage project members' },
  { key: 'project.versions',  group: 'Project',        label: 'Manage versions and categories' },
  { key: 'project.archive',   group: 'Project',        label: 'Archive and delete project' },
  { key: 'news.manage',       group: 'Project',        label: 'Post project announcements' },
  { key: 'wp.view',           group: 'Tasks',  label: 'View tasks' },
  { key: 'wp.create',         group: 'Tasks',  label: 'Create tasks' },
  { key: 'wp.edit',           group: 'Tasks',  label: 'Edit any task' },
  { key: 'wp.edit_own',       group: 'Tasks',  label: 'Edit tasks assigned to me' },
  { key: 'wp.assign',         group: 'Tasks',  label: 'Assign tasks to people' },
  { key: 'wp.delete',         group: 'Tasks',  label: 'Delete tasks' },
  { key: 'wp.comment',        group: 'Tasks',  label: 'Comment on tasks' },
  { key: 'wp.import',         group: 'Tasks',  label: 'Upload tasks in bulk (Excel / CSV)' },
  { key: 'modules.manage',    group: 'Tasks',  label: 'Add, rename, merge and remove modules' },
  { key: 'sprint.manage',     group: 'Sprints', label: 'Plan sprints: create, edit, start, end and move tasks between sprints' },
  { key: 'time.log',          group: 'Time tracking',  label: 'Log own time' },
  { key: 'time.view_all',     group: 'Time tracking',  label: 'View everyone\'s time' },
  { key: 'time.edit_all',     group: 'Time tracking',  label: 'Edit everyone\'s time' },
  { key: 'meetings.view',     group: 'Meetings',       label: 'View meetings' },
  { key: 'meetings.manage',   group: 'Meetings',       label: 'Create and run meetings' },
  { key: 'wiki.view',         group: 'Wiki',           label: 'View wiki' },
  { key: 'wiki.edit',         group: 'Wiki',           label: 'Edit wiki' },
  { key: 'files.upload',      group: 'Files',          label: 'Upload files' },
  { key: 'tech.manage',       group: 'Technologies',   label: 'Add, edit and remove technologies' },
  { key: 'tech.version',      group: 'Technologies',   label: 'Update the version used of technologies' },
  { key: 'security.manage',   group: 'Data security',  label: 'Update data security checks' },
];

export const ALL_GLOBAL_KEYS = GLOBAL_PERMISSIONS.map(p => p.key);
export const ALL_PROJECT_KEYS = PROJECT_PERMISSIONS.map(p => p.key);
export const ALL_TICKET_KEYS = TICKET_PERMISSIONS.map(p => p.key);

export const DEFAULT_ROLES = [
  {
    name: 'Manager', scope: 'global', builtin: 1,
    description: 'Monitors every project: sees all tasks, time, meetings and reports.',
    permissions: ['projects.create', 'reports.view', 'teams.manage', 'board.view',
      'project.view', 'wp.view', 'wp.create', 'wp.comment', 'wp.assign', 'time.log', 'time.view_all',
      'meetings.view', 'meetings.manage', 'wiki.view'],
  },
  {
    name: 'Employee', scope: 'global', builtin: 1,
    description: 'Standard staff account. Sees only the projects they are a member of.',
    permissions: [],
  },
  {
    name: 'Product manager', scope: 'project', builtin: 1,
    description: 'Runs a project: members, planning, meetings.',
    permissions: ALL_PROJECT_KEYS.filter(k => k !== 'project.archive'),
  },
  {
    name: 'Team lead', scope: 'project', builtin: 0,
    description: 'Leads a team inside a project: assigns and reviews work.',
    permissions: ['project.view', 'wp.view', 'wp.create', 'wp.edit', 'wp.assign', 'wp.comment',
      'time.log', 'time.view_all', 'meetings.view', 'meetings.manage', 'wiki.view', 'wiki.edit', 'files.upload', 'news.manage',
      'tech.manage', 'tech.version', 'project.documents', 'security.manage', 'board.view', 'wp.import', 'modules.manage', 'sprint.manage'],
  },
  {
    name: 'Project manager', scope: 'project', builtin: 0,
    description: 'Owns the client relationship: follows progress, meetings and time.',
    permissions: ['project.view', 'wp.view', 'wp.create', 'wp.comment', 'time.log', 'time.view_all',
      'meetings.view', 'meetings.manage', 'wiki.view', 'files.upload', 'news.manage', 'project.brief', 'project.documents',
      'board.view', 'wp.import', 'modules.manage'],
  },
  {
    name: 'Business analyst', scope: 'project', builtin: 0,
    description: 'Writes and maintains requirements, specs and acceptance criteria.',
    permissions: ['project.view', 'project.versions', 'wp.view', 'wp.create', 'wp.edit', 'wp.assign', 'wp.comment',
      'time.log', 'meetings.view', 'meetings.manage', 'wiki.view', 'wiki.edit', 'files.upload', 'tech.version',
      'project.brief', 'project.documents', 'board.view', 'wp.import', 'modules.manage', 'sprint.manage'],
  },
  {
    name: 'Developer', scope: 'project', builtin: 0,
    description: 'Works on tasks and logs time.',
    permissions: ['project.view', 'wp.view', 'wp.create', 'wp.edit_own', 'wp.comment',
      'time.log', 'meetings.view', 'wiki.view', 'wiki.edit', 'files.upload', 'tech.version', 'board.view', 'sprint.manage'],
  },
  {
    name: 'QA / Tester', scope: 'project', builtin: 0,
    description: 'Tests features and reports bugs.',
    permissions: ['project.view', 'wp.view', 'wp.create', 'wp.edit_own', 'wp.comment',
      'time.log', 'meetings.view', 'wiki.view', 'files.upload', 'board.view', 'sprint.manage'],
  },
  {
    name: 'Viewer', scope: 'project', builtin: 1,
    description: 'Read-only access (clients, stakeholders).',
    permissions: ['project.view', 'wp.view', 'meetings.view', 'wiki.view', 'board.view'],
  },
];
