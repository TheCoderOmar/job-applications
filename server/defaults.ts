// The starter companies a fresh install begins with (seed/default-companies.json).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { replaceLocations, type LocationInput } from './companyLocations.js';

const FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'seed', 'default-companies.json');

const FIELDS = ['name', 'website', 'linkedin', 'wuzzuf', 'careers_url', 'industry', 'company_size', 'founded', 'headquarters', 'description', 'is_remote'] as const;

interface SeedCompany {
  name: string;
  locations?: LocationInput[];
  logo?: { mime: string; data: string };
  [k: string]: unknown;
}

export function readDefaults(file = FILE): SeedCompany[] {
  if (!fs.existsSync(file)) return [];
  const data = JSON.parse(fs.readFileSync(file, 'utf8')) as { companies?: SeedCompany[] };
  return (data.companies ?? []).filter((c) => typeof c?.name === 'string' && c.name.trim());
}

/**
 * Adds the starter companies you don't have yet (same name = already there), with their locations and logos.
 * Returns the ids added; logos that weren't bundled are fetched afterwards by the caller.
 */
export function loadDefaultCompanies(list = readDefaults()): number[] {
  const have = new Set((db.prepare('SELECT lower(name) AS n FROM companies').all() as { n: string }[]).map((r) => r.n));
  const insert = db.prepare(`INSERT INTO companies (${FIELDS.join(', ')}) VALUES (${FIELDS.map((f) => '@' + f).join(', ')})`);
  const logo = db.prepare(`INSERT OR REPLACE INTO company_logos (company_id, data, mime, status) VALUES (?, ?, ?, 'found')`);
  const added: number[] = [];
  db.transaction(() => {
    for (const c of list) {
      const name = c.name.trim();
      if (have.has(name.toLowerCase())) continue;
      have.add(name.toLowerCase());
      const row = Object.fromEntries(FIELDS.map((f) => [f, f === 'is_remote' ? (c.is_remote ? 1 : 0) : ((c[f] as string | undefined) ?? null)]));
      const id = Number(insert.run({ ...row, name }).lastInsertRowid);
      if (Array.isArray(c.locations) && c.locations.length) replaceLocations(id, c.locations);
      if (c.logo?.data && c.logo.mime) logo.run(id, Buffer.from(c.logo.data, 'base64'), c.logo.mime);
      added.push(id);
    }
  })();
  return added;
}

/** On a brand-new database (no companies yet), once: start with the starter companies. */
export function loadDefaultsOnFirstRun(): number[] {
  if (db.prepare(`SELECT 1 FROM settings WHERE key = 'default_companies_loaded'`).get()) return [];
  const empty = !db.prepare('SELECT 1 FROM companies LIMIT 1').get();
  const added = empty ? loadDefaultCompanies() : [];
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('default_companies_loaded', ?)`).run(String(added.length));
  return added;
}
