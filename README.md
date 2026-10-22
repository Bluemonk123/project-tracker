# Project Tracker

A self-hosted project management app for an office that builds several applications. It runs on one computer in the office; everyone else opens it in their browser. All data stays in a single folder on that computer.

It covers the same ground as OpenProject for day-to-day work:

| Area | What you get |
|---|---|
| Projects | One project per application, with a short key (CRM, HRMS…), colour, manager, dates, status (on track / at risk / off track) and sub-projects |
| Requirements | Requirement, Epic, Feature and User story types, with a requirements page that shows how far each requirement's tasks have got |
| Work packages | Tasks, bugs, features, milestones. Assignee, accountable person, priority, status, version, category, start and finish dates, estimates, % done, parent/child hierarchy, relations (blocks, precedes, duplicates), watchers, files, comments with @mentions, and a full change history |
| Views | Filterable and sortable list with saved views, grouping, bulk edit, CSV export and print. Kanban board (by status, person or version, drag and drop). Gantt chart (drag to reschedule, dependency arrows). Calendar. Roadmap of versions |
| Teams | Teams of people, added to a project in one step. Workload per person and per team |
| Managers | A manager overview across every project: status, progress, overdue work, next release, next meeting, and who is carrying how much work |
| Meetings | Daily stand-ups and weekly reviews as repeating series. Agendas (including linked work packages), stand-up updates (since last time, today, blockers) with a "fill from my work" button, attendance, outcomes, minutes, action items that become real work packages, and an automatic review summary of the week |
| Time | Log time against tasks, a weekly timesheet, and reports by person, project, activity, day, week or month (CSV export) |
| Wiki | Markdown pages per project with sub-pages, version history and attachments, for specs and documentation |
| Roles | Built-in roles plus your own custom roles with fine-grained permissions, both global (e.g. Manager sees every project) and per project (e.g. Developer, QA, Viewer) |
| Other | In-app notifications, project announcements, global search, my page, dark mode, daily automatic backups |

## Requirements

- **Node.js 22.13 or newer** (the LTS version from <https://nodejs.org>). Nothing else: the database is built in.
- Windows 10/11, macOS or Linux.
- About 200 MB of disk space plus your data. 100 users is comfortably within what it handles.

## Install on the office laptop

1. Install **Node.js LTS** from <https://nodejs.org> (accept the defaults).
2. Get this project onto the laptop, either:
   - on GitHub, click **Code → Download ZIP** and unzip it somewhere permanent, e.g. `C:\ProjectTracker`, **or**
   - with Git: `git clone https://github.com/Bluemonk123/project-tracker.git C:\ProjectTracker`
3. Open the folder and double-click **`start.bat`** (on Mac/Linux run `./start.sh`).
   The first run installs components and builds the interface, which takes a minute or two and needs internet.
4. A window shows the addresses, for example:

   ```
   On this computer:      http://localhost:4000
   On the office network: http://192.168.1.25:4000
   ```

5. Open `http://localhost:4000` in your browser. The first screen asks you to create the **administrator** account and name the app.
6. Keep the window open while people use the app. Closing it stops the app.

### Letting colleagues in

- Give colleagues the **office network** address shown in the window (e.g. `http://192.168.1.25:4000`).
- The first time, Windows may ask whether to allow Node.js through the firewall. Choose **Allow** for *Private networks*.
- If colleagues cannot connect, check the laptop is on the same network, and that the firewall allows port 4000.
- Laptop IP addresses can change. Ask IT to give the laptop a fixed (reserved) IP address so the link keeps working.

### Adding people

Go to **Administration → Users → New user**. Give each person:

- a **global role**: *Manager* (sees and monitors every project, the manager overview and reports) or *Employee* (sees only projects they are a member of);
- teams they belong to.

Then open a project → **Members → Add members** to add people or a whole team with a project role (*Project manager*, *Team lead*, *Developer*, *QA / Tester*, *Viewer*).

Create your own roles in **Administration → Roles and permissions**, and adjust types, statuses and priorities under **Types, statuses, priorities**.

## Try it with sample data

On a fresh install (before creating any projects) you can load three sample projects, seven people, tasks, meetings and time entries:

```
npm run demo
```

Every sample person signs in with the password `demo12345` (e.g. `priya@office.local` is a manager, `rahul@office.local` a developer). If no admin exists yet it also creates `admin@office.local`. Delete the `data` folder afterwards to start clean.

## Your data and backups

Everything lives in the **`data`** folder next to `start.bat`:

| Path | Contents |
|---|---|
| `data/tracker.db` | The database (all projects, tasks, meetings, users…) |
| `data/uploads/` | Uploaded files |
| `data/backups/` | Automatic daily copies of the database (the last 14 are kept) |

- **Back up:** Administration → Backups → *Back up now* and *Download*, or copy the whole `data` folder while the app is stopped. Keep a copy off the laptop (USB drive, shared drive).
- **Move to another computer:** stop the app, copy the `data` folder into the new installation, start it.
- **Restore a backup:** stop the app, replace `data/tracker.db` with the backup file (renamed to `tracker.db`), start it.

## Updating

If you installed with Git, double-click **`update.bat`** (or run `git pull && npm install && npm run build`), then restart. If you used the ZIP, download the new ZIP, unzip it into a new folder, copy your `data` folder across, and run `start.bat`. The database is upgraded automatically; your data is never overwritten by an update.

## Start automatically when the laptop starts (Windows)

1. Press `Win + R`, type `shell:startup`, press Enter.
2. Right-click in that folder → **New → Shortcut**, and point it at `start.bat`.

The app then starts each time you sign in to Windows.

## Settings

Set these as environment variables if you need to change the defaults:

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `4000` | Port the app listens on |
| `DATA_DIR` | `./data` | Where the database, uploads and backups are kept |
| `MAX_UPLOAD_MB` | `25` | Largest file people can attach |

On Windows: `set PORT=8080` then `start.bat`, in the same Command Prompt window.

## Docker (optional)

```
docker compose up -d
```

Data is kept in `./data` on the host.

## For developers

```
npm install
npm run dev     # API on :4000 with auto-reload, interface on http://localhost:5173
npm test        # API tests on a throwaway database
npm run build   # production build of the interface into client/dist
```

- `server/` Express API on Node's built-in SQLite (`node:sqlite`). `schema.sql` is the data model, `permissions.js` the permission catalogue and default roles, `routes/` the endpoints.
- `client/` React app built with Vite.
- Sessions are HTTP-only cookies; passwords are hashed with scrypt.
- Meeting times are stored as the office's local time; other timestamps are UTC.
