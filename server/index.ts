import express, { type Request, type Response, type NextFunction } from 'express';
import { backfillLocations, db, seedStages } from './db.js';
import {
  addLocations, geocodeState, locationsOf, primaryFromCompany, queueGeocoding, replaceLocations, resolveLinks, withLocations,
  type LocationInput,
} from './companyLocations.js';
import { mapsSearchLink } from './geocode.js';
import { loadDefaultCompanies, loadDefaultsOnFirstRun, readDefaults } from './defaults.js';
import { applyUpdate, blockedReason, checkForUpdate, type UpdateStatus } from './update.js';
import { refreshCompanies, refreshState } from './refreshCompanies.js';
import { parseLocationCard, parseLocationsFromHtml, tidyLocations, type ParsedLocation } from './locations.js';
import { cleanTab, guessPostCompany, linkedInKind, type TabCompany, type TabPost, type TabProfile } from './linkedinTab.js';
import { resolveMapsLink } from './mapsLink.js';
import {
  fetchLinkedInCompany, fetchLinkedInPost, fetchLinkedInProfile, findLogo, isLinkedInPost, parseCompanyPage, parsePostPage, parseProfilePage,
  canonicalProfileUrl, type LinkedInCompany, type LinkedInPost, type LinkedInProfile,
} from './linkedin.js';
import { buildSankey, conversationStats, normalizeCompany as normalizeName, parseLinkedInConnections, profileKey, sameCompany, type SankeyStage } from './contacts.js';
import { canonicalWuzzufCompany, cleanJobUrl, fetchWorkableSearchJob, jobBoard, keepPage, keptPage, needsExtension, parseJobPage } from './jobpages.js';
import { fetchLinkedInJob, fetchWorkableJob, workableJobRef, findLinkedInCompanyPage, linkedInCompanyId, linkedInJobId, linkedInOpenings, websiteOpenings, type FoundOpening } from './openings.js';
import { canonicalCompanyUrl } from './linkedin.js';
import { contentDisposition, defaultCvLabel, parseCvFile } from './cvs.js';
import { parseQuizFile, shuffle } from './quiz.js';

const app = express();
app.use(express.json({ limit: '25mb' }));

type Row = Record<string, unknown>;

const wrap =
  (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(fn(req, res)).catch(next);

const today = () => new Date().toISOString().slice(0, 10);
const emptyToNull = (v: unknown) => (v === '' || v === undefined ? null : v);
const numOrNull = (v: unknown) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function firstStageId(): number {
  return (db.prepare('SELECT id FROM stages ORDER BY sort_order, id LIMIT 1').get() as { id: number }).id;
}

/** "Applied" = moved past the first stage in the pipeline. */
function isPastFirstStage(stageId: number) {
  return stageId !== firstStageId();
}

// ---------- Companies ----------

const COMPANY_FIELDS = [
  'name', 'website', 'linkedin', 'careers_url', 'industry', 'company_size', 'founded', 'headquarters', 'notes', 'description',
  'is_remote', 'is_current', 'address', 'city', 'country', 'lat', 'lng', 'maps_link', 'wuzzuf',
] as const;

/** Accepts booleans, numbers, and CSV-style strings ("1", "true", "yes"). */
const flag = (v: unknown) => (typeof v === 'string' ? /^(1|true|yes|y)$/i.test(v.trim()) : !!v) ? 1 : 0;

async function normalizeCompany(body: Row) {
  const c: Row = {};
  for (const f of COMPANY_FIELDS) c[f] = emptyToNull(body[f]);
  c.name = String(body.name ?? '').trim();
  c.is_remote = flag(body.is_remote);
  c.is_current = flag(body.is_current);
  c.lat = numOrNull(c.lat);
  c.lng = numOrNull(c.lng);
  // Any Wuzzuf company link is kept in its short form; something that isn't one is kept as typed.
  if (typeof c.wuzzuf === 'string') c.wuzzuf = canonicalWuzzufCompany(c.wuzzuf) ?? c.wuzzuf.trim();
  if ((c.lat === null || c.lng === null) && typeof c.maps_link === 'string') {
    const { coords } = await resolveMapsLink(c.maps_link).catch(() => ({ coords: null }));
    if (coords) Object.assign(c, coords);
  }
  return c;
}

const companySelect = `
  SELECT c.*, COUNT(j.id) AS job_count,
         (SELECT CASE WHEN l.status = 'found' THEN l.fetched_at END FROM company_logos l WHERE l.company_id = c.id) AS logo_at
  FROM companies c LEFT JOIN jobs j ON j.company_id = c.id`;

// ---------- Company logos ----------
// Fetched one at a time in the background (LinkedIn page first, then the company website) and stored in the DB.

const logoQueue: number[] = [];
const logoState = { running: false, done: 0, found: 0, total: 0 };

function queueLogos(ids: number[]) {
  for (const id of ids) if (!logoQueue.includes(id)) (logoQueue.push(id), logoState.total++);
  if (!logoState.running) void runLogoQueue();
}

async function runLogoQueue() {
  logoState.running = true;
  while (logoQueue.length) {
    const id = logoQueue.shift()!;
    const c = db.prepare('SELECT linkedin, website FROM companies WHERE id = ?').get(id) as
      | { linkedin: string | null; website: string | null }
      | undefined;
    if (c) {
      const logo = await findLogo(c).catch(() => null);
      // The company may have been deleted while its logo was being fetched: then there's nothing to save.
      db.prepare(
        `INSERT INTO company_logos (company_id, data, mime, status, fetched_at)
         SELECT ?, ?, ?, ?, datetime('now') WHERE EXISTS (SELECT 1 FROM companies WHERE id = ?)
         ON CONFLICT(company_id) DO UPDATE SET data = excluded.data, mime = excluded.mime, status = excluded.status, fetched_at = excluded.fetched_at`,
      ).run(id, logo?.data ?? null, logo?.mime ?? null, logo ? 'found' : 'none', id);
      if (logo) logoState.found++;
      // Be gentle with LinkedIn.
      if (logoQueue.length) await new Promise((r) => setTimeout(r, 1200));
    }
    logoState.done++;
  }
  logoState.running = false;
}

const missingLogoIds = () =>
  (
    db
      .prepare(
        `SELECT c.id FROM companies c WHERE (c.linkedin IS NOT NULL OR c.website IS NOT NULL)
           AND NOT EXISTS (SELECT 1 FROM company_logos l WHERE l.company_id = c.id)`,
      )
      .all() as { id: number }[]
  ).map((r) => r.id);

app.get('/api/logos/status', (_req, res) => {
  res.json({ ...logoState, missing: missingLogoIds().length });
});

app.post('/api/logos/fetch-missing', (_req, res) => {
  const ids = missingLogoIds();
  if (!logoState.running) Object.assign(logoState, { done: 0, found: 0, total: 0 });
  queueLogos(ids);
  res.json({ ...logoState, missing: ids.length });
});

app.get('/api/companies/:id/logo', (req, res) => {
  const row = db.prepare(`SELECT data, mime FROM company_logos WHERE company_id = ? AND status = 'found'`).get(req.params.id) as
    | { data: Buffer; mime: string }
    | undefined;
  if (!row) return res.status(404).end();
  res.setHeader('Content-Type', row.mime);
  // The URL carries ?v=<fetched_at>, so a new logo gets a new URL.
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(row.data);
});

/** Look again (e.g. after the LinkedIn link changed). */
app.post('/api/companies/:id/logo/refresh', (req, res) => {
  db.prepare('DELETE FROM company_logos WHERE company_id = ?').run(req.params.id);
  queueLogos([Number(req.params.id)]);
  res.status(202).json(logoState);
});

/** Your own image, as a data: URL. */
app.put('/api/companies/:id/logo', (req, res) => {
  const m = /^data:(image\/[\w.+-]+);base64,(.+)$/.exec(String(req.body.dataUrl ?? ''));
  if (!m) return res.status(400).json({ error: 'Pick an image file.' });
  const data = Buffer.from(m[2], 'base64');
  if (data.length > 2_000_000) return res.status(413).json({ error: 'Image is over 2 MB.' });
  db.prepare(
    `INSERT INTO company_logos (company_id, data, mime, status, fetched_at) VALUES (?, ?, ?, 'found', datetime('now'))
     ON CONFLICT(company_id) DO UPDATE SET data = excluded.data, mime = excluded.mime, status = 'found', fetched_at = excluded.fetched_at`,
  ).run(req.params.id, data, m[1]);
  res.json(db.prepare(`${companySelect} WHERE c.id = ? GROUP BY c.id`).get(req.params.id));
});

app.delete('/api/companies/:id/logo', (req, res) => {
  db.prepare(
    `INSERT INTO company_logos (company_id, data, mime, status) VALUES (?, NULL, NULL, 'none')
     ON CONFLICT(company_id) DO UPDATE SET data = NULL, mime = NULL, status = 'none', fetched_at = datetime('now')`,
  ).run(req.params.id);
  res.status(204).end();
});

// ---------- LinkedIn company lookup ----------

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Fields of `b` that have a value win over `a`'s. */
const overlay = <T extends object>(a: T, b: Partial<T> | null | undefined): T => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b ?? {})) if (v !== null && v !== undefined && v !== '') (out as Record<string, unknown>)[k] = v;
  return out;
};

/**
 * A LinkedIn company page → its details and offices, plus the company if you already have it.
 * With `page` (sent by the extension from your logged-in tab) the offices come from the tab's "Locations" cards;
 * the public page (read as a link-preview bot) fills in the rest, or everything when there's no tab.
 */
app.post(
  '/api/linkedin/company',
  wrap(async (req, res) => {
    const url = String(req.body.url ?? '');
    const kept = req.body.page ? keptPage(String(req.body.page)) : null;
    let data: LinkedInCompany | null = null;
    let error: Error | null = null;
    try {
      data = await fetchLinkedInCompany(url);
    } catch (e) {
      error = e as Error;
    }
    if (kept) {
      const canonical = canonicalCompanyUrl(kept.url) ?? canonicalCompanyUrl(url) ?? url;
      const tab = cleanTab<TabCompany>(kept.data);
      const fromHtml = parseCompanyPage(kept.html, canonical);
      const cards = tidyLocations((tab.cards ?? []).map((c) => parseLocationCard(Array.isArray(c?.lines) ? c.lines.map(String) : [], c?.heading)));
      const locations = cards.length ? cards : fromHtml.locations.length ? fromHtml.locations : (data?.locations ?? []);
      data = { ...overlay(fromHtml, data), name: data?.name ?? tab.name ?? fromHtml.name, linkedin: canonical, locations };
    }
    if (!data?.name) return res.status(422).json({ error: error?.message ?? 'No company name found on that page.' });
    const existing = db
      .prepare(
        `SELECT id, name, (SELECT COUNT(*) FROM company_locations l WHERE l.company_id = c.id) AS location_count
         FROM companies c WHERE linkedin = ? OR lower(name) = lower(?)`,
      )
      .get(data.linkedin, data.name);
    res.json({ ...data, existing: existing ?? null });
  }),
);

app.get('/api/companies', (_req, res) => {
  res.json(withLocations(db.prepare(`${companySelect} GROUP BY c.id ORDER BY c.name COLLATE NOCASE`).all() as { id: number }[]));
});

/** One company with its locations. */
const companyOut = (id: number | string | bigint) => {
  const row = db.prepare(`${companySelect} WHERE c.id = ? GROUP BY c.id`).get(id) as Row | undefined;
  return row ? { ...row, locations: locationsOf(Number(id)) } : undefined;
};

/** Saves the locations list sent with a company (or, without one, its single address as the primary location). */
async function saveCompanyLocations(id: number | string, body: Row) {
  if (Array.isArray(body.locations)) replaceLocations(id, await resolveLinks(body.locations as LocationInput[]));
  else primaryFromCompany(id);
  queueGeocoding();
}

app.get('/api/companies/:id', (req, res) => {
  const row = companyOut(req.params.id);
  if (!row) return res.status(404).json({ error: 'Company not found' });
  res.json(row);
});

/** A company's Wuzzuf page, found on a Wuzzuf job: saved only when the company has none yet. */
app.patch('/api/companies/:id/wuzzuf', (req, res) => {
  const link = canonicalWuzzufCompany(String(req.body.url ?? ''));
  if (!link) return res.status(400).json({ error: 'That is not a Wuzzuf company link (wuzzuf.net/jobs/careers/…).' });
  db.prepare(`UPDATE companies SET wuzzuf = ? WHERE id = ? AND trim(IFNULL(wuzzuf, '')) = ''`).run(link, req.params.id);
  res.json(companyOut(req.params.id) ?? null);
});

/** Adds offices found on LinkedIn that the company doesn't have yet; they're pinned in the background. */
app.post('/api/companies/:id/locations', (req, res) => {
  if (!db.prepare('SELECT 1 FROM companies WHERE id = ?').get(req.params.id)) return res.status(404).json({ error: 'Company not found' });
  const found = (Array.isArray(req.body.locations) ? req.body.locations : []) as ParsedLocation[];
  const added = addLocations(req.params.id, found);
  res.json({ added, company: companyOut(req.params.id) });
});

// ---------- Updates from GitHub ----------
// Checked a few seconds after start and every 6 hours (never when JOBS_NO_UPDATE_CHECK is set, e.g. in tests).

let update: UpdateStatus | null = null;
const refreshUpdate = async () => {
  if (process.env.JOBS_NO_UPDATE_CHECK) return;
  update = await checkForUpdate();
};
setTimeout(() => void refreshUpdate(), 5000);
setInterval(() => void refreshUpdate(), 6 * 60 * 60 * 1000);

app.get(
  '/api/update',
  wrap(async (req, res) => {
    if (req.query.refresh || !update) await refreshUpdate();
    const s = update ?? (await checkForUpdate(undefined, false));
    res.json({ ...s, blocked: s.behind ? blockedReason(s) : null });
  }),
);

/** Fast-forwards to the latest version. The dev server then restarts by itself on the changed files. */
app.post(
  '/api/update',
  wrap(async (_req, res) => {
    try {
      const r = await applyUpdate();
      update = await checkForUpdate(undefined, false);
      res.json(r);
    } catch (e) {
      res.status(409).json({ error: (e as Error).message });
    }
  }),
);

/** The starter companies (seed/default-companies.json): how many there are, and adding the ones you don't have. */
app.get('/api/default-companies', (_req, res) => {
  const list = readDefaults();
  const have = new Set((db.prepare('SELECT lower(name) AS n FROM companies').all() as { n: string }[]).map((r) => r.n));
  res.json({ total: list.length, missing: list.filter((c) => !have.has(c.name.trim().toLowerCase())).length });
});
app.post('/api/default-companies', (_req, res) => {
  const added = loadDefaultCompanies();
  queueLogos(missingLogoIds());
  res.json({ added: added.length });
});

/**
 * Refresh from LinkedIn: every company (or `ids`) re-read from its LinkedIn page in the background;
 * empty details are filled and offices it doesn't have yet are added (and pinned). Nothing you typed is overwritten.
 */
app.get('/api/refresh-status', (_req, res) => res.json(refreshState));
app.post('/api/refresh-companies', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? (req.body.ids as unknown[]).map(Number).filter(Boolean) : undefined;
  const exact = (x: string, y: string) => {
    const [p, q] = [normalizeName(x), normalizeName(y)];
    return !!p && (p === q || p.replace(/ /g, '') === q.replace(/ /g, ''));
  };
  refreshCompanies(
    {
      fetchCompany: fetchLinkedInCompany,
      // A LinkedIn search link or no link: find the real page by exact name, like the openings scan does.
      findPage: (name, country) => findLinkedInCompanyPage(name, country, exact),
      onNewLink: (id) => {
        const logo = db.prepare(`SELECT status FROM company_logos WHERE company_id = ?`).get(id) as { status: string } | undefined;
        if (!logo || logo.status === 'none') {
          db.prepare('DELETE FROM company_logos WHERE company_id = ?').run(id);
          queueLogos([id]);
        }
      },
    },
    ids,
  );
  res.json(refreshState);
});

/** Pinning progress, and a Google Maps search link for checking a location by hand. */
app.get('/api/geocode/status', (_req, res) => {
  const pending = (db
    .prepare(`SELECT COUNT(*) AS n FROM company_locations WHERE lat IS NULL AND geocode_status IS NULL AND trim(IFNULL(address, '')) != ''`)
    .get() as { n: number }).n;
  res.json({ ...geocodeState, pending });
});
app.post('/api/geocode/link', (req, res) => {
  res.json({ link: mapsSearchLink({ address: req.body.address ?? null, city: req.body.city ?? null, country: req.body.country ?? null }) });
});

/** Optional Google Maps key for exact pins; without one, OpenStreetMap is used. The key itself is never sent back. */
app.get('/api/settings/google-key', (_req, res) => {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'google_maps_key'`).get() as { value: string } | undefined;
  res.json({ set: !!row?.value, hint: row?.value ? `…${row.value.slice(-4)}` : null });
});
app.put('/api/settings/google-key', (req, res) => {
  const key = String(req.body.key ?? '').trim();
  if (key) db.prepare(`INSERT INTO settings (key, value) VALUES ('google_maps_key', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key);
  else db.prepare(`DELETE FROM settings WHERE key = 'google_maps_key'`).run();
  // Locations OpenStreetMap couldn't find get another try with Google.
  if (key) db.prepare(`UPDATE company_locations SET geocode_status = NULL WHERE geocode_status = 'not_found'`).run();
  queueGeocoding();
  res.json({ set: !!key, hint: key ? `…${key.slice(-4)}` : null });
});

app.post(
  '/api/companies',
  wrap(async (req, res) => {
    const c = await normalizeCompany(req.body);
    if (!c.name) return res.status(400).json({ error: 'Name is required' });
    const cols = COMPANY_FIELDS.join(', ');
    const params = COMPANY_FIELDS.map((f) => '@' + f).join(', ');
    const info = db.prepare(`INSERT INTO companies (${cols}) VALUES (${params})`).run(c);
    const id = Number(info.lastInsertRowid);
    await saveCompanyLocations(id, req.body);
    if (c.linkedin || c.website) queueLogos([id]);
    res.status(201).json(companyOut(id));
  }),
);

app.put(
  '/api/companies/:id',
  wrap(async (req, res) => {
    const c = await normalizeCompany(req.body);
    if (!c.name) return res.status(400).json({ error: 'Name is required' });
    const before = db.prepare('SELECT linkedin, website FROM companies WHERE id = ?').get(req.params.id) as
      | { linkedin: string | null; website: string | null }
      | undefined;
    const sets = COMPANY_FIELDS.map((f) => `${f} = @${f}`).join(', ');
    const info = db.prepare(`UPDATE companies SET ${sets} WHERE id = @id`).run({ ...c, id: req.params.id });
    if (!info.changes) return res.status(404).json({ error: 'Company not found' });
    const linksChanged = before && (before.linkedin !== c.linkedin || before.website !== c.website);
    const custom = db.prepare(`SELECT status FROM company_logos WHERE company_id = ?`).get(req.params.id) as { status: string } | undefined;
    if ((c.linkedin || c.website) && (!custom || (linksChanged && custom.status === 'none'))) {
      db.prepare('DELETE FROM company_logos WHERE company_id = ?').run(req.params.id);
      queueLogos([Number(req.params.id)]);
    }
    await saveCompanyLocations(req.params.id, req.body);
    res.json(companyOut(req.params.id));
  }),
);

/** A company by name (any case), created with just the name when it isn't there yet. */
function findOrCreateCompany(name: string): number {
  const found = db.prepare('SELECT id FROM companies WHERE lower(name) = lower(?)').get(name) as { id: number } | undefined;
  if (found) return found.id;
  return Number(db.prepare('INSERT INTO companies (name) VALUES (?)').run(name).lastInsertRowid);
}

app.delete('/api/companies/:id', (req, res) => {
  db.prepare('DELETE FROM companies WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

// ---------- Jobs ----------

const JOB_FIELDS = [
  'company_id', 'title', 'description', 'url', 'location_type', 'salary', 'stage_id', 'applied_date', 'notes',
  'apply_channel', 'apply_contact', 'cv_id',
] as const;

const CHANNELS = ['email', 'website', 'linkedin', 'wuzzuf', 'other'];
const MAX_REFERRERS = 3;

const jobSelect = `
  SELECT j.*, (SELECT COUNT(*) FROM job_referrers r WHERE r.job_id = j.id) AS referrer_count,
         (SELECT s2.name FROM stage_history h2 JOIN stages s2 ON s2.id = h2.stage_id
           WHERE h2.job_id = j.id AND s2.kind != 'closed_lost' ORDER BY s2.sort_order DESC LIMIT 1) AS reached_stage,
         (SELECT CASE WHEN l.status = 'found' THEN l.fetched_at END FROM company_logos l WHERE l.company_id = j.company_id) AS logo_at,
         c.name AS company_name, s.name AS stage_name, s.color AS stage_color, s.kind AS stage_kind, s.sort_order AS stage_order,
         cv.label AS cv_label
  FROM jobs j
  JOIN companies c ON c.id = j.company_id
  JOIN stages s ON s.id = j.stage_id
  LEFT JOIN cvs cv ON cv.id = j.cv_id`;

function normalizeJob(body: Row) {
  const j: Row = {};
  for (const f of JOB_FIELDS) j[f] = emptyToNull(body[f]);
  j.title = String(body.title ?? '').trim();
  j.company_id = Number(body.company_id);
  j.stage_id = body.stage_id ? Number(body.stage_id) : firstStageId();
  if (!['onsite', 'hybrid', 'remote', 'unknown'].includes(String(j.location_type))) j.location_type = 'unknown';
  if (!CHANNELS.includes(String(j.apply_channel))) j.apply_channel = null;
  j.cv_id = numOrNull(j.cv_id);
  if (j.cv_id !== null && !db.prepare('SELECT 1 FROM cvs WHERE id = ?').get(j.cv_id)) j.cv_id = null;
  // "Applied" means past the first stage: a job still there (Saved) has no applied date.
  if (!isPastFirstStage(j.stage_id as number)) j.applied_date = null;
  else if (!j.applied_date) j.applied_date = today();
  return j;
}

/**
 * Keeps the "Applied" step on the same day as the job's applied date: the first step past the
 * first stage gets that date. Called when a job is created or its applied date is edited.
 */
function alignAppliedStep(jobId: number | bigint | string) {
  const job = db.prepare('SELECT applied_date FROM jobs WHERE id = ?').get(jobId) as { applied_date: string | null } | undefined;
  if (!job?.applied_date || !/^\d{4}-\d{2}-\d{2}$/.test(job.applied_date)) return;
  const step = db
    .prepare(`SELECT id, date(changed_at) AS day FROM stage_history WHERE job_id = ? AND stage_id != ? ORDER BY changed_at, id LIMIT 1`)
    .get(jobId, firstStageId()) as { id: number; day: string } | undefined;
  if (step && step.day !== job.applied_date)
    db.prepare('UPDATE stage_history SET changed_at = ? WHERE id = ?').run(`${job.applied_date} 12:00:00`, step.id);
}

// ---------- Job descriptions from LinkedIn ----------

/** A LinkedIn job's description as saved on an application, with the posting's details at the end. */
function descriptionFrom(job: { description: string | null; details: Record<string, string> }) {
  const details = Object.entries(job.details)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  return [job.description, details].filter(Boolean).join('\n\n') || null;
}

/** A recruiter's post as a job description: who posted it and when, then the post itself. */
function postDescription(p: LinkedInPost) {
  const when = p.posted_at ? new Date(p.posted_at).toISOString().slice(0, 10).split('-').reverse().join('/') : null;
  const by = [p.author && `Posted by ${p.author}`, when && `on ${when}`].filter(Boolean).join(' ');
  return [by && `${by} (LinkedIn post)`, p.text].filter(Boolean).join('\n\n');
}

const fillQueue: number[] = [];
let filling = false;

/**
 * Applications with a LinkedIn job link (posting link or "applied via" link) and no description get
 * the description from LinkedIn in the background. The work type is filled in too if it was unknown.
 */
function queueDescriptionFill(jobId: number | bigint | string) {
  const id = Number(jobId);
  if (!fillQueue.includes(id)) fillQueue.push(id);
  if (filling) return;
  filling = true;
  void (async () => {
    while (fillQueue.length) {
      const next = fillQueue.shift()!;
      const j = db.prepare('SELECT id, url, apply_contact, description, location_type FROM jobs WHERE id = ?').get(next) as
        | { id: number; url: string | null; apply_contact: string | null; description: string | null; location_type: string }
        | undefined;
      if (!j || j.description?.trim()) continue;
      const post = [j.url, j.apply_contact].find((u) => isLinkedInPost(u));
      if (post && ![j.url, j.apply_contact].some((u) => linkedInJobId(u))) {
        try {
          const p = await fetchLinkedInPost(post!);
          db.prepare(`UPDATE jobs SET description = COALESCE(NULLIF(description, ''), ?) WHERE id = ?`).run(postDescription(p), j.id);
        } catch (e) {
          console.warn(`No LinkedIn post text for job ${j.id}: ${(e as Error).message}`);
        }
        continue;
      }
      const workable = [j.url, j.apply_contact].find((u) => workableJobRef(u));
      const link = linkedInJobId(j.url) ? j.url : linkedInJobId(j.apply_contact) ? j.apply_contact : (workable ?? null);
      if (!link) continue;
      try {
        const li = workable && link === workable ? await fetchWorkableJob(link) : await fetchLinkedInJob(link);
        db.prepare(
          `UPDATE jobs SET description = COALESCE(NULLIF(description, ''), ?),
             location_type = CASE WHEN location_type = 'unknown' AND ? IS NOT NULL THEN ? ELSE location_type END,
             url = COALESCE(NULLIF(url, ''), ?)
           WHERE id = ?`,
        ).run(descriptionFrom(li), li.workplace, li.workplace, link, j.id);
        if (li.closed) ghostIfClosed(j.id);
      } catch (e) {
        console.warn(`No LinkedIn description for job ${j.id}: ${(e as Error).message}`);
      }
      if (fillQueue.length) await new Promise((r) => setTimeout(r, 1500));
    }
    filling = false;
  })();
}

// ---------- Closed LinkedIn postings → Ghosted ----------

const ghostedStageId = () =>
  (db.prepare(`SELECT id FROM stages WHERE lower(name) = 'ghosted' ORDER BY sort_order LIMIT 1`).get() as { id: number } | undefined)?.id ?? null;

/**
 * An application still waiting (applied, in an open stage) whose LinkedIn posting now says
 * "No longer accepting applications" moves to Ghosted, not Rejected: nobody turned you down.
 * Applications already closed (rejected, offer, …) are left alone.
 */
function ghostIfClosed(jobId: number) {
  const ghosted = ghostedStageId();
  const row = db
    .prepare(`SELECT s.kind FROM jobs j JOIN stages s ON s.id = j.stage_id WHERE j.id = ? AND j.applied_date IS NOT NULL`)
    .get(jobId) as { kind: string } | undefined;
  if (!ghosted || row?.kind !== 'active') return false;
  db.transaction(() => {
    db.prepare(`INSERT INTO stage_history (job_id, stage_id, changed_at) VALUES (?, ?, datetime('now'))`).run(jobId, ghosted);
    syncFromHistory(jobId);
  })();
  return true;
}

/** Days with no new step after which an open application counts as ghosted. */
const GHOST_AFTER_DAYS = 60;

/**
 * Applied, still in an open stage, and no new step for GHOST_AFTER_DAYS → Ghosted (a step dated today).
 * Saved jobs you never applied to, and closed ones (rejected, offer, …), are left alone.
 */
function ghostStaleApplications() {
  const ghosted = ghostedStageId();
  if (!ghosted) return 0;
  const stale = db
    .prepare(
      `SELECT j.id FROM jobs j JOIN stages s ON s.id = j.stage_id
       WHERE s.kind = 'active' AND j.stage_id != @first AND j.applied_date IS NOT NULL
         AND (SELECT MAX(h.changed_at) FROM stage_history h WHERE h.job_id = j.id) <= datetime('now', @age)
         AND j.applied_date <= date('now', @age)`,
    )
    .all({ first: firstStageId(), age: `-${GHOST_AFTER_DAYS} days` }) as { id: number }[];
  for (const { id } of stale) {
    db.transaction(() => {
      db.prepare(`INSERT INTO stage_history (job_id, stage_id, changed_at) VALUES (?, ?, datetime('now'))`).run(id, ghosted);
      syncFromHistory(id);
    })();
  }
  if (stale.length) console.log(`${stale.length} application(s) with no update for ${GHOST_AFTER_DAYS} days moved to Ghosted.`);
  return stale.length;
}

let checkingPostings = false;
async function checkClosedPostings() {
  if (checkingPostings) return;
  checkingPostings = true;
  try {
    const rows = db
      .prepare(
        `SELECT j.id, j.url, j.apply_contact FROM jobs j JOIN stages s ON s.id = j.stage_id
         WHERE s.kind = 'active' AND j.applied_date IS NOT NULL
           AND (j.url LIKE '%linkedin.com%' OR j.apply_contact LIKE '%linkedin.com%')`,
      )
      .all() as { id: number; url: string | null; apply_contact: string | null }[];
    for (const r of rows) {
      const link = linkedInJobId(r.url) ? r.url : linkedInJobId(r.apply_contact) ? r.apply_contact : null;
      if (!link) continue;
      try {
        const li = await fetchLinkedInJob(link);
        if (li.closed && ghostIfClosed(r.id)) console.log(`Job ${r.id}: LinkedIn posting closed, moved to Ghosted.`);
      } catch {
        /* try again next time */
      }
      await new Promise((res) => setTimeout(res, 1500));
    }
  } finally {
    checkingPostings = false;
  }
}

async function importJob(url: string, pageId: string | null) {
  if (pageId) {
    const page = keptPage(pageId);
    if (!page) throw new Error('The page from the extension has expired. Click the extension on the job again.');
    return parseJobPage(page.html, page.url);
  }
  const board = jobBoard(url);
  if (board === 'workable') return fetchWorkableSearchJob(url);
  if (board) throw new Error(needsExtension(board));
  if (workableJobRef(url)) return fetchWorkableJob(url);
  return { ...(await fetchLinkedInJob(url)), source: 'linkedin' as const };
}

/** From the browser extension: an Indeed/Wuzzuf/Workable job page as the browser sees it, kept until its window imports it. */
app.post('/api/import/page', (req, res) => {
  const url = String(req.body.url ?? '');
  const html = String(req.body.html ?? '');
  // LinkedIn company pages, profiles and posts come with what the extension read from them (`data`).
  if (linkedInKind(url)) return res.json({ page: keepPage(url, html, Date.now(), req.body.data ?? null), url });
  if (!jobBoard(url) || !html) return res.status(400).json({ error: 'Send the job page link and its HTML.' });
  res.json({ page: keepPage(url, html), url: cleanJobUrl(url) });
});

/**
 * Used by the job form: a LinkedIn, Workable, Indeed or Wuzzuf job link → title, company, description, work type.
 * Indeed and Wuzzuf need `page` (sent by the extension): they block the app from fetching them.
 */
app.post(
  '/api/import/job',
  wrap(async (req, res) => {
    const url = String(req.body.url ?? '');
    try {
      const job = await importJob(url, req.body.page ? String(req.body.page) : null);
      res.json({ ...job, description: descriptionFrom(job) });
    } catch (e) {
      res.status(422).json({ error: (e as Error).message });
    }
  }),
);

/** Used by the job form: a LinkedIn post link → the post as a job description. */
app.post(
  '/api/linkedin/post',
  wrap(async (req, res) => {
    // From the extension: the post as your logged-in tab showed it (author's page and headline included).
    const kept = req.body.page ? keptPage(String(req.body.page)) : null;
    const tab = kept ? cleanTab<TabPost>(kept.data) : {};
    let p: LinkedInPost | null = null;
    let error: Error | null = null;
    try {
      p = await fetchLinkedInPost(String(req.body.url ?? ''));
    } catch (e) {
      error = e as Error;
    }
    if (kept && !p?.text) p = overlay(parsePostPage(kept.html), p);
    if (p && tab.text && !p.text) p.text = tab.text;
    if (p && tab.author && !p.author) p.author = tab.author;
    if (p && tab.author_url) p.author_url = tab.author_url;
    if (!p?.text && !tab.text) return res.status(422).json({ error: error?.message ?? 'No post text found.' });
    p ??= { text: tab.text ?? null, author: tab.author ?? null, author_url: tab.author_url ?? null, posted_at: null };
    const companies = db.prepare('SELECT id, name, linkedin FROM companies').all() as { id: number; name: string; linkedin: string | null }[];
    const company_guess = guessPostCompany({ ...p, headline: tab.headline ?? null }, companies);
    res.json({ ...p, author_headline: tab.headline ?? null, description: postDescription(p), company_guess });
  }),
);

/** Used by the job form: paste a LinkedIn job link, get its details back. */
app.post(
  '/api/linkedin/job',
  wrap(async (req, res) => {
    try {
      const li = await fetchLinkedInJob(String(req.body.url ?? ''));
      res.json({ ...li, description: descriptionFrom(li) });
    } catch (e) {
      res.status(422).json({ error: (e as Error).message });
    }
  }),
);

/** Reads `referrer_ids` from a request body: up to 3 distinct contact ids, undefined when not sent, or an error message. */
function referrerIds(body: Row): number[] | undefined | string {
  if (!('referrer_ids' in body)) return undefined;
  const raw = Array.isArray(body.referrer_ids) ? body.referrer_ids : [];
  const ids = [...new Set(raw.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (ids.length > MAX_REFERRERS) return `At most ${MAX_REFERRERS} referrers per application.`;
  const known = ids.filter((id) => db.prepare('SELECT 1 FROM contacts WHERE id = ?').get(id));
  if (known.length !== ids.length) return 'One of the referrers no longer exists.';
  return ids;
}

function saveReferrers(jobId: number | bigint, ids: number[]) {
  db.prepare('DELETE FROM job_referrers WHERE job_id = ?').run(jobId);
  const insert = db.prepare('INSERT INTO job_referrers (job_id, contact_id, slot) VALUES (?, ?, ?)');
  ids.forEach((id, i) => insert.run(jobId, id, i + 1));
  // Someone who referred you is "Referred", unless you already set where you stand with them.
  if (ids.length)
    db.prepare(`UPDATE contacts SET status = 'referred' WHERE status IS NULL AND id IN (${ids.map(() => '?').join(',')})`).run(...ids);
}

const referrersOf = (jobId: number | string) =>
  db
    .prepare(`SELECT c.* FROM job_referrers r JOIN contacts c ON c.id = r.contact_id WHERE r.job_id = ? ORDER BY r.slot`)
    .all(jobId);

/** WHERE clauses shared by the jobs list and the Sankey: how you applied and whether someone referred you. */
function channelFilters(query: Request['query'], where: string[], params: Row) {
  const { channel, referred } = query;
  if (channel === 'none') where.push('j.apply_channel IS NULL');
  else if (channel) (where.push('j.apply_channel = @channel'), (params.channel = channel));
  if (referred === '1') where.push('EXISTS (SELECT 1 FROM job_referrers r WHERE r.job_id = j.id)');
  if (referred === '0') where.push('NOT EXISTS (SELECT 1 FROM job_referrers r WHERE r.job_id = j.id)');
}

app.get('/api/jobs', (req, res) => {
  const where: string[] = [];
  const params: Row = {};
  const { company_id, stage_id, applied, q, contact_id, starred } = req.query;
  if (starred === '1') where.push('j.starred = 1');
  channelFilters(req.query, where, params);
  if (contact_id) {
    where.push('EXISTS (SELECT 1 FROM job_referrers r WHERE r.job_id = j.id AND r.contact_id = @contact_id)');
    params.contact_id = contact_id;
  }
  if (company_id) (where.push('j.company_id = @company_id'), (params.company_id = company_id));
  if (stage_id) (where.push('j.stage_id = @stage_id'), (params.stage_id = stage_id));
  if (applied === '1') where.push('j.applied_date IS NOT NULL');
  if (q) {
    where.push('(j.title LIKE @q OR j.description LIKE @q OR c.name LIKE @q OR j.notes LIKE @q)');
    params.q = `%${q}%`;
  }
  const sql = `${jobSelect} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY j.starred DESC, j.updated_at DESC`;
  res.json(db.prepare(sql).all(params));
});

app.get('/api/jobs/:id', (req, res) => {
  const job = db.prepare(`${jobSelect} WHERE j.id = ?`).get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  const history = db
    .prepare(
      `SELECT h.id, h.changed_at, h.stage_id, s.name AS stage_name, s.color AS stage_color
       FROM stage_history h JOIN stages s ON s.id = h.stage_id
       WHERE h.job_id = ? ORDER BY h.changed_at, h.id`,
    )
    .all(req.params.id);
  res.json({ ...job, history, referrers: referrersOf(req.params.id) });
});

app.post('/api/jobs', (req, res) => {
  const j = normalizeJob(req.body);
  if (!j.title) return res.status(400).json({ error: 'Title is required' });
  // A company given by name only (an import for a company not in the list yet): use it or create it.
  const companyName = String(req.body.company_name ?? '').trim();
  if (!j.company_id && companyName) j.company_id = findOrCreateCompany(companyName);
  if (!j.company_id) return res.status(400).json({ error: 'Company is required' });
  const refs = referrerIds(req.body);
  if (typeof refs === 'string') return res.status(400).json({ error: refs });
  const id = db.transaction(() => {
    const cols = JOB_FIELDS.join(', ');
    const params = JOB_FIELDS.map((f) => '@' + f).join(', ');
    const info = db.prepare(`INSERT INTO jobs (${cols}) VALUES (${params})`).run(j);
    db.prepare('INSERT INTO stage_history (job_id, stage_id) VALUES (?, ?)').run(info.lastInsertRowid, j.stage_id);
    alignAppliedStep(info.lastInsertRowid);
    if (refs) saveReferrers(info.lastInsertRowid, refs);
    return info.lastInsertRowid;
  })();
  queueDescriptionFill(id);
  ghostStaleApplications(); // an old application saved now is ghosted straight away
  res.status(201).json(db.prepare(`${jobSelect} WHERE j.id = ?`).get(id));
});

app.put('/api/jobs/:id', (req, res) => {
  const prev = db.prepare('SELECT stage_id, applied_date FROM jobs WHERE id = ?').get(req.params.id) as
    | { stage_id: number; applied_date: string | null }
    | undefined;
  if (!prev) return res.status(404).json({ error: 'Job not found' });
  const j = normalizeJob(req.body);
  if (!j.title) return res.status(400).json({ error: 'Title is required' });
  const refs = referrerIds(req.body);
  if (typeof refs === 'string') return res.status(400).json({ error: refs });
  db.transaction(() => {
    const sets = JOB_FIELDS.map((f) => `${f} = @${f}`).join(', ');
    db.prepare(`UPDATE jobs SET ${sets}, updated_at = datetime('now') WHERE id = @id`).run({ ...j, id: req.params.id });
    if (prev.stage_id !== j.stage_id) {
      db.prepare('INSERT INTO stage_history (job_id, stage_id) VALUES (?, ?)').run(req.params.id, j.stage_id);
    }
    if (prev.applied_date !== j.applied_date) alignAppliedStep(req.params.id);
    if (refs) saveReferrers(Number(req.params.id), refs);
  })();
  queueDescriptionFill(req.params.id);
  ghostStaleApplications(); // an old application saved now is ghosted straight away
  res.json(db.prepare(`${jobSelect} WHERE j.id = ?`).get(req.params.id));
});

app.patch('/api/jobs/:id/stage', (req, res) => {
  const stageId = Number(req.body.stage_id);
  const prev = db.prepare('SELECT stage_id, applied_date FROM jobs WHERE id = ?').get(req.params.id) as
    | { stage_id: number; applied_date: string | null }
    | undefined;
  if (!prev) return res.status(404).json({ error: 'Job not found' });
  if (prev.stage_id !== stageId) {
    db.transaction(() => {
      const applied = isPastFirstStage(stageId) ? (prev.applied_date ?? today()) : null;
      db.prepare(`UPDATE jobs SET stage_id = ?, applied_date = ?, updated_at = datetime('now') WHERE id = ?`).run(
        stageId,
        applied,
        req.params.id,
      );
      db.prepare('INSERT INTO stage_history (job_id, stage_id) VALUES (?, ?)').run(req.params.id, stageId);
    })();
  }
  res.json(db.prepare(`${jobSelect} WHERE j.id = ?`).get(req.params.id));
});

app.patch('/api/jobs/:id/star', (req, res) => {
  const info = db.prepare('UPDATE jobs SET starred = ? WHERE id = ?').run(req.body.starred ? 1 : 0, req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Job not found' });
  res.json(db.prepare(`${jobSelect} WHERE j.id = ?`).get(req.params.id));
});

// ---------- Stage history (editable: add past steps with their dates) ----------

/** The job's stage is its latest step; the applied date is the first step past the first stage. */
function syncFromHistory(jobId: number | string) {
  const steps = db
    .prepare(
      `SELECT h.stage_id, date(h.changed_at) AS day FROM stage_history h WHERE h.job_id = ? ORDER BY h.changed_at, h.id`,
    )
    .all(jobId) as { stage_id: number; day: string }[];
  if (!steps.length) return;
  const first = firstStageId();
  const latest = steps[steps.length - 1].stage_id;
  const applied = steps.find((s) => s.stage_id !== first)?.day ?? null;
  // Back in the first stage (Saved) = not applied: no applied date.
  db.prepare(
    `UPDATE jobs SET stage_id = ?, applied_date = CASE WHEN ? THEN NULL ELSE COALESCE(?, applied_date) END, updated_at = datetime('now') WHERE id = ?`,
  ).run(latest, latest === first ? 1 : 0, applied, jobId);
}

/** "2026-10-05" → stored at noon so it sorts within the day and shows the same date everywhere. */
function stepTime(date: unknown): string | null {
  const d = String(date ?? '');
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d} 12:00:00` : null;
}

app.post('/api/jobs/:id/history', (req, res) => {
  const job = db.prepare('SELECT id FROM jobs WHERE id = ?').get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  const stageId = Number(req.body.stage_id);
  if (!db.prepare('SELECT 1 FROM stages WHERE id = ?').get(stageId)) return res.status(400).json({ error: 'Pick a stage.' });
  const at = stepTime(req.body.date);
  if (!at) return res.status(400).json({ error: 'Pick a date.' });
  db.transaction(() => {
    db.prepare('INSERT INTO stage_history (job_id, stage_id, changed_at) VALUES (?, ?, ?)').run(req.params.id, stageId, at);
    syncFromHistory(req.params.id);
  })();
  res.status(201).json({ ok: true });
});

app.put('/api/jobs/:id/history/:hid', (req, res) => {
  const step = db.prepare('SELECT id, stage_id, changed_at FROM stage_history WHERE id = ? AND job_id = ?').get(req.params.hid, req.params.id) as
    | { id: number; stage_id: number; changed_at: string }
    | undefined;
  if (!step) return res.status(404).json({ error: 'Step not found' });
  const stageId = req.body.stage_id ? Number(req.body.stage_id) : step.stage_id;
  const at = req.body.date ? stepTime(req.body.date) : step.changed_at;
  if (!at) return res.status(400).json({ error: 'Pick a date.' });
  db.transaction(() => {
    db.prepare('UPDATE stage_history SET stage_id = ?, changed_at = ? WHERE id = ?').run(stageId, at, step.id);
    syncFromHistory(req.params.id);
  })();
  res.json({ ok: true });
});

app.delete('/api/jobs/:id/history/:hid', (req, res) => {
  const count = (db.prepare('SELECT COUNT(*) AS n FROM stage_history WHERE job_id = ?').get(req.params.id) as { n: number }).n;
  if (count <= 1) return res.status(409).json({ error: 'An application needs at least one step.' });
  db.transaction(() => {
    db.prepare('DELETE FROM stage_history WHERE id = ? AND job_id = ?').run(req.params.hid, req.params.id);
    syncFromHistory(req.params.id);
  })();
  res.status(204).end();
});

app.delete('/api/jobs/:id', (req, res) => {
  db.prepare('DELETE FROM jobs WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

// ---------- Contacts (LinkedIn connections and referrers) ----------

const CONTACT_STATUSES = ['message_sent', 'chatting', 'referred'] as const;

const CONTACT_FIELDS = ['full_name', 'company', 'position', 'linkedin_url', 'email', 'connected_on', 'status'] as const;

const contactSelect = `
  SELECT c.*, (SELECT COUNT(*) FROM job_referrers r WHERE r.contact_id = c.id) AS referral_count
  FROM contacts c`;

function normalizeContact(body: Row) {
  const c: Row = {};
  for (const f of CONTACT_FIELDS) {
    const v = emptyToNull(body[f]);
    c[f] = typeof v === 'string' ? v.trim() || null : v;
  }
  c.full_name = String(body.full_name ?? '').trim();
  if (typeof c.linkedin_url === 'string') c.linkedin_url = c.linkedin_url.replace(/\/+$/, '');
  if (!CONTACT_STATUSES.includes(c.status as (typeof CONTACT_STATUSES)[number])) c.status = null;
  return c;
}

/**
 * A LinkedIn profile link → name, company, position, place; plus the contact if you already have them,
 * and the company if it's in your list. With `page` (from the extension) your logged-in tab's top card is used too.
 */
app.post(
  '/api/linkedin/profile',
  wrap(async (req, res) => {
    const url = String(req.body.url ?? '');
    const kept = req.body.page ? keptPage(String(req.body.page)) : null;
    const tab = kept ? cleanTab<TabProfile>(kept.data) : {};
    let p: LinkedInProfile | null = null;
    let error: Error | null = null;
    try {
      p = await fetchLinkedInProfile(url);
    } catch (e) {
      error = e as Error;
    }
    if (kept) {
      const canonical = canonicalProfileUrl(kept.url) ?? canonicalProfileUrl(url) ?? url;
      const fromHtml = parseProfilePage(kept.html, canonical);
      // A headline "Talent Acquisition Lead at Delta" is the position at the company: keep just the position.
      const position = tab.headline && tab.company ? tab.headline.replace(new RegExp(`\\s+(at|@)\\s+${escapeRe(tab.company)}\\b.*$`, 'i'), '') : tab.headline;
      p = overlay(overlay(fromHtml, { full_name: tab.name, company: tab.company, position, location: tab.location }), p);
      p.linkedin_url = canonical;
    }
    if (!p?.full_name) return res.status(422).json({ error: error?.message ?? 'No name found on that profile.' });
    const existing = db.prepare('SELECT id, full_name FROM contacts WHERE lower(linkedin_url) = ?').get(p.linkedin_url.toLowerCase()) ?? null;
    const companies = db.prepare('SELECT id, name FROM companies').all() as { id: number; name: string }[];
    const company_match = p.company ? (companies.find((c) => sameCompany(c.name, p!.company)) ?? null) : null;
    res.json({ ...p, company_linkedin: canonicalCompanyUrl(tab.company_url ?? '') ?? null, existing, company_match });
  }),
);

app.get('/api/contacts', (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const rows = q
    ? db
        .prepare(
          `${contactSelect} WHERE c.full_name LIKE @q OR c.company LIKE @q OR c.position LIKE @q ORDER BY c.full_name COLLATE NOCASE`,
        )
        .all({ q: `%${q}%` })
    : db.prepare(`${contactSelect} ORDER BY c.full_name COLLATE NOCASE`).all();
  res.json(rows);
});

app.post('/api/contacts', (req, res) => {
  const c = normalizeContact(req.body);
  if (!c.full_name) return res.status(400).json({ error: 'Name is required' });
  if (c.linkedin_url) {
    const dupe = db.prepare('SELECT id FROM contacts WHERE linkedin_url = ?').get(c.linkedin_url) as { id: number } | undefined;
    if (dupe) return res.json(db.prepare(`${contactSelect} WHERE c.id = ?`).get(dupe.id));
  }
  const cols = CONTACT_FIELDS.join(', ');
  const params = CONTACT_FIELDS.map((f) => '@' + f).join(', ');
  const info = db.prepare(`INSERT INTO contacts (${cols}, source) VALUES (${params}, 'manual')`).run(c);
  res.status(201).json(db.prepare(`${contactSelect} WHERE c.id = ?`).get(info.lastInsertRowid));
});

// Must be registered before /api/contacts/:id.
app.post('/api/contacts/import-linkedin', (req, res) => {
  let rows;
  try {
    rows = parseLinkedInConnections(String(req.body.csv ?? ''));
  } catch (e) {
    return res.status(400).json({ error: (e as Error).message });
  }
  const result = db.transaction(() => {
    let added = 0;
    let updated = 0;
    const byUrl = db.prepare('SELECT id FROM contacts WHERE linkedin_url = ?');
    const byName = db.prepare(
      `SELECT id FROM contacts WHERE linkedin_url IS NULL AND full_name = ? COLLATE NOCASE AND IFNULL(company, '') = IFNULL(?, '') COLLATE NOCASE`,
    );
    const update = db.prepare(
      `UPDATE contacts SET full_name = @full_name, company = @company, position = @position, linkedin_url = @linkedin_url,
         email = COALESCE(@email, email), connected_on = COALESCE(@connected_on, connected_on) WHERE id = @id`,
    );
    const insert = db.prepare(
      `INSERT INTO contacts (full_name, company, position, linkedin_url, email, connected_on, source)
       VALUES (@full_name, @company, @position, @linkedin_url, @email, @connected_on, 'linkedin_import')`,
    );
    for (const r of rows) {
      const hit = ((r.linkedin_url && byUrl.get(r.linkedin_url)) || byName.get(r.full_name, r.company)) as
        | { id: number }
        | undefined;
      if (hit) (update.run({ ...r, id: hit.id }), updated++);
      else (insert.run(r), added++);
    }
    return { added, updated, total: rows.length };
  })();
  res.json(result);
});

/** LinkedIn messages.csv → who you've talked to. Only counts are stored, never message text. */
app.post('/api/contacts/import-messages', (req, res) => {
  let stats;
  try {
    stats = conversationStats(String(req.body.csv ?? ''));
  } catch (e) {
    return res.status(400).json({ error: (e as Error).message });
  }
  const contacts = db.prepare('SELECT id, linkedin_url FROM contacts WHERE linkedin_url IS NOT NULL').all() as {
    id: number;
    linkedin_url: string;
  }[];
  const result = db.transaction(() => {
    db.exec(`UPDATE contacts SET conversations = 0, messages = 0, messages_from_them = 0, last_message_at = NULL`);
    const update = db.prepare(
      `UPDATE contacts SET conversations = @conversations, messages = @messages, messages_from_them = @messages_from_them,
         last_message_at = @last_message_at WHERE id = @id`,
    );
    let matched = 0;
    const used = new Set<string>();
    for (const c of contacts) {
      const key = profileKey(c.linkedin_url);
      const st = key && stats.get(key);
      if (st) (update.run({ ...st, id: c.id }), matched++, used.add(key!));
    }
    return { people: stats.size, matched, not_connections: stats.size - used.size };
  })();
  res.json(result);
});


/** Where you stand with a person ({ status: 'chatting' | … | null }) and/or the favourite star ({ favorite: bool }). */
app.patch('/api/contacts/:id', (req, res) => {
  const sets: string[] = [];
  const params: Row = { id: req.params.id };
  if ('status' in req.body) {
    const st = req.body.status || null;
    if (st !== null && !CONTACT_STATUSES.includes(st)) return res.status(400).json({ error: 'Unknown status' });
    sets.push('status = @status');
    params.status = st;
  }
  if ('favorite' in req.body) (sets.push('favorite = @favorite'), (params.favorite = req.body.favorite ? 1 : 0));
  if (!sets.length) return res.status(400).json({ error: 'Nothing to change' });
  const info = db.prepare(`UPDATE contacts SET ${sets.join(', ')} WHERE id = @id`).run(params);
  if (!info.changes) return res.status(404).json({ error: 'Contact not found' });
  res.json(db.prepare(`${contactSelect} WHERE c.id = ?`).get(req.params.id));
});

/** Mark or unmark "I talked to this person". */
app.patch('/api/contacts/:id/talked', (req, res) => {
  const info = db
    .prepare(`UPDATE contacts SET talked_at = CASE WHEN ? THEN COALESCE(talked_at, date('now')) END WHERE id = ?`)
    .run(req.body.talked ? 1 : 0, req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Contact not found' });
  res.json(db.prepare(`${contactSelect} WHERE c.id = ?`).get(req.params.id));
});

app.put('/api/contacts/:id', (req, res) => {
  const c = normalizeContact(req.body);
  if (!c.full_name) return res.status(400).json({ error: 'Name is required' });
  const sets = CONTACT_FIELDS.map((f) => `${f} = @${f}`).join(', ');
  try {
    const info = db.prepare(`UPDATE contacts SET ${sets} WHERE id = @id`).run({ ...c, id: req.params.id });
    if (!info.changes) return res.status(404).json({ error: 'Contact not found' });
  } catch (e) {
    if (String(e).includes('UNIQUE')) return res.status(409).json({ error: 'Another contact already has that LinkedIn link.' });
    throw e;
  }
  res.json(db.prepare(`${contactSelect} WHERE c.id = ?`).get(req.params.id));
});

app.delete('/api/contacts/:id', (req, res) => {
  db.prepare('DELETE FROM contacts WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

/** Your connections whose current company matches this company's name. */
app.get('/api/companies/:id/connections', (req, res) => {
  const company = db.prepare('SELECT name FROM companies WHERE id = ?').get(req.params.id) as { name: string } | undefined;
  if (!company) return res.status(404).json({ error: 'Company not found' });
  const all = db.prepare(`${contactSelect} WHERE c.company IS NOT NULL ORDER BY c.full_name COLLATE NOCASE`).all() as Row[];
  res.json(all.filter((c) => sameCompany(String(c.company), company.name)));
});

// ---------- Openings (LinkedIn job search + company careers pages) ----------

const openingsQueue: number[] = [];
const scanState = { running: false, done: 0, total: 0, found: 0, current: null as string | null };

function queueScans(ids: number[]) {
  for (const id of ids) if (!openingsQueue.includes(id)) (openingsQueue.push(id), scanState.total++);
  if (!scanState.running) void runScans();
}

/** Saves one source's results: new ones added, seen ones refreshed, missing ones marked closed. */
function saveOpenings(companyId: number, source: 'linkedin' | 'website', found: FoundOpening[]) {
  const upsert = db.prepare(
    `INSERT INTO openings (company_id, source, external_id, title, location, url, posted_at)
     VALUES (@company_id, @source, @external_id, @title, @location, @url, @posted_at)
     ON CONFLICT(company_id, source, external_id) DO UPDATE SET
       title = excluded.title, location = excluded.location, url = excluded.url,
       posted_at = COALESCE(excluded.posted_at, posted_at), last_seen = datetime('now'), closed_at = NULL`,
  );
  db.transaction(() => {
    const scanStart = (db.prepare(`SELECT datetime('now') AS t`).get() as { t: string }).t;
    for (const o of found) upsert.run({ ...o, company_id: companyId, source });
    db.prepare(
      `UPDATE openings SET closed_at = datetime('now')
       WHERE company_id = ? AND source = ? AND closed_at IS NULL AND last_seen < ?`,
    ).run(companyId, source, scanStart);
  })();
}

async function scanCompany(id: number) {
  const c = db
    .prepare('SELECT id, name, linkedin, linkedin_id, website, careers_url, country, city FROM companies WHERE id = ?')
    .get(id) as
    | {
        id: number;
        name: string;
        linkedin: string | null;
        linkedin_id: string | null;
        website: string | null;
        careers_url: string | null;
        country: string | null;
        city: string | null;
      }
    | undefined;
  if (!c) return;
  scanState.current = c.name;
  const notes: string[] = [];

  let li = c.linkedin ? canonicalCompanyUrl(c.linkedin) : null;
  if (!li) {
    // Only a name (or a LinkedIn search link): find the real company page through job search, and keep it.
    // Exact name only: "Fawry" must not pick "Fawry MSME Finance".
    const exact = (x: string, y: string) => {
      const [p, q] = [normalizeName(x), normalizeName(y)];
      return !!p && (p === q || p.replace(/ /g, '') === q.replace(/ /g, ''));
    };
    li = await findLinkedInCompanyPage(c.name, c.country, exact).catch(() => null);
    if (li) {
      db.prepare('UPDATE companies SET linkedin = ? WHERE id = ?').run(li, id);
      const logo = db.prepare(`SELECT status FROM company_logos WHERE company_id = ?`).get(id) as { status: string } | undefined;
      if (!logo || logo.status === 'none') {
        db.prepare('DELETE FROM company_logos WHERE company_id = ?').run(id);
        queueLogos([id]);
      }
      notes.push('Found its LinkedIn page');
    }
  }
  if (li) {
    try {
      let liId = c.linkedin_id;
      if (!liId) {
        liId = await linkedInCompanyId(li);
        if (liId) db.prepare('UPDATE companies SET linkedin_id = ? WHERE id = ?').run(liId, id);
      }
      if (liId) {
        const found = await linkedInOpenings(liId, c.country);
        saveOpenings(id, 'linkedin', found);
        scanState.found += found.length;
        notes.push(`LinkedIn: ${found.length}`);
      } else notes.push('LinkedIn: company page not readable');
    } catch (e) {
      notes.push(`LinkedIn: ${(e as Error).message}`);
    }
  } else notes.push('LinkedIn: no company page link');

  try {
    const w = await websiteOpenings(c);
    if (w.openings.length) {
      saveOpenings(id, 'website', w.openings);
      scanState.found += w.openings.length;
    }
    if (w.careersUrl) db.prepare('UPDATE companies SET careers_found_url = ? WHERE id = ?').run(w.careersUrl, id);
    notes.push(`Website: ${w.note}`);
  } catch (e) {
    notes.push(`Website: ${(e as Error).message}`);
  }

  db.prepare(`UPDATE companies SET openings_scanned_at = datetime('now'), openings_note = ? WHERE id = ?`).run(notes.join(' · '), id);
}

async function runScans() {
  scanState.running = true;
  while (openingsQueue.length) {
    const id = openingsQueue.shift()!;
    await scanCompany(id).catch((e) => console.error('scan failed', id, e));
    scanState.done++;
    if (openingsQueue.length) await new Promise((r) => setTimeout(r, 1500));
  }
  scanState.running = false;
  scanState.current = null;
}

app.get('/api/openings/status', (_req, res) => {
  const last = db.prepare('SELECT MAX(openings_scanned_at) AS t FROM companies').get() as { t: string | null };
  res.json({ ...scanState, last_scan: last.t });
});

app.post('/api/openings/scan', (req, res) => {
  const ids: number[] = Array.isArray(req.body?.company_ids)
    ? req.body.company_ids.map(Number)
    : (db.prepare('SELECT id FROM companies ORDER BY openings_scanned_at IS NOT NULL, openings_scanned_at, name').all() as { id: number }[]).map(
        (r) => r.id,
      );
  if (!scanState.running) Object.assign(scanState, { done: 0, total: 0, found: 0 });
  queueScans(ids);
  res.status(202).json(scanState);
});

const openingSelect = `
  SELECT o.*, c.name AS company_name,
         (SELECT CASE WHEN l.status = 'found' THEN l.fetched_at END FROM company_logos l WHERE l.company_id = o.company_id) AS logo_at,
         j.stage_id AS job_stage_id, s.name AS job_stage_name, s.color AS job_stage_color
  FROM openings o
  JOIN companies c ON c.id = o.company_id
  LEFT JOIN jobs j ON j.id = o.job_id
  LEFT JOIN stages s ON s.id = j.stage_id`;

app.get('/api/openings', (req, res) => {
  const where: string[] = [];
  const params: Row = {};
  const { q, company_id, source, status = 'open', starred, hidden, days } = req.query;
  if (status === 'open') where.push('o.closed_at IS NULL');
  if (status === 'closed') where.push('o.closed_at IS NOT NULL');
  if (company_id) (where.push('o.company_id = @company_id'), (params.company_id = company_id));
  if (source) (where.push('o.source = @source'), (params.source = source));
  if (starred === '1') where.push('o.starred = 1');
  if (hidden === '1') where.push('o.hidden = 1');
  else where.push('o.hidden = 0');
  if (days) (where.push(`o.first_seen >= datetime('now', @days)`), (params.days = `-${Number(days)} days`));
  if (q) {
    // Every word must appear in the title, company or location.
    String(q)
      .split(/\s+/)
      .filter(Boolean)
      .forEach((w, i) => {
        where.push(`(o.title LIKE @q${i} OR c.name LIKE @q${i} OR o.location LIKE @q${i})`);
        params[`q${i}`] = `%${w}%`;
      });
  }
  const sql = `${openingSelect} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY o.starred DESC, COALESCE(o.posted_at, o.first_seen) DESC LIMIT 2000`;
  res.json(db.prepare(sql).all(params));
});

app.patch('/api/openings/:id', (req, res) => {
  const sets: string[] = [];
  const params: Row = { id: req.params.id };
  for (const k of ['starred', 'hidden'] as const)
    if (k in req.body) (sets.push(`${k} = @${k}`), (params[k] = req.body[k] ? 1 : 0));
  if (sets.length) db.prepare(`UPDATE openings SET ${sets.join(', ')} WHERE id = @id`).run(params);
  res.json(db.prepare(`SELECT * FROM openings WHERE id = ?`).get(req.params.id));
});

/** "I applied": logs an application from the opening and links them. */
app.post('/api/openings/:id/applied', (req, res) => {
  const o = db.prepare('SELECT * FROM openings WHERE id = ?').get(req.params.id) as Row | undefined;
  if (!o) return res.status(404).json({ error: 'Opening not found' });
  if (o.job_id) return res.json(db.prepare(`${jobSelect} WHERE j.id = ?`).get(o.job_id));
  const ordered = db.prepare(`SELECT id, kind FROM stages ORDER BY sort_order, id`).all() as { id: number; kind: string }[];
  const appliedStage = ordered.find((st, i) => i > 0 && st.kind === 'active') ?? ordered[0];
  const loc = String(o.location ?? '').toLowerCase();
  const j = normalizeJob({
    company_id: o.company_id,
    title: o.title,
    url: o.url,
    stage_id: appliedStage.id,
    applied_date: today(),
    location_type: /remote/.test(loc) ? 'remote' : /hybrid/.test(loc) ? 'hybrid' : /on-?site/.test(loc) ? 'onsite' : 'unknown',
    apply_channel: o.source === 'linkedin' ? 'linkedin' : 'website',
    // LinkedIn jobs: the posting link is the job's url; nothing separate to record.
    apply_contact: o.source === 'linkedin' ? null : o.url,
    cv_id: defaultCvId(),
  });
  const id = db.transaction(() => {
    const cols = JOB_FIELDS.join(', ');
    const ps = JOB_FIELDS.map((f) => '@' + f).join(', ');
    const info = db.prepare(`INSERT INTO jobs (${cols}) VALUES (${ps})`).run(j);
    db.prepare('INSERT INTO stage_history (job_id, stage_id) VALUES (?, ?)').run(info.lastInsertRowid, j.stage_id);
    db.prepare('UPDATE openings SET job_id = ? WHERE id = ?').run(info.lastInsertRowid, o.id);
    return info.lastInsertRowid;
  })();
  queueDescriptionFill(id);
  res.status(201).json(db.prepare(`${jobSelect} WHERE j.id = ?`).get(id));
});

// ---------- CVs ----------
// Each version you send is kept with its own label: the files usually share one name.

const cvSelect = `
  SELECT cv.id, cv.label, cv.file_name, cv.mime, cv.size, cv.notes, cv.is_default, cv.created_at,
         (SELECT COUNT(*) FROM jobs j WHERE j.cv_id = cv.id) AS job_count
  FROM cvs cv`;

function defaultCvId(): number | null {
  return (db.prepare('SELECT id FROM cvs WHERE is_default = 1 LIMIT 1').get() as { id: number } | undefined)?.id ?? null;
}

const takenCvLabels = () => (db.prepare('SELECT label FROM cvs').all() as { label: string }[]).map((r) => r.label);

app.get('/api/cvs', (_req, res) => {
  res.json(db.prepare(`${cvSelect} ORDER BY cv.is_default DESC, cv.created_at DESC, cv.id DESC`).all());
});

app.post('/api/cvs', (req, res) => {
  const file = parseCvFile(req.body.dataUrl, req.body.file_name);
  if (typeof file === 'string') return res.status(400).json({ error: file });
  const label = String(req.body.label ?? '').trim() || defaultCvLabel(today(), takenCvLabels());
  const id = db.transaction(() => {
    const first = !db.prepare('SELECT 1 FROM cvs').get();
    const info = db
      .prepare(`INSERT INTO cvs (label, file_name, mime, size, data, notes, is_default) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(label, file.file_name, file.mime, file.data.length, file.data, emptyToNull(String(req.body.notes ?? '').trim()), first ? 1 : 0);
    return info.lastInsertRowid;
  })();
  res.status(201).json(db.prepare(`${cvSelect} WHERE cv.id = ?`).get(id));
});

app.put('/api/cvs/:id', (req, res) => {
  const label = String(req.body.label ?? '').trim();
  if (!label) return res.status(400).json({ error: 'Give the CV a label.' });
  const info = db.prepare('UPDATE cvs SET label = ?, notes = ? WHERE id = ?').run(label, emptyToNull(String(req.body.notes ?? '').trim()), req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'CV not found' });
  res.json(db.prepare(`${cvSelect} WHERE cv.id = ?`).get(req.params.id));
});

/** A corrected file for the same CV: applications that used it keep pointing to it. */
app.put('/api/cvs/:id/file', (req, res) => {
  const file = parseCvFile(req.body.dataUrl, req.body.file_name);
  if (typeof file === 'string') return res.status(400).json({ error: file });
  const info = db
    .prepare('UPDATE cvs SET file_name = ?, mime = ?, size = ?, data = ? WHERE id = ?')
    .run(file.file_name, file.mime, file.data.length, file.data, req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'CV not found' });
  res.json(db.prepare(`${cvSelect} WHERE cv.id = ?`).get(req.params.id));
});

app.patch('/api/cvs/:id/default', (req, res) => {
  if (!db.prepare('SELECT 1 FROM cvs WHERE id = ?').get(req.params.id)) return res.status(404).json({ error: 'CV not found' });
  db.transaction(() => {
    db.prepare('UPDATE cvs SET is_default = 0 WHERE is_default = 1').run();
    db.prepare('UPDATE cvs SET is_default = 1 WHERE id = ?').run(req.params.id);
  })();
  res.json(db.prepare(`${cvSelect} ORDER BY cv.is_default DESC, cv.created_at DESC, cv.id DESC`).all());
});

/** The file itself, under its original name. ?download=1 saves it instead of showing it. */
app.get('/api/cvs/:id/file', (req, res) => {
  const row = db.prepare('SELECT file_name, mime, data FROM cvs WHERE id = ?').get(req.params.id) as
    | { file_name: string; mime: string; data: Buffer }
    | undefined;
  if (!row) return res.status(404).end();
  res.setHeader('Content-Type', row.mime);
  res.setHeader('Content-Disposition', contentDisposition(req.query.download === '1' ? 'attachment' : 'inline', row.file_name));
  // A replaced file keeps its URL, so always check.
  res.setHeader('Cache-Control', 'no-cache');
  res.send(row.data);
});

app.delete('/api/cvs/:id', (req, res) => {
  const used = (db.prepare('SELECT COUNT(*) AS n FROM jobs WHERE cv_id = ?').get(req.params.id) as { n: number }).n;
  if (used) return res.status(409).json({ error: `Used by ${used} application(s). Pick another CV on them first.` });
  db.prepare('DELETE FROM cvs WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

// ---------- Interview quiz ----------
// Question sets come from JSON files (one per role). Every answer is kept, so weak questions can be practised again.

/** Per question: how many times answered and whether the latest answer was right (null = never tried). */
const questionStatus = `
  (SELECT COUNT(*) FROM quiz_attempts a WHERE a.question_id = q.id) AS attempts,
  (SELECT a.correct FROM quiz_attempts a WHERE a.question_id = q.id ORDER BY a.id DESC LIMIT 1) AS last_correct`;

function quizSets() {
  const sets = db.prepare('SELECT * FROM quiz_sets ORDER BY role COLLATE NOCASE').all() as Row[];
  const topics = db
    .prepare(
      `SELECT set_id, topic, MIN(topic_order) AS topic_order, COUNT(*) AS total,
              SUM(type = 'mcq') AS mcq, SUM(type = 'card') AS card,
              SUM(last_correct IS NOT NULL) AS answered, SUM(last_correct = 1) AS got_right, SUM(last_correct = 0) AS missed
       FROM (SELECT q.set_id, q.topic, q.topic_order, q.type, ${questionStatus} FROM quiz_questions q)
       GROUP BY set_id, topic ORDER BY set_id, topic_order`,
    )
    .all() as Row[];
  return sets.map((s) => ({ ...s, topics: topics.filter((t) => t.set_id === s.id).map(({ set_id: _s, ...t }) => t) }));
}

app.get('/api/quiz/sets', (_req, res) => {
  res.json(quizSets());
});

/** A question file (as text). Same role as an existing set → that set is updated; questions are matched by their id. */
app.post('/api/quiz/import', (req, res) => {
  const parsed = parseQuizFile(String(req.body.file ?? ''));
  if (typeof parsed === 'string') return res.status(400).json({ error: parsed });
  const result = db.transaction(() => {
    db.prepare(
      `INSERT INTO quiz_sets (role) VALUES (?) ON CONFLICT(role) DO UPDATE SET imported_at = datetime('now')`,
    ).run(parsed.role);
    const set = db.prepare('SELECT id FROM quiz_sets WHERE role = ?').get(parsed.role) as { id: number };
    const before = new Set((db.prepare('SELECT ext_id FROM quiz_questions WHERE set_id = ?').all(set.id) as { ext_id: string }[]).map((r) => r.ext_id));
    const upsert = db.prepare(
      `INSERT INTO quiz_questions (set_id, ext_id, topic, topic_order, sort_order, type, question, options, answer)
       VALUES (@set_id, @ext_id, @topic, @topic_order, @sort_order, @type, @question, @options, @answer)
       ON CONFLICT(set_id, ext_id) DO UPDATE SET topic = excluded.topic, topic_order = excluded.topic_order, sort_order = excluded.sort_order,
         type = excluded.type, question = excluded.question, options = excluded.options, answer = excluded.answer`,
    );
    for (const q of parsed.questions) upsert.run({ ...q, set_id: set.id, options: q.options ? JSON.stringify(q.options) : null });
    const ids = parsed.questions.map((q) => q.ext_id);
    // Questions no longer in the file go, with their answers.
    const removed = db
      .prepare(`DELETE FROM quiz_questions WHERE set_id = ? AND ext_id NOT IN (SELECT value FROM json_each(?))`)
      .run(set.id, JSON.stringify(ids)).changes;
    const added = ids.filter((id) => !before.has(id)).length;
    return { set_id: set.id, role: parsed.role, added, updated: ids.length - added, removed };
  })();
  res.json(result);
});

/**
 * Questions for a quiz, shuffled: from the chosen topics, `which` = all | missed (latest answer wrong) | new (never tried),
 * `types` = all | mcq | card, at most `count`.
 */
app.post('/api/quiz/sets/:id/start', (req, res) => {
  const topics: string[] = Array.isArray(req.body.topics) ? req.body.topics.map(String) : [];
  const where = ['q.set_id = @set_id'];
  if (topics.length) where.push('q.topic IN (SELECT value FROM json_each(@topics))');
  if (req.body.types === 'mcq' || req.body.types === 'card') where.push(`q.type = '${req.body.types}'`);
  const rows = db
    .prepare(`SELECT * FROM (SELECT q.*, ${questionStatus} FROM quiz_questions q WHERE ${where.join(' AND ')})`)
    .all({ set_id: req.params.id, topics: JSON.stringify(topics) }) as (Row & { last_correct: number | null; options: string | null })[];
  const picked = rows.filter((r) =>
    req.body.which === 'missed' ? r.last_correct === 0 : req.body.which === 'new' ? r.last_correct === null : true,
  );
  const count = Number(req.body.count) > 0 ? Number(req.body.count) : picked.length;
  res.json(
    shuffle(picked)
      .slice(0, count)
      .map((r) => ({ ...r, options: r.options ? shuffle(JSON.parse(r.options) as string[]) : null })),
  );
});

app.post('/api/quiz/answers', (req, res) => {
  const id = Number(req.body.question_id);
  if (!db.prepare('SELECT 1 FROM quiz_questions WHERE id = ?').get(id)) return res.status(404).json({ error: 'Question not found' });
  db.prepare('INSERT INTO quiz_attempts (question_id, correct) VALUES (?, ?)').run(id, req.body.correct ? 1 : 0);
  res.status(201).json({ ok: true });
});

/** Forget every answer in this set (the questions stay). */
app.delete('/api/quiz/sets/:id/progress', (req, res) => {
  db.prepare('DELETE FROM quiz_attempts WHERE question_id IN (SELECT id FROM quiz_questions WHERE set_id = ?)').run(req.params.id);
  res.json(quizSets());
});

app.delete('/api/quiz/sets/:id', (req, res) => {
  db.prepare('DELETE FROM quiz_sets WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

// ---------- Stages ----------

const stageSelect = `
  SELECT s.*, COUNT(j.id) AS job_count
  FROM stages s LEFT JOIN jobs j ON j.stage_id = s.id
  GROUP BY s.id ORDER BY s.sort_order, s.id`;

const KINDS = ['active', 'closed_won', 'closed_lost'];

app.get('/api/stages', (_req, res) => {
  res.json(db.prepare(stageSelect).all());
});

app.post('/api/stages', (req, res) => {
  const name = String(req.body.name ?? '').trim();
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const kind = KINDS.includes(req.body.kind) ? req.body.kind : 'active';
  const max = (db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM stages').get() as { m: number }).m;
  db.prepare('INSERT INTO stages (name, color, sort_order, kind) VALUES (?, ?, ?, ?)').run(
    name,
    req.body.color || '#3b82f6',
    max + 1,
    kind,
  );
  res.status(201).json(db.prepare(stageSelect).all());
});

// Must be registered before /api/stages/:id so "reorder" isn't taken as an id.
app.put('/api/stages/reorder', (req, res) => {
  const ids: number[] = req.body.ids ?? [];
  const update = db.prepare('UPDATE stages SET sort_order = ? WHERE id = ?');
  db.transaction(() => ids.forEach((id, i) => update.run(i, id)))();
  res.json(db.prepare(stageSelect).all());
});

app.put('/api/stages/:id', (req, res) => {
  const name = String(req.body.name ?? '').trim();
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const kind = KINDS.includes(req.body.kind) ? req.body.kind : 'active';
  db.prepare('UPDATE stages SET name = ?, color = ?, kind = ? WHERE id = ?').run(name, req.body.color, kind, req.params.id);
  res.json(db.prepare(stageSelect).all());
});

app.delete('/api/stages/:id', (req, res) => {
  const used = (db.prepare('SELECT COUNT(*) AS n FROM jobs WHERE stage_id = ?').get(req.params.id) as { n: number }).n;
  if (used) return res.status(409).json({ error: `${used} job(s) are in this stage. Move them first.` });
  const total = (db.prepare('SELECT COUNT(*) AS n FROM stages').get() as { n: number }).n;
  if (total <= 1) return res.status(409).json({ error: 'You need at least one stage.' });
  db.transaction(() => {
    db.prepare('DELETE FROM stage_history WHERE stage_id = ?').run(req.params.id);
    db.prepare('DELETE FROM stages WHERE id = ?').run(req.params.id);
  })();
  res.json(db.prepare(stageSelect).all());
});

// ---------- Stats ----------

app.get('/api/stats', (req, res) => {
  const stages = db.prepare(stageSelect).all() as (Row & { id: number; sort_order: number; kind: string })[];

  // Funnel: how many jobs ever reached each non-lost stage (or a later one).
  const reachedRows = db
    .prepare(
      `SELECT h.job_id, MAX(s.sort_order) AS max_order
       FROM stage_history h JOIN stages s ON s.id = h.stage_id
       WHERE s.kind != 'closed_lost'
       GROUP BY h.job_id`,
    )
    .all() as { job_id: number; max_order: number }[];
  const funnel = stages
    .filter((s) => s.kind !== 'closed_lost')
    .map((s) => ({
      id: s.id,
      name: s.name,
      color: s.color,
      count: reachedRows.filter((r) => r.max_order >= s.sort_order).length,
    }));

  const totals = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM companies) AS companies,
         (SELECT COUNT(*) FROM companies WHERE is_remote = 1) AS remote_companies,
         (SELECT COUNT(*) FROM jobs) AS jobs,
         (SELECT COUNT(*) FROM jobs WHERE applied_date IS NOT NULL) AS applied,
         (SELECT COUNT(*) FROM jobs j JOIN stages s ON s.id = j.stage_id
            WHERE s.kind = 'active' AND j.applied_date IS NOT NULL) AS in_progress,
         (SELECT COUNT(*) FROM jobs j JOIN stages s ON s.id = j.stage_id WHERE s.kind = 'closed_won') AS won,
         (SELECT COUNT(*) FROM jobs j JOIN stages s ON s.id = j.stage_id WHERE s.kind = 'closed_lost') AS lost`,
    )
    .get();

  const perWeek = db
    .prepare(
      `SELECT date(applied_date, 'weekday 0', '-6 days') AS week, COUNT(*) AS count
       FROM jobs WHERE applied_date IS NOT NULL
       GROUP BY week ORDER BY week`,
    )
    .all();

  const byLocationType = db
    .prepare(`SELECT location_type AS type, COUNT(*) AS count FROM jobs GROUP BY location_type`)
    .all();

  // Sankey, optionally filtered by how you applied and whether someone referred you.
  const where: string[] = [];
  const params: Row = {};
  channelFilters(req.query, where, params);
  const sankeyJobs = (
    db
      .prepare(
        `SELECT j.stage_id,
                (SELECT GROUP_CONCAT(stage_id) FROM (SELECT stage_id FROM stage_history WHERE job_id = j.id ORDER BY changed_at, id)) AS visited
         FROM jobs j ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`,
      )
      .all(params) as { stage_id: number; visited: string | null }[]
  ).map((r) => ({ stage_id: r.stage_id, visited: r.visited ? r.visited.split(',').map(Number) : [r.stage_id] }));
  const sankey = buildSankey(stages as unknown as SankeyStage[], sankeyJobs);

  // Per channel and referred/not: how many applied, and how many got past the "Applied" stage.
  const ordered = [...stages].sort((a, b) => a.sort_order - b.sort_order);
  const appliedOrder = ordered.find((s, i) => i > 0 && s.kind === 'active')?.sort_order ?? ordered[0]?.sort_order ?? 0;
  const progress = db
    .prepare(
      `SELECT j.apply_channel AS channel,
              EXISTS (SELECT 1 FROM job_referrers r WHERE r.job_id = j.id) AS referred,
              EXISTS (SELECT 1 FROM stage_history h JOIN stages s ON s.id = h.stage_id
                      WHERE h.job_id = j.id AND s.kind != 'closed_lost' AND s.sort_order > @appliedOrder) AS responded
       FROM jobs j WHERE j.applied_date IS NOT NULL`,
    )
    .all({ appliedOrder }) as { channel: string | null; referred: number; responded: number }[];
  const tally = (key: (r: (typeof progress)[number]) => string) => {
    const m = new Map<string, { key: string; applied: number; responded: number }>();
    for (const r of progress) {
      const k = key(r);
      const t = m.get(k) ?? { key: k, applied: 0, responded: 0 };
      t.applied++;
      t.responded += r.responded;
      m.set(k, t);
    }
    return [...m.values()].sort((a, b) => b.applied - a.applied);
  };
  const byChannel = tally((r) => r.channel ?? 'none');
  const byReferral = tally((r) => (r.referred ? 'referred' : 'not_referred'));

  res.json({ stages, funnel, totals, perWeek, byLocationType, sankey, byChannel, byReferral });
});

// ---------- Maps link ----------

app.post(
  '/api/resolve-maps-link',
  wrap(async (req, res) => {
    const link = String(req.body.link ?? '').trim();
    if (!link) return res.status(400).json({ error: 'Link is required' });
    const { coords, finalUrl } = await resolveMapsLink(link);
    if (!coords) return res.status(422).json({ error: 'No coordinates found in that link.', finalUrl });
    res.json({ ...coords, finalUrl });
  }),
);

// ---------- Home location ----------

const HOME_KEYS = ['home_lat', 'home_lng', 'home_label', 'home_link'];

function getHome() {
  const rows = db.prepare(`SELECT key, value FROM settings WHERE key LIKE 'home_%'`).all() as { key: string; value: string }[];
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  if (m.home_lat == null || m.home_lng == null) return null;
  return { lat: Number(m.home_lat), lng: Number(m.home_lng), label: m.home_label || 'Home', link: m.home_link ?? null };
}

app.get('/api/home', (_req, res) => {
  res.json(getHome());
});

app.put(
  '/api/home',
  wrap(async (req, res) => {
    let lat = numOrNull(req.body.lat);
    let lng = numOrNull(req.body.lng);
    const link = String(req.body.link ?? '').trim() || null;
    if ((lat === null || lng === null) && link) {
      const { coords } = await resolveMapsLink(link);
      if (!coords) return res.status(422).json({ error: 'No coordinates found in that link.' });
      ({ lat, lng } = coords);
    }
    if (lat === null || lng === null) return res.status(400).json({ error: 'Give a Google Maps link or latitude/longitude.' });
    const values: Record<string, string | null> = {
      home_lat: String(lat),
      home_lng: String(lng),
      home_label: String(req.body.label ?? '').trim() || 'Home',
      home_link: link,
    };
    const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    db.transaction(() => HOME_KEYS.forEach((k) => upsert.run(k, values[k])))();
    res.json(getHome());
  }),
);

app.delete('/api/home', (_req, res) => {
  db.prepare(`DELETE FROM settings WHERE key LIKE 'home_%'`).run();
  res.status(204).end();
});

// ---------- Export / Import ----------

app.get('/api/export', (_req, res) => {
  const data = {
    version: 1,
    exported_at: new Date().toISOString(),
    stages: db.prepare('SELECT * FROM stages ORDER BY sort_order').all(),
    companies: db.prepare('SELECT * FROM companies ORDER BY id').all(),
    company_locations: db.prepare('SELECT * FROM company_locations ORDER BY id').all(),
    cvs: (db.prepare('SELECT * FROM cvs ORDER BY id').all() as Row[]).map((cv) => ({ ...cv, data: (cv.data as Buffer).toString('base64') })),
    jobs: db.prepare('SELECT * FROM jobs ORDER BY id').all(),
    stage_history: db.prepare('SELECT * FROM stage_history ORDER BY id').all(),
    contacts: db.prepare('SELECT * FROM contacts ORDER BY id').all(),
    job_referrers: db.prepare('SELECT * FROM job_referrers').all(),
    company_logos: (db.prepare('SELECT * FROM company_logos').all() as Row[]).map((l) => ({
      ...l,
      data: l.data ? (l.data as Buffer).toString('base64') : null,
    })),
    settings: db.prepare('SELECT * FROM settings').all(),
    quiz_sets: db.prepare('SELECT * FROM quiz_sets ORDER BY id').all(),
    quiz_questions: db.prepare('SELECT * FROM quiz_questions ORDER BY id').all(),
    quiz_attempts: db.prepare('SELECT * FROM quiz_attempts ORDER BY id').all(),
  };
  res.setHeader('Content-Disposition', `attachment; filename="job-tracker-${today()}.json"`);
  res.json(data);
});

/**
 * Two modes:
 *  - "replace": restore a full export (wipes current data, keeps ids).
 *  - "merge":   add companies/jobs from simple records. Jobs reference companies
 *               by `company` (name) and stages by `stage` (name).
 */
app.post(
  '/api/import',
  wrap(async (req, res) => {
    const {
      mode = 'merge', stages = [], companies = [], company_locations, jobs = [], stage_history = [], settings = [], contacts = [], job_referrers = [], company_logos = [], cvs = [], quiz_sets = [], quiz_questions = [], quiz_attempts = [],
    } = req.body as {
      company_locations?: Row[];
      contacts?: Row[];
      job_referrers?: Row[];
      company_logos?: Row[];
      cvs?: Row[];
      quiz_sets?: Row[];
      quiz_questions?: Row[];
      quiz_attempts?: Row[];
      mode?: string;
      stages?: Row[];
      companies?: Row[];
      jobs?: Row[];
      stage_history?: Row[];
      settings?: Row[];
    };

    if (mode === 'replace') {
      db.transaction(() => {
        db.exec('DELETE FROM quiz_attempts; DELETE FROM quiz_questions; DELETE FROM quiz_sets; DELETE FROM company_locations; DELETE FROM company_logos; DELETE FROM job_referrers; DELETE FROM contacts; DELETE FROM stage_history; DELETE FROM jobs; DELETE FROM cvs; DELETE FROM companies; DELETE FROM stages; DELETE FROM settings;');
        const insertAll = (table: string, rows: Row[]) => {
          for (const r of rows) {
            const keys = Object.keys(r);
            db.prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map((k) => '@' + k).join(', ')})`).run(r);
          }
        };
        insertAll('stages', stages);
        insertAll('companies', companies);
        // A backup from before locations existed: each company's own address becomes its location.
        if (Array.isArray(company_locations)) insertAll('company_locations', company_locations);
        else backfillLocations();
        insertAll('cvs', cvs.map((cv) => ({ ...cv, data: Buffer.from(String(cv.data ?? ''), 'base64') })));
        insertAll('jobs', jobs);
        insertAll('stage_history', stage_history);
        insertAll('contacts', contacts);
        insertAll('job_referrers', job_referrers);
        insertAll('company_logos', company_logos.map((l) => ({ ...l, data: l.data ? Buffer.from(String(l.data), 'base64') : null })));
        insertAll('settings', settings);
        insertAll('quiz_sets', quiz_sets);
        insertAll('quiz_questions', quiz_questions);
        insertAll('quiz_attempts', quiz_attempts);
      })();
      seedStages();
      return res.json({ companies: companies.length, jobs: jobs.length });
    }

    // Merge mode: resolve map links first (async), then write in one transaction.
    const prepared: Row[] = [];
    for (const c of companies) prepared.push(await normalizeCompany(c));

    const result = db.transaction(() => {
      const byName = new Map<string, number>();
      for (const r of db.prepare('SELECT id, name FROM companies').all() as { id: number; name: string }[]) {
        byName.set(r.name.toLowerCase(), r.id);
      }
      const stageByName = new Map<string, number>();
      for (const r of db.prepare('SELECT id, name FROM stages').all() as { id: number; name: string }[]) {
        stageByName.set(r.name.toLowerCase(), r.id);
      }

      let addedCompanies = 0;
      const cols = COMPANY_FIELDS.join(', ');
      const params = COMPANY_FIELDS.map((f) => '@' + f).join(', ');
      const newIds: number[] = [];
      prepared.forEach((c, i) => {
        if (!c.name || byName.has(String(c.name).toLowerCase())) return;
        const info = db.prepare(`INSERT INTO companies (${cols}) VALUES (${params})`).run(c);
        const id = Number(info.lastInsertRowid);
        byName.set(String(c.name).toLowerCase(), id);
        newIds.push(id);
        // Its offices: a "locations" list in the file, else its own address.
        const locs = (companies[i] as Row).locations;
        if (Array.isArray(locs) && locs.length) replaceLocations(id, locs as LocationInput[]);
        else primaryFromCompany(id);
        addedCompanies++;
      });

      let addedJobs = 0;
      const skipped: string[] = [];
      for (const raw of jobs) {
        if (!raw.title) {
          skipped.push('(untitled)');
          continue;
        }
        const companyName = String(raw.company ?? raw.company_name ?? '').trim();
        let companyId = raw.company_id ? Number(raw.company_id) : byName.get(companyName.toLowerCase());
        if (!companyId && companyName) {
          const info = db.prepare('INSERT INTO companies (name) VALUES (?)').run(companyName);
          companyId = Number(info.lastInsertRowid);
          byName.set(companyName.toLowerCase(), companyId);
          addedCompanies++;
        }
        if (!companyId || !raw.title) {
          skipped.push(String(raw.title ?? '(untitled)'));
          continue;
        }
        const stageName = String(raw.stage ?? raw.stage_name ?? '').toLowerCase();
        const j = normalizeJob({
          ...raw,
          company_id: companyId,
          stage_id: raw.stage_id ?? stageByName.get(stageName),
        });
        const jc = JOB_FIELDS.join(', ');
        const jp = JOB_FIELDS.map((f) => '@' + f).join(', ');
        const info = db.prepare(`INSERT INTO jobs (${jc}) VALUES (${jp})`).run(j);
        db.prepare('INSERT INTO stage_history (job_id, stage_id) VALUES (?, ?)').run(info.lastInsertRowid, j.stage_id);
        alignAppliedStep(info.lastInsertRowid);
        addedJobs++;
      }
      return { companies: addedCompanies, jobs: addedJobs, skipped };
    })();

    queueLogos(missingLogoIds());
    queueGeocoding();
    res.json(result);
  }),
);

// ---------- Errors ----------

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

// Once: jobs logged before applied dates and steps were linked get their Applied step moved to the applied date.
if (!db.prepare(`SELECT 1 FROM settings WHERE key = 'applied_steps_aligned'`).get()) {
  db.transaction(() => {
    for (const { id } of db.prepare('SELECT id FROM jobs WHERE applied_date IS NOT NULL').all() as { id: number }[]) alignAppliedStep(id);
    db.prepare(`INSERT INTO settings (key, value) VALUES ('applied_steps_aligned', '1')`).run();
  })();
}

// Applications saved earlier with a LinkedIn job link but no description.
for (const { id } of db
  .prepare(
    `SELECT id FROM jobs WHERE (description IS NULL OR trim(description) = '')
       AND (url LIKE '%linkedin.com%' OR apply_contact LIKE '%linkedin.com%' OR url LIKE '%workable.com%' OR apply_contact LIKE '%workable.com%')`,
  )
  .all() as { id: number }[])
  queueDescriptionFill(id);

// A brand-new install starts with the starter companies (their logos that weren't bundled are fetched after).
if (loadDefaultsOnFirstRun().length) queueLogos(missingLogoIds());

// Offices with an address but no pin yet (from a LinkedIn import that was interrupted, say).
queueGeocoding();

// Ghost stale applications now; check open applications' LinkedIn postings a minute after start; both twice a day.
ghostStaleApplications();
setTimeout(() => void checkClosedPostings(), 60_000);
setInterval(() => {
  ghostStaleApplications();
  void checkClosedPostings();
}, 12 * 60 * 60 * 1000);

const PORT = Number(process.env.PORT ?? 3001);
app.listen(PORT, () => console.log(`API listening on http://localhost:${PORT}`));

