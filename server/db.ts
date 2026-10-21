import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

// Each person who clones the repo gets their own local data/jobs.db (gitignored). JOBS_DB points elsewhere, e.g. for testing.
const dbPath = process.env.JOBS_DB ? path.resolve(process.env.JOBS_DB) : path.resolve(process.cwd(), 'data', 'jobs.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS stages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#3b82f6',
    sort_order INTEGER NOT NULL DEFAULT 0,
    kind TEXT NOT NULL DEFAULT 'active' CHECK (kind IN ('active','closed_won','closed_lost'))
  );

  CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    website TEXT,
    industry TEXT,
    notes TEXT,
    is_remote INTEGER NOT NULL DEFAULT 0,
    address TEXT,
    city TEXT,
    country TEXT,
    lat REAL,
    lng REAL,
    maps_link TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    url TEXT,
    location_type TEXT NOT NULL DEFAULT 'unknown' CHECK (location_type IN ('onsite','hybrid','remote','unknown')),
    salary TEXT,
    stage_id INTEGER NOT NULL REFERENCES stages(id),
    applied_date TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS stage_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    stage_id INTEGER NOT NULL REFERENCES stages(id),
    changed_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs(company_id);  CREATE INDEX IF NOT EXISTS idx_jobs_stage ON jobs(stage_id);
  CREATE INDEX IF NOT EXISTS idx_history_job ON stage_history(job_id);
`);

// Columns added after the first release. Added in place so existing databases keep their data.
const COMPANY_MIGRATIONS: [string, string][] = [
  ['linkedin', 'TEXT'],
  ['careers_url', 'TEXT'],
  ['company_size', 'TEXT'],
  ['founded', 'TEXT'],
  ['headquarters', 'TEXT'],
  ['is_current', 'INTEGER NOT NULL DEFAULT 0'],
  ['description', 'TEXT'],
];
const existing = new Set((db.prepare('PRAGMA table_info(companies)').all() as { name: string }[]).map((c) => c.name));
for (const [col, type] of COMPANY_MIGRATIONS) {
  if (!existing.has(col)) db.exec(`ALTER TABLE companies ADD COLUMN ${col} ${type}`);
}

// Order validated for colorblind-safe adjacent separation on the dark surface (#0b1220).
export const DEFAULT_STAGES: [string, string, string][] = [
  ['Saved', '#3987e5', 'active'],
  ['Applied', '#199e70', 'active'],
  ['Screening', '#c98500', 'active'],
  ['HR interview', '#d55181', 'active'],
  ['Technical interview', '#b46fd8', 'active'],
  ['Shortlisted', '#4c9a2a', 'active'],
  ['Final interview', '#2bb3c0', 'active'],
  ['Offer', '#008300', 'closed_won'],
  ['Rejected', '#e66767', 'closed_lost'],
  ['Withdrawn', '#9085e9', 'closed_lost'],
  ['Ghosted', '#d95926', 'closed_lost'],
];

export function seedStages() {
  const count = (db.prepare('SELECT COUNT(*) AS n FROM stages').get() as { n: number }).n;
  if (count > 0) return;
  const insert = db.prepare('INSERT INTO stages (name, color, sort_order, kind) VALUES (?, ?, ?, ?)');
  db.transaction(() => {
    DEFAULT_STAGES.forEach(([name, color, kind], i) => insert.run(name, color, i, kind));
  })();
}

seedStages();

// ---------- Apply channel, contacts, referrers ----------

const jobCols = new Set((db.prepare('PRAGMA table_info(jobs)').all() as { name: string }[]).map((c) => c.name));
if (!jobCols.has('apply_channel')) db.exec(`ALTER TABLE jobs ADD COLUMN apply_channel TEXT`);
if (!jobCols.has('apply_contact')) db.exec(`ALTER TABLE jobs ADD COLUMN apply_contact TEXT`);

db.exec(`
  CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    company TEXT,
    position TEXT,
    linkedin_url TEXT,
    email TEXT,
    connected_on TEXT,
    source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('linkedin_import','manual')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_url ON contacts(linkedin_url) WHERE linkedin_url IS NOT NULL;

  CREATE TABLE IF NOT EXISTS job_referrers (
    job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 3),
    PRIMARY KEY (job_id, slot)
  );
  CREATE INDEX IF NOT EXISTS idx_referrers_contact ON job_referrers(contact_id);
`);

// ---------- Starred jobs, company logos ----------

if (!jobCols.has('starred')) db.exec(`ALTER TABLE jobs ADD COLUMN starred INTEGER NOT NULL DEFAULT 0`);

db.exec(`
  CREATE TABLE IF NOT EXISTS company_logos (
    company_id INTEGER PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
    data BLOB,
    mime TEXT,
    -- 'found' or 'none' (looked and found nothing, so we don't keep retrying)
    status TEXT NOT NULL DEFAULT 'found',
    fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

/**
 * Older databases have one "Interview" stage. Split it into HR, technical and final interview
 * so "HR interview, then ghosted" can be told apart from "technical interview, then ghosted".
 * Runs once; jobs in "Interview" keep their stage, which becomes "Final interview".
 */
function splitInterviewStage() {
  const done = db.prepare(`SELECT 1 FROM settings WHERE key = 'interview_stages_split'`).get();
  if (done) return;
  const stages = db.prepare('SELECT id, name, sort_order FROM stages ORDER BY sort_order, id').all() as {
    id: number;
    name: string;
    sort_order: number;
  }[];
  const has = (n: string) => stages.some((s) => s.name.toLowerCase() === n);
  const interview = stages.find((s) => s.name.toLowerCase() === 'interview');
  db.transaction(() => {
    if (interview && !has('hr interview') && !has('technical interview')) {
      db.prepare('UPDATE stages SET sort_order = sort_order + 2 WHERE sort_order >= ?').run(interview.sort_order);
      const insert = db.prepare(`INSERT INTO stages (name, color, sort_order, kind) VALUES (?, ?, ?, 'active')`);
      insert.run('HR interview', '#d55181', interview.sort_order);
      insert.run('Technical interview', '#b46fd8', interview.sort_order + 1);
      db.prepare(`UPDATE stages SET name = 'Final interview', color = '#2bb3c0' WHERE id = ?`).run(interview.id);
    }
    db.prepare(`INSERT INTO settings (key, value) VALUES ('interview_stages_split', '1')`).run();
  })();
}
splitInterviewStage();

// ---------- Conversations (from LinkedIn messages.csv) and job openings ----------

const contactCols = new Set((db.prepare('PRAGMA table_info(contacts)').all() as { name: string }[]).map((c) => c.name));
for (const [col, type] of [
  ['conversations', 'INTEGER NOT NULL DEFAULT 0'],
  ['messages', 'INTEGER NOT NULL DEFAULT 0'],
  ['messages_from_them', 'INTEGER NOT NULL DEFAULT 0'],
  ['last_message_at', 'TEXT'],
] as const) {
  if (!contactCols.has(col)) db.exec(`ALTER TABLE contacts ADD COLUMN ${col} ${type}`);
}

const companyCols2 = new Set((db.prepare('PRAGMA table_info(companies)').all() as { name: string }[]).map((c) => c.name));
for (const [col, type] of [
  ['linkedin_id', 'TEXT'],
  ['careers_found_url', 'TEXT'],
  ['openings_scanned_at', 'TEXT'],
  ['openings_note', 'TEXT'],
] as const) {
  if (!companyCols2.has(col)) db.exec(`ALTER TABLE companies ADD COLUMN ${col} ${type}`);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS openings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    source TEXT NOT NULL CHECK (source IN ('linkedin','website')),
    external_id TEXT NOT NULL,
    title TEXT NOT NULL,
    location TEXT,
    url TEXT,
    posted_at TEXT,
    first_seen TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen TEXT NOT NULL DEFAULT (datetime('now')),
    -- set when a scan no longer finds it
    closed_at TEXT,
    starred INTEGER NOT NULL DEFAULT 0,
    hidden INTEGER NOT NULL DEFAULT 0,
    -- the application you logged from it
    job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
    UNIQUE (company_id, source, external_id)
  );
  CREATE INDEX IF NOT EXISTS idx_openings_company ON openings(company_id);
`);

// Marked by hand ("I talked to this person"), for conversations outside LinkedIn messages. Re-importing messages keeps it.
if (!(db.prepare('PRAGMA table_info(contacts)').all() as { name: string }[]).some((c) => c.name === 'talked_at'))
  db.exec(`ALTER TABLE contacts ADD COLUMN talked_at TEXT`);

/** Adds a "Shortlisted" stage right after "Technical interview" (once; skipped if you already have one). */
function addShortlistedStage() {
  if (db.prepare(`SELECT 1 FROM settings WHERE key = 'shortlisted_stage_added'`).get()) return;
  db.transaction(() => {
    const has = db.prepare(`SELECT 1 FROM stages WHERE lower(name) = 'shortlisted'`).get();
    const tech = db.prepare(`SELECT sort_order FROM stages WHERE lower(name) = 'technical interview'`).get() as
      | { sort_order: number }
      | undefined;
    if (!has && tech) {
      db.prepare('UPDATE stages SET sort_order = sort_order + 1 WHERE sort_order > ?').run(tech.sort_order);
      db.prepare(`INSERT INTO stages (name, color, sort_order, kind) VALUES ('Shortlisted', '#4c9a2a', ?, 'active')`).run(tech.sort_order + 1);
    }
    db.prepare(`INSERT INTO settings (key, value) VALUES ('shortlisted_stage_added', '1')`).run();
  })();
}
addShortlistedStage();

/**
 * Lets a job's work type be "unknown". SQLite can't change a CHECK in place, so the jobs table is
 * rebuilt once from its own current definition (keeps every column added since), with foreign keys
 * paused so stage history, referrers and openings keep pointing at the same job ids.
 */
function allowUnknownWorkType() {
  const row = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'jobs'`).get() as { sql: string };
  if (row.sql.includes("'unknown'")) return;
  const newSql = row.sql
    .replace(/CREATE TABLE\s+"?jobs"?/, 'CREATE TABLE jobs_new')
    .replace(/CHECK\s*\(\s*location_type IN \('onsite',\s*'hybrid',\s*'remote'\)\s*\)/, "CHECK (location_type IN ('onsite','hybrid','remote','unknown'))");
  if (!newSql.includes("'unknown'")) throw new Error('Could not update the jobs table definition.');
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.exec(newSql);
      db.exec('INSERT INTO jobs_new SELECT * FROM jobs');
      db.exec('DROP TABLE jobs');
      db.exec('ALTER TABLE jobs_new RENAME TO jobs');
      db.exec('CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs(company_id); CREATE INDEX IF NOT EXISTS idx_jobs_stage ON jobs(stage_id);');
      const broken = db.pragma('foreign_key_check') as unknown[];
      if (broken.length) throw new Error('Foreign keys broken after rebuilding jobs.');
    })();
  } finally {
    db.pragma('foreign_keys = ON');
  }
}
allowUnknownWorkType();
