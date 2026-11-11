// Writes seed/default-companies.json from a Job Tracker database: the companies a fresh install starts with.
// Usage: npx tsx scripts/export-default-companies.ts [path/to/jobs.db]   (default: data/jobs.db, opened read-only)
// Kept: name, links, industry, size, founded, headquarters, about, remote flag, every location, and the logo.
// Left out: your notes, "I work here", openings scans, jobs, contacts.
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const MAX_LOGO = 150_000; // bigger logos are fetched again on first run instead

const dbPath = path.resolve(process.argv[2] ?? 'data/jobs.db');
const db = new Database(dbPath, { readonly: true, fileMustExist: true });

const companies = db
  .prepare(
    `SELECT id, name, website, linkedin, wuzzuf, careers_url, industry, company_size, founded, headquarters, description, is_remote
     FROM companies ORDER BY name COLLATE NOCASE`,
  )
  .all() as ({ id: number } & Record<string, unknown>)[];
const locations = db
  .prepare(
    `SELECT company_id, label, address, city, country, lat, lng, maps_link, precision, is_primary
     FROM company_locations ORDER BY company_id, is_primary DESC, sort_order, id`,
  )
  .all() as ({ company_id: number } & Record<string, unknown>)[];
const logos = new Map(
  (db.prepare(`SELECT company_id, data, mime FROM company_logos WHERE status = 'found' AND data IS NOT NULL`).all() as {
    company_id: number;
    data: Buffer;
    mime: string;
  }[]).map((l) => [l.company_id, l]),
);

const drop = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== '' && v !== undefined));

// Placeholder rows ("Company111") stay out; a name listed twice is kept once, the copy with the most filled in.
const filled = (c: Record<string, unknown>) =>
  Object.values(c).filter((v) => v !== null && v !== '').length + locations.filter((l) => l.company_id === c.id).length * 3 + (logos.has(c.id as number) ? 5 : 0);
const best = new Map<string, (typeof companies)[number]>();
for (const c of companies) {
  if (/^company\s*\d+$/i.test(String(c.name).trim())) continue;
  const key = String(c.name).trim().toLowerCase();
  const prev = best.get(key);
  if (!prev || filled(c) > filled(prev)) best.set(key, c);
}
const chosen = companies.filter((c) => best.get(String(c.name).trim().toLowerCase()) === c);

let logoCount = 0;
let locationCount = 0;
const out = chosen.map(({ id, ...c }) => {
  const logo = logos.get(id);
  const keepLogo = logo && logo.data.length <= MAX_LOGO;
  if (keepLogo) logoCount++;
  locationCount += locations.filter((l) => l.company_id === id).length;
  return {
    ...drop(c),
    is_remote: c.is_remote ? 1 : 0,
    locations: locations.filter((l) => l.company_id === id).map(({ company_id: _c, ...l }) => drop(l)),
    ...(keepLogo ? { logo: { mime: logo.mime, data: logo.data.toString('base64') } } : {}),
  };
});

const file = path.resolve('seed', 'default-companies.json');
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify({ version: 1, companies: out }, null, 1) + '\n');
console.log(`Wrote ${out.length} companies (${locationCount} locations, ${logoCount} logos) to ${path.relative(process.cwd(), file)}`);
