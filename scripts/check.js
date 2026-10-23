// Decides whether components need installing or the web interface needs rebuilding,
// by comparing a hash of the relevant files with the hash stored after the last run.
//   node scripts/check.js need-install   -> exit 1 if "npm install" is needed
//   node scripts/check.js need-build     -> exit 1 if "npm run build" is needed
//   node scripts/check.js stamp-install  -> remember the current state after installing
//   node scripts/check.js stamp-build    -> remember the current state after building
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SETS = {
  install: { inputs: ['package.json', 'package-lock.json'], stamp: 'node_modules/.pt-install-hash', ready: 'node_modules' },
  build: { inputs: ['package.json', 'vite.config.js', 'client/index.html', 'client/src', 'client/public'], stamp: 'client/dist/.pt-build-hash', ready: 'client/dist/index.html' },
};

function files(p) {
  const full = path.join(root, p);
  if (!fs.existsSync(full)) return [];
  if (fs.statSync(full).isFile()) return [p];
  return fs.readdirSync(full).sort().flatMap(n => files(path.join(p, n)));
}

function hash(set) {
  const h = crypto.createHash('sha256');
  for (const f of set.inputs.flatMap(files)) {
    h.update(f.replace(/\\/g, '/'));
    // normalise line endings so Windows and Linux checkouts hash the same
    h.update(fs.readFileSync(path.join(root, f)).toString('binary').replace(/\r\n/g, '\n'));
  }
  return h.digest('hex');
}

const [mode, which] = (process.argv[2] || '').split('-');
const set = SETS[which];
if (!set || !['need', 'stamp'].includes(mode)) {
  console.error('Usage: node scripts/check.js need-install|need-build|stamp-install|stamp-build');
  process.exit(2);
}
const stampFile = path.join(root, set.stamp);
if (mode === 'stamp') {
  fs.mkdirSync(path.dirname(stampFile), { recursive: true });
  fs.writeFileSync(stampFile, hash(set));
  process.exit(0);
}
const ready = fs.existsSync(path.join(root, set.ready));
const same = fs.existsSync(stampFile) && fs.readFileSync(stampFile, 'utf8').trim() === hash(set);
process.exit(ready && same ? 0 : 1);
