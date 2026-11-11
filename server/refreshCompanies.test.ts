import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// A throwaway database: db.ts opens JOBS_DB when it's first imported.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jt-refresh-'));
process.env.JOBS_DB = path.join(dir, 'test.db');
process.env.JOBS_NO_GEOCODE = '1';
const { db } = await import('./db.js');
const { refreshCompany } = await import('./refreshCompanies.js');
const { locationsOf } = await import('./companyLocations.js');

const page = (over: Record<string, unknown> = {}) => ({
  linkedin: 'https://www.linkedin.com/company/acme',
  name: 'Acme',
  description: 'We build things.',
  website: 'https://acme.example',
  industry: 'Software',
  company_size: '51-200 employees',
  headquarters: 'Cairo, Egypt',
  founded: '2010',
  logo_url: null,
  locations: [
    { label: 'Primary · Headquarters', address: 'Smart Village, Building B12, Giza 12577', city: 'Giza', country: 'Egypt', is_primary: true },
    { label: null, address: 'King Fahd Road, Riyadh 12271', city: 'Riyadh', country: 'Saudi Arabia', is_primary: false },
  ],
  ...over,
});

test('fills empty details, keeps what you typed, adds offices once', async () => {
  const id = Number(
    db.prepare(`INSERT INTO companies (name, linkedin, industry, city, country) VALUES ('Acme', 'https://www.linkedin.com/company/acme/', 'My own words', 'Cairo', 'Egypt')`).run()
      .lastInsertRowid,
  );
  db.prepare(`INSERT INTO company_locations (company_id, city, country, is_primary) VALUES (?, 'Cairo', 'Egypt', 1)`).run(id);
  const asked: string[] = [];
  const deps = {
    fetchCompany: async (u: string) => (asked.push(u), page() as never),
    findPage: async () => null,
  };
  const r = await refreshCompany(id, deps);
  assert.deepEqual(r, { status: 'updated', locations: 2 });
  assert.deepEqual(asked, ['https://www.linkedin.com/company/acme']);
  const c = db.prepare('SELECT * FROM companies WHERE id = ?').get(id) as Record<string, unknown>;
  assert.equal(c.industry, 'My own words');
  assert.equal(c.website, 'https://acme.example');
  assert.equal(c.founded, '2010');
  // The bare "Cairo" placeholder gives way to the real offices; the primary one is mirrored on the company.
  const locs = locationsOf(id);
  assert.deepEqual(
    locs.map((l) => [l.city, l.is_primary]),
    [
      ['Giza', 1],
      ['Riyadh', 0],
    ],
  );
  assert.equal(c.city, 'Giza');
  // Again: nothing new.
  assert.deepEqual(await refreshCompany(id, deps), { status: 'unchanged', locations: 0 });
});

test('a company with only a search link gets its page found first', async () => {
  const id = Number(
    db.prepare(`INSERT INTO companies (name, linkedin) VALUES ('Beta', 'https://www.linkedin.com/search/results/companies/?keywords=Beta')`).run().lastInsertRowid,
  );
  const linked: number[] = [];
  const r = await refreshCompany(id, {
    fetchCompany: async () => page({ name: 'Beta', locations: [] }) as never,
    findPage: async () => 'https://www.linkedin.com/company/beta',
    onNewLink: (x) => linked.push(x),
  });
  assert.equal(r.status, 'updated');
  assert.deepEqual(linked, [id]);
  assert.equal((db.prepare('SELECT linkedin FROM companies WHERE id = ?').get(id) as { linkedin: string }).linkedin, 'https://www.linkedin.com/company/beta');
});

test('no page found, or LinkedIn refusing, changes nothing', async () => {
  const id = Number(db.prepare(`INSERT INTO companies (name) VALUES ('Gamma')`).run().lastInsertRowid);
  assert.deepEqual(await refreshCompany(id, { fetchCompany: async () => page() as never, findPage: async () => null }), { status: 'no_page', locations: 0 });
  db.prepare(`UPDATE companies SET linkedin = 'https://www.linkedin.com/company/gamma' WHERE id = ?`).run(id);
  const r = await refreshCompany(id, {
    fetchCompany: async () => {
      throw new Error('LinkedIn did not answer (status 429).');
    },
    findPage: async () => null,
  });
  assert.equal(r.status, 'failed');
  assert.equal(locationsOf(id).length, 0);
});

test.after(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
