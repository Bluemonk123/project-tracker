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
];

export const PROJECT_PERMISSIONS = [
  { key: 'project.view',      group: 'Project',        label: 'View project' },
  { key: 'project.edit',      group: 'Project',        label: 'Edit project details and status' },
  { key: 'project.members',   group: 'Project',        label: 'Manage project members' },
  { key: 'project.versions',  group: 'Project',        label: 'Manage versions and categories' },
  { key: 'project.archive',   group: 'Project',        label: 'Archive and delete project' },
  { key: 'news.manage',       group: 'Project',        label: 'Post project announcements' },
  { key: 'wp.view',           group: 'Work packages',  label: 'View work packages' },
  { key: 'wp.create',         group: 'Work packages',  label: 'Create work packages' },
  { key: 'wp.edit',           group: 'Work packages',  label: 'Edit any work package' },
  { key: 'wp.edit_own',       group: 'Work packages',  label: 'Edit work packages assigned to me' },
  { key: 'wp.assign',         group: 'Work packages',  label: 'Assign work packages to people' },
  { key: 'wp.delete',         group: 'Work packages',  label: 'Delete work packages' },
  { key: 'wp.comment',        group: 'Work packages',  label: 'Comment on work packages' },
  { key: 'time.log',          group: 'Time tracking',  label: 'Log own time' },
  { key: 'time.view_all',     group: 'Time tracking',  label: 'View everyone\'s time' },
  { key: 'time.edit_all',     group: 'Time tracking',  label: 'Edit everyone\'s time' },
  { key: 'meetings.view',     group: 'Meetings',       label: 'View meetings' },
  { key: 'meetings.manage',   group: 'Meetings',       label: 'Create and run meetings' },
  { key: 'wiki.view',         group: 'Wiki',           label: 'View wiki' },
  { key: 'wiki.edit',         group: 'Wiki',           label: 'Edit wiki' },
  { key: 'files.upload',      group: 'Files',          label: 'Upload files' },
];

export const ALL_GLOBAL_KEYS = GLOBAL_PERMISSIONS.map(p => p.key);
export const ALL_PROJECT_KEYS = PROJECT_PERMISSIONS.map(p => p.key);

export const DEFAULT_ROLES = [
  {
    name: 'Manager', scope: 'global', builtin: 1,
    description: 'Monitors every project: sees all work, time, meetings and reports.',
    permissions: ['projects.create', 'reports.view', 'teams.manage',
      'project.view', 'wp.view', 'wp.create', 'wp.comment', 'wp.assign', 'time.log', 'time.view_all',
      'meetings.view', 'meetings.manage', 'wiki.view'],
  },
  {
    name: 'Employee', scope: 'global', builtin: 1,
    description: 'Standard staff account. Sees only the projects they are a member of.',
    permissions: [],
  },
  {
    name: 'Project manager', scope: 'project', builtin: 1,
    description: 'Runs a project: members, planning, meetings.',
    permissions: ALL_PROJECT_KEYS.filter(k => k !== 'project.archive'),
  },
  {
    name: 'Team lead', scope: 'project', builtin: 0,
    description: 'Leads a team inside a project: assigns and reviews work.',
    permissions: ['project.view', 'wp.view', 'wp.create', 'wp.edit', 'wp.assign', 'wp.comment',
      'time.log', 'time.view_all', 'meetings.view', 'meetings.manage', 'wiki.view', 'wiki.edit', 'files.upload', 'news.manage'],
  },
  {
    name: 'Account manager', scope: 'project', builtin: 0,
    description: 'Owns the client relationship: follows progress, meetings and time.',
    permissions: ['project.view', 'wp.view', 'wp.create', 'wp.comment', 'time.log', 'time.view_all',
      'meetings.view', 'meetings.manage', 'wiki.view', 'files.upload', 'news.manage'],
  },
  {
    name: 'Business analyst', scope: 'project', builtin: 0,
    description: 'Writes and maintains requirements, specs and acceptance criteria.',
    permissions: ['project.view', 'project.versions', 'wp.view', 'wp.create', 'wp.edit', 'wp.assign', 'wp.comment',
      'time.log', 'meetings.view', 'meetings.manage', 'wiki.view', 'wiki.edit', 'files.upload'],
  },
  {
    name: 'Developer', scope: 'project', builtin: 0,
    description: 'Works on tasks and logs time.',
    permissions: ['project.view', 'wp.view', 'wp.create', 'wp.edit_own', 'wp.comment',
      'time.log', 'meetings.view', 'wiki.view', 'wiki.edit', 'files.upload'],
  },
  {
    name: 'QA / Tester', scope: 'project', builtin: 0,
    description: 'Tests features and reports bugs.',
    permissions: ['project.view', 'wp.view', 'wp.create', 'wp.edit_own', 'wp.comment',
      'time.log', 'meetings.view', 'wiki.view', 'files.upload'],
  },
  {
    name: 'Viewer', scope: 'project', builtin: 1,
    description: 'Read-only access (clients, stakeholders).',
    permissions: ['project.view', 'wp.view', 'meetings.view', 'wiki.view'],
  },
];
