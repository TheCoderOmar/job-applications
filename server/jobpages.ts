// Job pages from Indeed, Wuzzuf and Workable's job search (jobs.workable.com).
// Indeed and Wuzzuf block the app (bot checks), so the browser extension sends the page you have open;
// jobs.workable.com pages the app can fetch itself. All three embed a schema.org JobPosting.

import { get, htmlToText, text, type LinkedInJob } from './openings.js';

export type JobBoard = 'indeed' | 'wuzzuf' | 'workable';
export type ImportedJob = LinkedInJob & { source: JobBoard };

/** Which board a job link is on: an Indeed job (?jk= / ?vjk=), a Wuzzuf job (/jobs/p/…), a jobs.workable.com job (/view/…). */
export function jobBoard(url: string | null | undefined): JobBoard | null {
  const u = String(url ?? '');
  if (/^https?:\/\/(?:[a-z]+\.)?indeed\.com\//i.test(u) && /[?&]v?jk=[0-9a-f]{8,}/i.test(u)) return 'indeed';
  if (/^https?:\/\/(?:www\.)?wuzzuf\.net\/jobs\/p\//i.test(u)) return 'wuzzuf';
  if (/^https?:\/\/jobs\.workable\.com\/view\//i.test(u)) return 'workable';
  return null;
}

/** The job's own link without tracking: eg.indeed.com/?vjk=X&r=us → eg.indeed.com/viewjob?jk=X; others lose their query. */
export function cleanJobUrl(url: string): string {
  const board = jobBoard(url);
  if (!board) return url;
  const u = new URL(url);
  if (board === 'indeed') return `${u.origin}/viewjob?jk=${u.searchParams.get('jk') ?? u.searchParams.get('vjk')}`;
  return `${u.origin}${u.pathname}`;
}

const SITE: Record<JobBoard, string> = { indeed: 'Indeed', wuzzuf: 'Wuzzuf', workable: 'Workable' };

/** The JobPosting objects embedded in a page (ld+json, also inside @graph). */
function jobPostings(html: string): any[] { // eslint-disable-line @typescript-eslint/no-explicit-any
  const out: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const walk = (v: any): void => { // eslint-disable-line @typescript-eslint/no-explicit-any
      if (Array.isArray(v)) return v.forEach(walk);
      if (!v || typeof v !== 'object') return;
      if (v['@graph']) walk(v['@graph']);
      const type = Array.isArray(v['@type']) ? v['@type'] : [v['@type']];
      if (type.includes('JobPosting')) out.push(v);
    };
    walk(data);
  }
  return out;
}

const regionName = (code: string) => {
  try {
    return /^[A-Z]{2}$/i.test(code) ? (new Intl.DisplayNames(['en'], { type: 'region' }).of(code.toUpperCase()) ?? code) : code;
  } catch {
    return code;
  }
};

/** "Heliopolis, Cairo, Egypt" from a schema.org address (country codes become names). */
function placeName(address: any): string | null { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!address || typeof address !== 'object') return null;
  const country = address.addressCountry?.name ?? address.addressCountry;
  const parts = [address.addressLocality, address.addressRegion, country ? regionName(String(country)) : null]
    .map((p) => (p ? text(String(p)) : ''))
    .filter(Boolean);
  return [...new Set(parts)].join(', ') || null;
}

const EMPLOYMENT: Record<string, string> = {
  FULL_TIME: 'Full-time',
  PART_TIME: 'Part-time',
  CONTRACTOR: 'Contract',
  TEMPORARY: 'Temporary',
  INTERN: 'Internship',
  VOLUNTEER: 'Volunteer',
  PER_DIEM: 'Per diem',
};

/** Wuzzuf's "Experience Needed: 0 to 2 years", "Career Level: …" boxes. */
function wuzzufDetails(html: string): Record<string, string> {
  const pieces = html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '')
    .split(/<[^>]+>/)
    .map((p) => text(p))
    .filter(Boolean);
  const out: Record<string, string> = {};
  for (const label of ['Experience Needed', 'Career Level', 'Education Level', 'Salary']) {
    const i = pieces.indexOf(`${label}:`);
    const value = i >= 0 ? pieces[i + 1] : undefined;
    if (value && !value.endsWith(':')) out[label] = value;
  }
  return out;
}

/** Indeed's job panel when a page has no JobPosting (search page with a job open on the right). */
function indeedPanel(html: string): { title: string | null; company: string | null; description: string | null } {
  const title = /data-testid="vj-job-title"[^>]*>([\s\S]*?)<\/h\d>/.exec(html)?.[1];
  const company = /data-testid="company-info-metadata"[\s\S]*?<a\b[^>]*>([^<]+)/.exec(html)?.[1];
  const desc = /simple-job-description-html"[^>]*>([\s\S]*?)<div[^>]*data-testid="vj-rcv-flag-sentinel-jobDescriptionSeen"/.exec(html)?.[1];
  return {
    title: title ? text(title) || null : null,
    company: company ? text(company) || null : null,
    description: desc ? htmlToText(desc.replace(/<style[\s\S]*?<\/style>/gi, '')) || null : null,
  };
}

/** Remote / hybrid / on-site from the posting, or from the location, title and start of the text. */
function workplaceOf(board: JobBoard, html: string, posting: any, hay: string): LinkedInJob['workplace'] { // eslint-disable-line @typescript-eslint/no-explicit-any
  if ([].concat(posting?.jobLocationType ?? []).includes('TELECOMMUTE' as never)) return 'remote';
  if (board === 'wuzzuf') {
    // The job card links its workplace: wuzzuf.net/a/On-Site-Jobs-in-Egypt, …/Hybrid-Jobs-in-…, …/Remote-Jobs-in-…
    const w = /wuzzuf\.net\/a\/(On-Site|Hybrid|Remote)-Jobs-in-/i.exec(html)?.[1]?.toLowerCase();
    if (w) return w === 'on-site' ? 'onsite' : (w as 'hybrid' | 'remote');
  }
  const h = hay.toLowerCase();
  return /\bhybrid\b/.test(h) ? 'hybrid' : /\bremote\b/.test(h) ? 'remote' : /\bon-?site\b/.test(h) ? 'onsite' : null;
}

/** A saved/sent job page → the same shape as a LinkedIn job, so the form treats them all alike. */
export function parseJobPage(html: string, url: string, now = new Date()): ImportedJob {
  const board = jobBoard(url);
  if (!board) throw new Error('That is not an Indeed, Wuzzuf or Workable job link.');
  const p = jobPostings(html).find((j) => j.title) ?? null;
  const panel = p ? null : board === 'indeed' ? indeedPanel(html) : null;

  const title = p ? text(String(p.title)) || null : (panel?.title ?? null);
  const company = p?.hiringOrganization?.name ? text(String(p.hiringOrganization.name)) : (panel?.company ?? null);
  const sections = p
    ? [
        htmlToText(String(p.description ?? '')),
        p.requirementsSection && htmlToText(String(p.requirementsSection)),
        p.benefitsSection && htmlToText(String(p.benefitsSection)),
      ]
    : [panel?.description];
  const description = sections.filter(Boolean).join('\n\n') || null;
  if (!title && !description) throw new Error(`Could not find the job on that ${SITE[board]} page.`);

  const places = [].concat(p?.jobLocation ?? []).map((l: any) => placeName(l?.address)).filter(Boolean); // eslint-disable-line @typescript-eslint/no-explicit-any
  const applicantCountry = p?.applicantLocationRequirements?.name;
  const location = places.length ? [...new Set(places)].join(' · ') : applicantCountry ? text(String(applicantCountry)) : null;

  const details: Record<string, string> = {};
  const types = [].concat(p?.employmentType ?? []).map((t: string) => EMPLOYMENT[t] ?? t);
  if (types.length) details['Employment type'] = types.join(', ');
  if (location) details.Location = location;
  if (board === 'wuzzuf') Object.assign(details, wuzzufDetails(html));

  const validThrough = p?.validThrough ? new Date(p.validThrough) : null;
  return {
    source: board,
    title,
    company,
    company_linkedin: null,
    location,
    description,
    workplace: workplaceOf(board, html, p, `${location ?? ''} ${title ?? ''} ${description?.slice(0, 600) ?? ''}`),
    details,
    closed: !!validThrough && !Number.isNaN(+validThrough) && validThrough < now,
  };
}

/** jobs.workable.com/view/… can be read without the extension. */
export async function fetchWorkableSearchJob(url: string): Promise<ImportedJob> {
  const res = await get(cleanJobUrl(url));
  if (res.status === 404) throw new Error('Workable has no job at that link (it may have been removed).');
  if (!res.ok) throw new Error(`Workable did not answer (status ${res.status}).`);
  return parseJobPage(await res.text(), url);
}

/** Why a pasted Indeed/Wuzzuf link can't be read here. */
export const needsExtension = (board: JobBoard) =>
  `${SITE[board]} blocks the app from reading its pages. Open the job in your browser and click the Job Tracker extension.`;

// Pages sent by the extension, kept briefly until its window asks for them.
// `data` is what the extension read from the page itself (LinkedIn location cards, a profile's top card…).
const pages = new Map<string, { url: string; html: string; data?: unknown; at: number }>();
const PAGE_TTL = 30 * 60 * 1000;

export function keepPage(url: string, html: string, now = Date.now(), data?: unknown): string {
  for (const [id, p] of pages) if (now - p.at > PAGE_TTL) pages.delete(id);
  const id = crypto.randomUUID();
  pages.set(id, data === undefined ? { url, html, at: now } : { url, html, data, at: now });
  return id;
}

export function keptPage(id: string, now = Date.now()): { url: string; html: string; data?: unknown } | null {
  const p = pages.get(id);
  return p && now - p.at <= PAGE_TTL ? p : null;
}
