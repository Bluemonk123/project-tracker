// Key people of a project (PM / AM / BA / DT) and their link status.
//   active   = at least one person is mapped and still active        -> link icon
//   broken   = someone was mapped before, but nobody is mapped now   -> broken link icon
//              (removed from the position, removed from the project, locked or deleted user)
//   unmapped = nobody has ever been mapped                           -> question mark
import { all, get, run, tx } from './db.js';
import { fail } from './access.js';

export const POSITIONS = [
  { code: 'PM', label: 'Project Manager', multiple: false, role: 'Project manager' },
  { code: 'AM', label: 'Account Manager', multiple: false, role: 'Account manager' },
  { code: 'BA', label: 'Business Analyst', multiple: false, role: 'Business analyst' },
  { code: 'DT', label: 'Development Team', multiple: true, role: 'Developer' },
];
export const POSITION_CODES = POSITIONS.map(p => p.code);

// Returns Map(projectId -> { PM: {...}, AM: {...}, BA: {...}, DT: {...} })
export function positionsFor(projectIds) {
  const out = new Map(projectIds.map(id => [id, Object.fromEntries(POSITIONS.map(p => [p.code, {
    code: p.code, label: p.label, multiple: p.multiple, status: 'unmapped', active: [], removed: [],
  }]))]));
  if (!projectIds.length) return out;
  const rows = all(`SELECT pp.*, u.status AS user_status, u.name AS current_name, rb.name AS removed_by_name
                    FROM project_positions pp
                    LEFT JOIN users u ON u.id = pp.user_id
                    LEFT JOIN users rb ON rb.id = pp.removed_by
                    WHERE pp.project_id IN (${projectIds.map(() => '?').join(',')})
                    ORDER BY pp.assigned_at, pp.id`, ...projectIds);
  for (const r of rows) {
    const slot = out.get(r.project_id)?.[r.position];
    if (!slot) continue;
    const isActive = !r.removed_at && r.user_id && r.user_status === 'active';
    const person = { id: r.id, user_id: r.user_id, name: r.current_name || r.user_name, since: r.assigned_at };
    if (isActive) slot.active.push(person);
    else {
      const reason = r.removed_reason || (!r.user_id ? 'User deleted' : r.user_status !== 'active' ? 'User locked' : 'Removed');
      slot.removed.push({ ...person, removed_at: r.removed_at, removed_by: r.removed_by_name, reason });
    }
  }
  for (const proj of out.values()) {
    for (const slot of Object.values(proj)) {
      slot.status = slot.active.length ? 'active' : slot.removed.length ? 'broken' : 'unmapped';
      slot.removed.reverse(); // most recent first
    }
  }
  return out;
}

const roleId = (name) => (get("SELECT id FROM roles WHERE scope = 'project' AND name = ?", name)
  || get("SELECT id FROM roles WHERE scope = 'project' AND name = 'Developer'")
  || get("SELECT id FROM roles WHERE scope = 'project' ORDER BY position LIMIT 1")).id;

// Replace the people mapped to one position. Unlisted people are marked removed (not deleted).
export function setPosition(projectId, code, userIds, actorId, { reason = null } = {}) {
  const def = POSITIONS.find(p => p.code === code) || fail(400, 'Unknown position. Use PM, AM, BA or DT.');
  const ids = [...new Set((userIds || []).map(Number).filter(Boolean))];
  if (!def.multiple && ids.length > 1) fail(400, `Only one person can be the ${def.label}.`);
  const users = ids.map(id => get("SELECT id, name, status FROM users WHERE id = ?", id) || fail(400, 'User not found.'));
  if (users.some(u => u.status !== 'active')) fail(400, 'Locked users cannot be mapped.');
  return tx(() => {
    const current = all('SELECT * FROM project_positions WHERE project_id = ? AND position = ? AND removed_at IS NULL', projectId, code);
    const changes = { added: [], removed: [] };
    for (const c of current) {
      if (!ids.includes(c.user_id)) {
        run("UPDATE project_positions SET removed_at = datetime('now'), removed_by = ?, removed_reason = ? WHERE id = ?",
          actorId, reason || (ids.length ? `Replaced` : 'Removed'), c.id);
        changes.removed.push(c.user_id);
      }
    }
    for (const u of users) {
      if (current.some(c => c.user_id === u.id)) continue;
      run('INSERT INTO project_positions(project_id, position, user_id, user_name, assigned_by) VALUES(?,?,?,?,?)', projectId, code, u.id, u.name, actorId);
      // mapped people must be able to see the project
      run('INSERT OR IGNORE INTO project_members(project_id, user_id, role_id) VALUES(?,?,?)', projectId, u.id, roleId(def.role));
      changes.added.push(u.id);
    }
    if (code === 'PM') run("UPDATE projects SET manager_id = ?, updated_at = datetime('now') WHERE id = ?", ids[0] || null, projectId);
    return changes;
  });
}

// Called when someone leaves a project: their positions in it become broken links.
export function removeUserFromPositions(projectId, userId, actorId, reason = 'Removed from project') {
  const rows = all('SELECT position FROM project_positions WHERE project_id = ? AND user_id = ? AND removed_at IS NULL', projectId, userId);
  run(`UPDATE project_positions SET removed_at = datetime('now'), removed_by = ?, removed_reason = ?
       WHERE project_id = ? AND user_id = ? AND removed_at IS NULL`, actorId, reason, projectId, userId);
  if (rows.some(r => r.position === 'PM')) run("UPDATE projects SET manager_id = NULL WHERE id = ? AND manager_id = ?", projectId, userId);
  return rows.map(r => r.position);
}
