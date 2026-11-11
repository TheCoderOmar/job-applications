// "Refresh from LinkedIn" for all companies: re-read each company's LinkedIn page in the background,
// fill in details that are still empty, and add the offices it lists that the company doesn't have yet.
import { db } from './db.js';
import { addLocations } from './companyLocations.js';
import { canonicalCompanyUrl, type LinkedInCompany } from './linkedin.js';

export interface RefreshDeps {
  fetchCompany: (url: string) => Promise<LinkedInCompany>;
  /** A company with only a name or a LinkedIn search link: its real page, or null. */
  findPage: (name: string, country: string | null) => Promise<string | null>;
  /** Called when a company's LinkedIn link was found or changed (so its logo can be fetched). */
  onNewLink?: (id: number) => void;
  delayMs?: number;
}

export const refreshState = {
  running: false,
  total: 0,
  done: 0,
  /** Companies that got new details or offices. */
  updated: 0,
  locations_added: 0,
  /** No LinkedIn page found for them. */
  no_page: 0,
  failed: 0,
  current: null as string | null,
  error: null as string | null,
};

// Details taken from LinkedIn only where the company has none yet (what you typed is kept).
const FILL = ['website', 'industry', 'company_size', 'founded', 'headquarters', 'description'] as const;

type Result = { status: 'updated' | 'unchanged' | 'no_page' | 'failed'; locations: number; error?: string };

/** One company. Never overwrites what's already filled in. */
export async function refreshCompany(id: number, deps: RefreshDeps): Promise<Result> {
  const c = db.prepare('SELECT * FROM companies WHERE id = ?').get(id) as Record<string, string | null> | undefined;
  if (!c) return { status: 'failed', locations: 0, error: 'gone' };
  let link = c.linkedin ? canonicalCompanyUrl(c.linkedin) : null;
  if (!link) {
    link = await deps.findPage(String(c.name), c.country).catch(() => null);
    if (!link) return { status: 'no_page', locations: 0 };
    db.prepare('UPDATE companies SET linkedin = ? WHERE id = ?').run(link, id);
    deps.onNewLink?.(id);
  }
  let li: LinkedInCompany;
  try {
    li = await deps.fetchCompany(link);
  } catch (e) {
    return { status: 'failed', locations: 0, error: (e as Error).message };
  }
  let changed = 0;
  for (const f of FILL) {
    const v = li[f];
    if (v && !String(c[f] ?? '').trim()) changed += db.prepare(`UPDATE companies SET ${f} = ? WHERE id = ?`).run(v, id).changes;
  }
  const added = li.locations.length ? addLocations(id, li.locations) : 0;
  return { status: changed || added ? 'updated' : 'unchanged', locations: added };
}

/**
 * Refreshes the given companies (default: all) one at a time, a few seconds apart to be gentle with LinkedIn.
 * Stops early if LinkedIn keeps refusing (5 refusals in a row), and says so.
 */
export function refreshCompanies(deps: RefreshDeps, ids?: number[]) {
  if (refreshState.running) return false;
  const list = ids?.length
    ? ids
    : (db.prepare('SELECT id FROM companies ORDER BY name COLLATE NOCASE').all() as { id: number }[]).map((r) => r.id);
  Object.assign(refreshState, { running: true, total: list.length, done: 0, updated: 0, locations_added: 0, no_page: 0, failed: 0, current: null, error: null });
  void (async () => {
    let failedInRow = 0;
    try {
      for (const id of list) {
        refreshState.current = (db.prepare('SELECT name FROM companies WHERE id = ?').get(id) as { name: string } | undefined)?.name ?? null;
        const r = await refreshCompany(id, deps);
        refreshState.done++;
        refreshState.locations_added += r.locations;
        if (r.status === 'updated') refreshState.updated++;
        if (r.status === 'no_page') refreshState.no_page++;
        if (r.status === 'failed') {
          refreshState.failed++;
          // A wrong link (404) is that company's problem; only LinkedIn refusing (rate limit, login page) stops the run.
          const refused = !/no company page/i.test(r.error ?? '');
          if (refused && ++failedInRow >= 5) {
            refreshState.error = `LinkedIn stopped answering (${r.error}). Try again later; companies already done keep their updates.`;
            break;
          }
        } else failedInRow = 0;
        await new Promise((res) => setTimeout(res, deps.delayMs ?? 2500));
      }
    } finally {
      refreshState.running = false;
      refreshState.current = null;
    }
  })();
  return true;
}
