// Looks up the latest and recent release versions of technologies from public, free sources.
// Information only: nothing here changes a project. Results are cached in the database for 12 hours.
import { get, run } from './db.js';
import { todayISO } from './util.js';

export const SOURCES = {
  npm: { label: 'npm (JavaScript)', hint: 'Package name, e.g. react or @angular/core', page: (id) => `https://www.npmjs.com/package/${id}` },
  pypi: { label: 'PyPI (Python)', hint: 'Package name, e.g. django', page: (id) => `https://pypi.org/project/${id}/` },
  nuget: { label: 'NuGet (.NET)', hint: 'Package id, e.g. Microsoft.EntityFrameworkCore', page: (id) => `https://www.nuget.org/packages/${id}` },
  maven: { label: 'Maven (Java)', hint: 'group:artifact, e.g. org.springframework.boot:spring-boot', page: (id) => `https://central.sonatype.com/artifact/${id.replace(':', '/')}` },
  go: { label: 'Go modules', hint: 'Module path, e.g. github.com/gin-gonic/gin', page: (id) => `https://pkg.go.dev/${id}` },
  cargo: { label: 'Cargo (Rust)', hint: 'Crate name, e.g. serde', page: (id) => `https://crates.io/crates/${id}` },
  packagist: { label: 'Packagist (PHP)', hint: 'vendor/package, e.g. laravel/framework', page: (id) => `https://packagist.org/packages/${id}` },
  rubygems: { label: 'RubyGems (Ruby)', hint: 'Gem name, e.g. rails', page: (id) => `https://rubygems.org/gems/${id}` },
  pub: { label: 'pub.dev (Dart / Flutter packages)', hint: 'Package name, e.g. http', page: (id) => `https://pub.dev/packages/${id}` },
  flutter: { label: 'Flutter SDK', hint: 'No id needed', page: () => 'https://docs.flutter.dev/release/archive' },
  github: { label: 'GitHub releases', hint: 'owner/repo, e.g. facebook/react', page: (id) => `https://github.com/${id}/releases` },
  endoflife: { label: 'endoflife.date (runtimes, databases, OS)', hint: 'Product, e.g. nodejs, postgresql, ubuntu', page: (id) => `https://endoflife.date/${id}` },
  none: { label: 'Do not check online', hint: '', page: () => null },
};

// Common technologies: picking one fills in where to check versions.
// [name, category, source, package id, endoflife.date product for support dates]
export const CATALOG = [
  ['React', 'Frontend', 'npm', 'react', 'react'], ['Angular', 'Frontend', 'npm', '@angular/core', 'angular'],
  ['AngularJS', 'Frontend', 'npm', 'angular', 'angularjs'], ['Vue.js', 'Frontend', 'npm', 'vue', 'vue'],
  ['Next.js', 'Frontend', 'npm', 'next', 'nextjs'], ['Nuxt', 'Frontend', 'npm', 'nuxt', 'nuxt'],
  ['Svelte', 'Frontend', 'npm', 'svelte', 'svelte'], ['jQuery', 'Frontend', 'npm', 'jquery', 'jquery'],
  ['Bootstrap', 'Frontend', 'npm', 'bootstrap', 'bootstrap'], ['Tailwind CSS', 'Frontend', 'npm', 'tailwindcss', 'tailwind-css'],
  ['TypeScript', 'Language', 'npm', 'typescript', null], ['Vite', 'Tooling', 'npm', 'vite', null],
  ['Webpack', 'Tooling', 'npm', 'webpack', null], ['Redux Toolkit', 'Frontend', 'npm', '@reduxjs/toolkit', null],
  ['Material UI', 'Frontend', 'npm', '@mui/material', null], ['Axios', 'Frontend', 'npm', 'axios', null],
  ['Node.js', 'Runtime', 'endoflife', 'nodejs', 'nodejs'], ['Express', 'Backend', 'npm', 'express', null],
  ['NestJS', 'Backend', 'npm', '@nestjs/core', null], ['Socket.IO', 'Backend', 'npm', 'socket.io', null],
  ['Prisma', 'Backend', 'npm', 'prisma', null], ['Sequelize', 'Backend', 'npm', 'sequelize', null],
  ['Mongoose', 'Backend', 'npm', 'mongoose', null], ['Electron', 'Desktop', 'npm', 'electron', 'electron'],
  ['React Native', 'Mobile', 'npm', 'react-native', 'react-native'], ['Ionic', 'Mobile', 'npm', '@ionic/core', 'ionic'],
  ['Capacitor', 'Mobile', 'npm', '@capacitor/core', null], ['Firebase JS SDK', 'Backend', 'npm', 'firebase', null],
  ['Flutter', 'Mobile', 'flutter', '', null], ['Android', 'Mobile', 'endoflife', 'android', 'android'],
  ['iOS', 'Mobile', 'endoflife', 'ios', 'ios'],
  ['Python', 'Language', 'endoflife', 'python', 'python'], ['Django', 'Backend', 'pypi', 'django', 'django'],
  ['Flask', 'Backend', 'pypi', 'flask', null], ['FastAPI', 'Backend', 'pypi', 'fastapi', null],
  ['Celery', 'Backend', 'pypi', 'celery', null], ['Pandas', 'Data', 'pypi', 'pandas', null],
  ['PHP', 'Language', 'endoflife', 'php', 'php'], ['Laravel', 'Backend', 'packagist', 'laravel/framework', 'laravel'],
  ['Symfony', 'Backend', 'packagist', 'symfony/symfony', 'symfony'], ['CodeIgniter', 'Backend', 'packagist', 'codeigniter4/framework', null],
  ['WordPress', 'CMS', 'endoflife', 'wordpress', 'wordpress'], ['Drupal', 'CMS', 'endoflife', 'drupal', 'drupal'],
  ['.NET', 'Runtime', 'endoflife', 'dotnet', 'dotnet'], ['Entity Framework Core', 'Backend', 'nuget', 'Microsoft.EntityFrameworkCore', null],
  ['Newtonsoft.Json', 'Backend', 'nuget', 'Newtonsoft.Json', null], ['Java (Temurin)', 'Language', 'endoflife', 'eclipse-temurin', 'eclipse-temurin'],
  ['Spring Boot', 'Backend', 'maven', 'org.springframework.boot:spring-boot', 'spring-boot'],
  ['Spring Framework', 'Backend', 'maven', 'org.springframework:spring-core', 'spring-framework'],
  ['Hibernate ORM', 'Backend', 'maven', 'org.hibernate.orm:hibernate-core', null], ['Kotlin', 'Language', 'endoflife', 'kotlin', 'kotlin'],
  ['Go', 'Language', 'endoflife', 'go', 'go'], ['Gin', 'Backend', 'go', 'github.com/gin-gonic/gin', null],
  ['Ruby', 'Language', 'endoflife', 'ruby', 'ruby'], ['Ruby on Rails', 'Backend', 'rubygems', 'rails', 'rails'],
  ['PostgreSQL', 'Database', 'endoflife', 'postgresql', 'postgresql'], ['MySQL', 'Database', 'endoflife', 'mysql', 'mysql'],
  ['MariaDB', 'Database', 'endoflife', 'mariadb', 'mariadb'], ['MongoDB', 'Database', 'endoflife', 'mongodb', 'mongodb'],
  ['Redis', 'Database', 'endoflife', 'redis', 'redis'], ['SQL Server', 'Database', 'endoflife', 'mssqlserver', 'mssqlserver'],
  ['Oracle Database', 'Database', 'endoflife', 'oracle-database', 'oracle-database'], ['SQLite', 'Database', 'endoflife', 'sqlite', 'sqlite'],
  ['Elasticsearch', 'Database', 'endoflife', 'elasticsearch', 'elasticsearch'], ['RabbitMQ', 'Infrastructure', 'endoflife', 'rabbitmq', 'rabbitmq'],
  ['Apache Kafka', 'Infrastructure', 'endoflife', 'apache-kafka', 'apache-kafka'],
  ['Docker Engine', 'DevOps', 'endoflife', 'docker-engine', 'docker-engine'], ['Kubernetes', 'DevOps', 'endoflife', 'kubernetes', 'kubernetes'],
  ['Terraform', 'DevOps', 'endoflife', 'terraform', 'terraform'], ['Jenkins', 'DevOps', 'endoflife', 'jenkins', 'jenkins'],
  ['Gradle', 'Tooling', 'endoflife', 'gradle', 'gradle'], ['Nginx', 'Infrastructure', 'endoflife', 'nginx', 'nginx'],
  ['Apache HTTP Server', 'Infrastructure', 'endoflife', 'apache-http-server', 'apache-http-server'],
  ['Apache Tomcat', 'Infrastructure', 'endoflife', 'tomcat', 'tomcat'], ['Ubuntu', 'OS', 'endoflife', 'ubuntu', 'ubuntu'],
  ['Windows Server', 'OS', 'endoflife', 'windows-server', 'windows-server'], ['Unity', 'Tooling', 'endoflife', 'unity', 'unity'],
].map(([name, category, source, package_id, eol_slug]) => ({ name, category, source, package_id, eol_slug }));

export const CATEGORIES = ['Frontend', 'Backend', 'Mobile', 'Desktop', 'Language', 'Runtime', 'Database', 'Data', 'CMS', 'Infrastructure', 'DevOps', 'Tooling', 'OS', 'Other'];

const TTL_MS = 12 * 3600 * 1000;
const UA = { 'User-Agent': 'ProjectTracker (self-hosted; version check)', Accept: 'application/json' };

async function getJson(url) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(12000) });
  if (res.status === 404) throw new Error('Not found at the source. Check the package name.');
  if (res.status === 403 || res.status === 429) throw new Error('The source is limiting requests. Try again later.');
  if (!res.ok) throw new Error(`The source answered ${res.status}.`);
  return res.json();
}

// ---------- version helpers ----------
const PRE = /(alpha|beta|rc|pre|preview|dev|snapshot|canary|next|nightly|experimental|insiders|m\d+$)/i;
export const isStable = (v) => !!v && !/-/.test(String(v).replace(/^v/, '')) && !PRE.test(String(v));
const parts = (v) => String(v || '').replace(/^v/i, '').split(/[.+-]/).map(x => (/^\d+$/.test(x) ? Number(x) : x));
export function cmpVersion(a, b) {
  const pa = parts(a), pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0, y = pb[i] ?? 0;
    if (typeof x === 'number' && typeof y === 'number') { if (x !== y) return x - y; }
    else if (String(x) !== String(y)) return String(x) < String(y) ? -1 : 1;
  }
  return 0;
}
const day = (d) => (d ? String(d).slice(0, 10) : null);

function summarize(versions /* [{version, date}] */) {
  versions = versions.filter(v => v.version).map(v => ({ ...v, version: String(v.version).replace(/^v(?=\d)/i, '') }));
  const stable = versions.filter(v => isStable(v.version));
  const pool = stable.length ? stable : versions;
  pool.sort((a, b) => cmpVersion(b.version, a.version));
  return { latest: pool[0] || null, releases: pool.slice(0, 8) };
}

// ---------- fetchers per source ----------
const DEPS_SYSTEM = { npm: 'npm', pypi: 'pypi', nuget: 'nuget', maven: 'maven', go: 'go', cargo: 'cargo' };

async function fetchPackage(source, id) {
  if (DEPS_SYSTEM[source]) {
    const d = await getJson(`https://api.deps.dev/v3/systems/${DEPS_SYSTEM[source]}/packages/${encodeURIComponent(id)}`);
    return summarize((d.versions || []).map(v => ({ version: v.versionKey?.version, date: day(v.publishedAt) })));
  }
  if (source === 'packagist') {
    const d = await getJson(`https://repo.packagist.org/p2/${id}.json`);
    const list = d.packages?.[id] || Object.values(d.packages || {})[0] || [];
    return summarize(list.map(v => ({ version: v.version_normalized ? v.version.replace(/^v/, '') : v.version, date: day(v.time) })));
  }
  if (source === 'rubygems') {
    const d = await getJson(`https://rubygems.org/api/v1/versions/${encodeURIComponent(id)}.json`);
    return summarize(d.map(v => ({ version: v.number, date: day(v.created_at) })));
  }
  if (source === 'pub') {
    const d = await getJson(`https://pub.dev/api/packages/${encodeURIComponent(id)}`);
    return summarize((d.versions || []).map(v => ({ version: v.version, date: day(v.published) })));
  }
  if (source === 'flutter') {
    const d = await getJson('https://storage.googleapis.com/flutter_infra_release/releases/releases_linux.json');
    const seen = new Set();
    const list = (d.releases || []).filter(r => r.channel === 'stable' && !seen.has(r.version) && seen.add(r.version))
      .map(r => ({ version: r.version, date: day(r.release_date) }));
    return summarize(list);
  }
  if (source === 'github') {
    const d = await getJson(`https://api.github.com/repos/${id}/releases?per_page=30`);
    return summarize(d.filter(r => !r.draft).map(r => ({ version: String(r.tag_name).replace(/^v/i, '').replace(/^[a-z-]+@/i, ''), date: day(r.published_at), pre: r.prerelease }))
      .filter(r => !r.pre));
  }
  return null;
}

async function fetchCycles(slug) {
  const d = await getJson(`https://endoflife.date/api/${encodeURIComponent(slug)}.json`);
  return d.slice(0, 40).map(c => ({
    cycle: String(c.cycle), latest: c.latest ? String(c.latest) : null, releaseDate: day(c.releaseDate),
    latestReleaseDate: day(c.latestReleaseDate), eol: c.eol, support: c.support, lts: c.lts,
  }));
}

// ---------- public: look up one technology (cached) ----------
export async function lookup({ source, package_id, eol_slug }, { refresh = false } = {}) {
  source = SOURCES[source] ? source : 'none';
  const id = String(package_id || '').trim();
  const slug = String(eol_slug || '').trim() || (source === 'endoflife' ? id : '');
  if (source === 'none' && !slug) return null;
  if (source !== 'none' && source !== 'endoflife' && source !== 'flutter' && !id) return { error: 'Add the package name to check versions online.' };
  const key = `${source}|${id}|${slug}`;
  const cached = get('SELECT data, fetched_at FROM tech_lookup_cache WHERE key = ?', key);
  if (cached && !refresh && Date.now() - Date.parse(cached.fetched_at.replace(' ', 'T') + 'Z') < TTL_MS) return JSON.parse(cached.data);

  const info = { source, package_id: id, eol_slug: slug || null, fetched_at: new Date().toISOString(), latest: null, releases: [], cycles: [], links: [] };
  const errors = [];
  if (source !== 'none' && source !== 'endoflife') {
    try { Object.assign(info, await fetchPackage(source, id)); } catch (e) { errors.push(`${SOURCES[source].label}: ${e.message}`); }
    const page = SOURCES[source].page(id); if (page) info.links.push({ label: SOURCES[source].label.split(' (')[0], url: page });
  }
  if (slug) {
    try {
      info.cycles = await fetchCycles(slug);
      if (!info.latest && info.cycles.length) {
        // runtimes / databases: newest cycle's latest patch is "latest"; recent cycles are the release list
        // some products (e.g. Android) list release lines without a separate patch number: use the line itself
        const lines = info.cycles.map(c => ({ version: c.latest || c.cycle, date: c.latestReleaseDate || c.releaseDate }));
        info.latest = lines[0] || null;
        info.releases = lines.slice(0, 8);
      }
    } catch (e) { errors.push(`endoflife.date: ${e.message}`); }
    info.links.push({ label: 'Support dates', url: `https://endoflife.date/${slug}` });
  }
  if (errors.length && !info.latest && !info.cycles.length) {
    const msg = /fetch failed|ENOTFOUND|timeout|aborted|ECONN/i.test(errors.join(' '))
      ? 'Could not reach the internet from the server. Versions will be checked again later.'
      : errors.join(' ');
    // keep showing older data if we have it
    if (cached) return { ...JSON.parse(cached.data), stale: true, error: msg };
    return { error: msg };
  }
  if (errors.length) info.warning = errors.join(' ');
  run(`INSERT INTO tech_lookup_cache(key, data, fetched_at) VALUES(?,?,datetime('now'))
       ON CONFLICT(key) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at`, key, JSON.stringify(info));
  return info;
}

// How the version a project uses compares with the latest release and its support dates.
export function assess(versionUsed, info) {
  const out = { status: 'unknown', label: 'Not checked', cycle: null };
  if (!info || info.error && !info.latest) return { ...out, label: info?.error ? 'Could not check' : 'Not checked' };
  const used = String(versionUsed || '').trim().replace(/^v/i, '');
  const today = todayISO();
  if (used && info.cycles?.length) {
    const cyc = info.cycles.find(c => used === c.cycle || used.startsWith(c.cycle + '.'))
      || info.cycles.find(c => parts(used)[0] === parts(c.cycle)[0]);
    if (cyc) {
      out.cycle = cyc;
      const eolDate = typeof cyc.eol === 'string' ? cyc.eol : null;
      if (cyc.eol === true || (eolDate && eolDate <= today)) return { ...out, status: 'eol', label: 'Out of support' };
    }
  }
  if (!used) return { ...out, status: 'unknown', label: 'Add the version you use' };
  if (!info.latest?.version) return { ...out, status: 'unknown', label: 'Latest version unknown' };
  const a = parts(used), b = parts(info.latest.version);
  if (cmpVersion(used, info.latest.version) >= 0) return { ...out, status: 'latest', label: 'Up to date' };
  if (a[0] !== b[0]) {
    const n = typeof b[0] === 'number' && typeof a[0] === 'number' ? b[0] - a[0] : 1;
    return { ...out, status: 'major', label: n === 1 ? '1 major version behind' : `${n} major versions behind` };
  }
  if ((a[1] ?? 0) !== (b[1] ?? 0)) return { ...out, status: 'minor', label: 'Newer minor version available' };
  return { ...out, status: 'patch', label: 'Newer patch available' };
}
