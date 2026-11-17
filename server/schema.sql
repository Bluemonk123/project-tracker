-- Project Tracker schema (SQLite)
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- Roles hold a JSON array of permission keys.
-- scope = 'global'  -> assigned to a user for the whole system (e.g. Manager, Employee)
-- scope = 'project' -> assigned per project membership (e.g. Project manager, Developer)
CREATE TABLE IF NOT EXISTS roles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  scope       TEXT NOT NULL CHECK (scope IN ('global','project')),
  description TEXT,
  permissions TEXT NOT NULL DEFAULT '[]',
  builtin     INTEGER NOT NULL DEFAULT 0,
  position    INTEGER NOT NULL DEFAULT 0,
  UNIQUE (name, scope)
);

CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  email          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash  TEXT NOT NULL,
  is_admin       INTEGER NOT NULL DEFAULT 0,
  global_role_id INTEGER REFERENCES roles(id) ON DELETE SET NULL,
  job_title      TEXT,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','locked')),
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at  TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS teams (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  lead_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS team_members (
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (team_id, user_id)
);

CREATE TABLE IF NOT EXISTS projects (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  name               TEXT NOT NULL,
  identifier         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description        TEXT,
  color              TEXT NOT NULL DEFAULT '#0070C0',
  status             TEXT NOT NULL DEFAULT 'not_set'
                     CHECK (status IN ('not_set','on_track','at_risk','off_track','finished','discontinued')),
  status_explanation TEXT,
  parent_id          INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  manager_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  start_date         TEXT,
  end_date           TEXT,
  archived           INTEGER NOT NULL DEFAULT 0,
  wp_seq             INTEGER NOT NULL DEFAULT 0,
  created_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS project_members (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id    INTEGER NOT NULL REFERENCES roles(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, user_id)
);

-- Key people of a project: PM (project manager), AM (account manager), BA (business analyst),
-- DT (development team). Rows are never deleted, only marked removed, so the app can tell
-- "never mapped" (question mark) apart from "was mapped, now removed" (broken link).
CREATE TABLE IF NOT EXISTS project_positions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  position    TEXT NOT NULL CHECK (position IN ('PM','AM','BA','DT')),
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  user_name   TEXT NOT NULL,
  assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
  assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  removed_at  TEXT,
  removed_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  removed_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_positions_project ON project_positions(project_id, position);

CREATE TABLE IF NOT EXISTS types (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL UNIQUE,
  color        TEXT NOT NULL DEFAULT '#5B6472',
  is_milestone INTEGER NOT NULL DEFAULT 0,
  position     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS statuses (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  color      TEXT NOT NULL DEFAULT '#8A93A0',
  is_closed  INTEGER NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0,
  done_ratio INTEGER,
  board_column TEXT,          -- tickets | new | design | develop | testing | closed (Task Board column)
  position   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS priorities (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  color      TEXT NOT NULL DEFAULT '#8A93A0',
  is_default INTEGER NOT NULL DEFAULT 0,
  position   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS versions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','locked','closed')),
  start_date  TEXT,
  due_date    TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, name)
);

CREATE TABLE IF NOT EXISTS categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  UNIQUE (project_id, name)
);

CREATE TABLE IF NOT EXISTS work_packages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  number          INTEGER NOT NULL,
  type_id         INTEGER NOT NULL REFERENCES types(id),
  subject         TEXT NOT NULL,
  description     TEXT,
  status_id       INTEGER NOT NULL REFERENCES statuses(id),
  priority_id     INTEGER NOT NULL REFERENCES priorities(id),
  assignee_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  responsible_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  author_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  parent_id       INTEGER REFERENCES work_packages(id) ON DELETE SET NULL,
  version_id      INTEGER REFERENCES versions(id) ON DELETE SET NULL,
  category_id     INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  start_date      TEXT,
  due_date        TEXT,
  estimated_hours REAL,
  done_ratio      INTEGER NOT NULL DEFAULT 0,
  position        REAL NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, number)
);
CREATE INDEX IF NOT EXISTS idx_wp_project  ON work_packages(project_id);
CREATE INDEX IF NOT EXISTS idx_wp_assignee ON work_packages(assignee_id);
CREATE INDEX IF NOT EXISTS idx_wp_parent   ON work_packages(parent_id);

CREATE TABLE IF NOT EXISTS wp_relations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id    INTEGER NOT NULL REFERENCES work_packages(id) ON DELETE CASCADE,
  to_id      INTEGER NOT NULL REFERENCES work_packages(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (type IN ('relates','blocks','precedes','duplicates')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (from_id, to_id, type)
);

-- Web links attached to a work package (designs, documents, test builds...)
CREATE TABLE IF NOT EXISTS wp_links (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  wp_id      INTEGER NOT NULL REFERENCES work_packages(id) ON DELETE CASCADE,
  url        TEXT NOT NULL,
  title      TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_wp_links ON wp_links(wp_id);

-- Which stage (board column) a work package was in and when: New, In Design, In Develop, In Testing, Closed
CREATE TABLE IF NOT EXISTS wp_stages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  wp_id      INTEGER NOT NULL REFERENCES work_packages(id) ON DELETE CASCADE,
  stage      TEXT NOT NULL,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  entered_at TEXT NOT NULL DEFAULT (datetime('now')),
  left_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_wp_stages ON wp_stages(wp_id, entered_at);

CREATE TABLE IF NOT EXISTS wp_watchers (
  wp_id   INTEGER NOT NULL REFERENCES work_packages(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (wp_id, user_id)
);

-- Activity log + comments for work packages
CREATE TABLE IF NOT EXISTS journals (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  wp_id      INTEGER NOT NULL REFERENCES work_packages(id) ON DELETE CASCADE,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notes      TEXT,
  changes    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_journals_wp ON journals(wp_id);

CREATE TABLE IF NOT EXISTS time_entries (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  wp_id      INTEGER REFERENCES work_packages(id) ON DELETE SET NULL,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  spent_on   TEXT NOT NULL,
  hours      REAL NOT NULL CHECK (hours > 0 AND hours <= 24),
  activity   TEXT NOT NULL DEFAULT 'Development',
  comment    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_time_user ON time_entries(user_id, spent_on);

CREATE TABLE IF NOT EXISTS meetings (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id       INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  series_id        TEXT,
  title            TEXT NOT NULL,
  kind             TEXT NOT NULL DEFAULT 'daily' CHECK (kind IN ('daily','weekly','review','planning','other')),
  starts_at        TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 15,
  location         TEXT,
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','closed')),
  minutes          TEXT,
  created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_meetings_start ON meetings(starts_at);

CREATE TABLE IF NOT EXISTS meeting_participants (
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  attended   INTEGER,
  PRIMARY KEY (meeting_id, user_id)
);

CREATE TABLE IF NOT EXISTS meeting_agenda_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id   INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  notes        TEXT,
  outcome      TEXT,
  duration     INTEGER,
  presenter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  wp_id        INTEGER REFERENCES work_packages(id) ON DELETE SET NULL,
  done         INTEGER NOT NULL DEFAULT 0,
  position     INTEGER NOT NULL DEFAULT 0
);

-- Action items created during a meeting (each is a real work package)
CREATE TABLE IF NOT EXISTS meeting_actions (
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  wp_id      INTEGER NOT NULL REFERENCES work_packages(id) ON DELETE CASCADE,
  PRIMARY KEY (meeting_id, wp_id)
);

-- Daily stand-up updates: what I did / what I'll do / blockers
CREATE TABLE IF NOT EXISTS standup_updates (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  yesterday  TEXT,
  today      TEXT,
  blockers   TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (meeting_id, user_id)
);

CREATE TABLE IF NOT EXISTS wiki_pages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_id  INTEGER REFERENCES wiki_pages(id) ON DELETE SET NULL,
  title      TEXT NOT NULL,
  content    TEXT NOT NULL DEFAULT '',
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, title)
);

CREATE TABLE IF NOT EXISTS wiki_versions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id    INTEGER NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS news (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  body       TEXT,
  author_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS attachments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  container_type TEXT NOT NULL CHECK (container_type IN ('wp','meeting','wiki','project')),
  container_id   INTEGER NOT NULL,
  project_id     INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  filename       TEXT NOT NULL,
  stored_name    TEXT NOT NULL,
  content_type   TEXT,
  size           INTEGER NOT NULL DEFAULT 0,
  uploaded_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_attach_container ON attachments(container_type, container_id);

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  wp_id      INTEGER REFERENCES work_packages(id) ON DELETE CASCADE,
  meeting_id INTEGER REFERENCES meetings(id) ON DELETE CASCADE,
  reason     TEXT NOT NULL,
  message    TEXT NOT NULL,
  read_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read_at);

-- Saved filters ("views") for the work package list
CREATE TABLE IF NOT EXISTS saved_queries (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  query      TEXT NOT NULL,
  is_public  INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Technologies used by a project, with where to look up new versions online (information only)
CREATE TABLE IF NOT EXISTS project_technologies (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  category     TEXT NOT NULL DEFAULT 'Other',
  version_used TEXT,
  source       TEXT NOT NULL DEFAULT 'none',
  package_id   TEXT,
  eol_slug     TEXT,
  notes        TEXT,
  position     INTEGER NOT NULL DEFAULT 0,
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tech_project ON project_technologies(project_id);

CREATE TABLE IF NOT EXISTS tech_lookup_cache (
  key        TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);

-- Project Board: the customer's own user roles in the application being built
CREATE TABLE IF NOT EXISTS project_customer_roles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  position    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_customer_roles ON project_customer_roles(project_id, position);

-- Project Board: who approves each module (first and second approver)
CREATE TABLE IF NOT EXISTS project_approvals (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id         INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  module             TEXT NOT NULL,
  first_approver_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  second_approver_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_project_approvals ON project_approvals(project_id, id);

-- Project Board: the list of documents a project keeps (starts with the seven standard ones; can be renamed, added, removed)
CREATE TABLE IF NOT EXISTS project_doc_slots (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  detail     TEXT,
  position   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_doc_slots ON project_doc_slots(project_id, position);

-- Project Board: release notes (document name + version, with uploaded files stored as attachments with doc_slot 'rn:<id>')
CREATE TABLE IF NOT EXISTS project_release_notes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  version    TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_release_notes ON project_release_notes(project_id, created_at);

-- Project Board: approvals are grouped into sections (e.g. Phase 1, UAT sign-off)
CREATE TABLE IF NOT EXISTS project_approval_sections (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_approval_sections ON project_approval_sections(project_id, created_at);

-- ---------- Ticket Board (helpdesk) ----------
-- Times in the ticket tables are ISO 8601 UTC strings (2026-11-16T11:52:00.000Z).
CREATE TABLE IF NOT EXISTS tickets (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_no          INTEGER NOT NULL UNIQUE,              -- 8 digits, from 10000001
  status             TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','pending','hold','solved')),
  subject            TEXT,
  feedback           TEXT NOT NULL,                        -- the description (first message)
  priority           TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('urgent','high','normal')),
  ticket_type        TEXT NOT NULL DEFAULT 'issue' CHECK (ticket_type IN ('issue','feedback','feature','task')),
  group_name         TEXT NOT NULL DEFAULT 'Support',
  channel            TEXT NOT NULL DEFAULT 'web' CHECK (channel IN ('web','email','agent')),
  source             TEXT,                                 -- header / login page / agent / task board
  requester_kind     TEXT NOT NULL DEFAULT 'staff' CHECK (requester_kind IN ('staff','partner','guest')),
  requester_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  raised_by          TEXT NOT NULL,
  requester_email    TEXT,
  partner_code       TEXT,
  assignee_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  tags               TEXT,
  linked_record      TEXT,
  notes              TEXT,                                 -- closing notes, appended
  raised_on          TEXT NOT NULL,
  hold_started_at    TEXT,
  sla_paused_seconds INTEGER NOT NULL DEFAULT 0,
  solved_at          TEXT,
  sla_due_at         TEXT,
  created_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_tickets_assignee ON tickets(assignee_id);
CREATE INDEX IF NOT EXISTS idx_tickets_raised_by ON tickets(raised_by);
CREATE INDEX IF NOT EXISTS idx_tickets_requester ON tickets(requester_user_id);

CREATE TABLE IF NOT EXISTS ticket_messages (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id        INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_type      TEXT NOT NULL CHECK (author_type IN ('requester','user','system')),
  author_user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  author_name      TEXT,
  body             TEXT NOT NULL DEFAULT '',
  is_internal      INTEGER NOT NULL DEFAULT 0,
  email_message_id TEXT,
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ticket_messages ON ticket_messages(ticket_id, created_at);

CREATE TABLE IF NOT EXISTS ticket_attachments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id   INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  message_id  INTEGER REFERENCES ticket_messages(id) ON DELETE CASCADE,  -- NULL: raised with the ticket
  file_name   TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime_type   TEXT,
  size_bytes  INTEGER NOT NULL DEFAULT 0,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ticket_attachments ON ticket_attachments(ticket_id, message_id);

CREATE TABLE IF NOT EXISTS ticket_macros (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  body_template TEXT NOT NULL,          -- {customer_first_name} {agent_first_name} {ticket_id}
  set_status    TEXT,
  set_group     TEXT,
  is_internal   INTEGER NOT NULL DEFAULT 0,
  active        INTEGER NOT NULL DEFAULT 1,
  display_order INTEGER NOT NULL DEFAULT 0
);

-- Master list of ticket groups (admin-editable; deactivated groups stay deactivated)
CREATE TABLE IF NOT EXISTS ticket_groups (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  name     TEXT NOT NULL UNIQUE,
  active   INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 0
);

-- General audit log (who did what to which record)
CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   INTEGER,
  details     TEXT,
  ip          TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);

-- Remarks on a task: short notes addressed to a chosen person (several per task)
CREATE TABLE IF NOT EXISTS wp_remarks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  wp_id      INTEGER NOT NULL REFERENCES work_packages(id) ON DELETE CASCADE,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,   -- the person the remark is for
  body       TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_wp_remarks ON wp_remarks(wp_id, created_at);

-- Criticality of a task (how serious the impact is): C1 highest. Lowest first, like priorities.
CREATE TABLE IF NOT EXISTS criticalities (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  color      TEXT NOT NULL DEFAULT '#5B6472',
  is_default INTEGER NOT NULL DEFAULT 0,
  position   INTEGER NOT NULL DEFAULT 0
);

-- Holidays (no work): used with the weekly off days to work out due dates from a priority's duration
CREATE TABLE IF NOT EXISTS holidays (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  day  TEXT NOT NULL UNIQUE,   -- YYYY-MM-DD
  name TEXT NOT NULL
);
