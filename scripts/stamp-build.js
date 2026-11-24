// Writes client/dist/build.json after "npm run build": when it was built and from which commit.
// /api/health shows it, so a deployment can be checked from outside.
import fs from 'node:fs';
import { execSync } from 'node:child_process';
let commit = process.env.SOURCE_COMMIT || process.env.GIT_COMMIT || null;
if (!commit) { try { commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* no git here */ } }
fs.writeFileSync(new URL('../client/dist/build.json', import.meta.url), JSON.stringify({ built_at: new Date().toISOString(), commit }));
