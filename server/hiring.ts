// "How does this company hire?": its careers page, the hiring system behind it (Workday, Greenhouse, Taleo…),
// a careers email, or Wuzzuf. Found from the company's website: careers links on the homepage, the usual
// careers addresses (/careers, careers.<domain>…) and job-system links on those pages.
import { get } from './openings.js';

/** Hiring systems (ATS) and job sites, recognised from a link's address. First match wins. */
const SYSTEMS: [name: string, re: RegExp][] = [
  ['Workday', /(^|\.)myworkday(jobs|site)\.com$/],
  ['Greenhouse', /(^|\.)greenhouse\.io$/],
  ['Lever', /(^|\.)lever\.co$/],
  ['SmartRecruiters', /(^|\.)smartrecruiters\.com$/],
  ['Workable', /(^|\.)workable\.com$/],
  ['Ashby', /(^|\.)ashbyhq\.com$/],
  ['Recruitee', /(^|\.)recruitee\.com$/],
  ['BambooHR', /(^|\.)bamboohr\.com$/],
  ['Oracle Cloud', /(^|\.)oraclecloud\.com$/],
  ['Taleo', /(^|\.)taleo\.net$/],
  ['SuccessFactors', /(^|\.)(successfactors\.(com|eu)|sapsf\.(com|eu))$|^jobs\.sap\.com$/],
  ['iCIMS', /(^|\.)icims\.com$/],
  ['Jobvite', /(^|\.)jobvite\.com$/],
  ['Teamtailor', /(^|\.)teamtailor\.com$/],
  ['Zoho Recruit', /(^|\.)zohorecruit\.(com|eu|in)$/],
  ['Breezy', /(^|\.)breezy\.hr$/],
  ['Personio', /(^|\.)personio\.(de|com)$/],
  ['JazzHR', /(^|\.)applytojob\.com$/],
  ['Freshteam', /(^|\.)freshteam\.com$/],
  ['Manatal', /(^|\.)careers-page\.com$/],
  ['Pinpoint', /(^|\.)pinpointhq\.com$/],
  ['Comeet', /(^|\.)comeet\.(com|co)$/],
  ['Avature', /(^|\.)avature\.net$/],
  ['Cornerstone', /(^|\.)csod\.com$/],
  ['BrassRing', /(^|\.)brassring\.com$/],
  ['ADP', /(^|\.)workforcenow\.adp\.com$/],
  ['Dayforce', /(^|\.)dayforcehcm\.com$/],
  ['PageUp', /(^|\.)pageuppeople\.com$/],
  ['Eightfold', /(^|\.)eightfold\.ai$/],
  ['JOIN', /^join\.com$/],
  ['Bayt', /(^|\.)bayt\.com$/],
  ['Wuzzuf', /(^|\.)wuzzuf\.net$/],
  ['Google Form', /^(docs\.google\.com|forms\.gle)$/],
  ['Microsoft Form', /^forms\.(office|microsoft)\.com$/],
];

/** The hiring system a link belongs to ("Workday"), or null. Google/Microsoft links count only when they're forms. */
export function systemOf(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const h = u.hostname.toLowerCase();
  if (h === 'docs.google.com' && !u.pathname.startsWith('/forms')) return null;
  if (h === 'wuzzuf.net' && !/^\/jobs\/careers\//.test(u.pathname)) return null;
  if (h.endsWith('bayt.com') && !/\/company\/|\/jobs\//.test(u.pathname)) return null;
  if (h.endsWith('oraclecloud.com') && !/\/hcmUI\//i.test(u.pathname)) return null;
  return SYSTEMS.find(([, re]) => re.test(h))?.[0] ?? null;
}

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&#x2F;/gi, '/').replace(/&#47;/g, '/');
const CAREERS_WORDS = /career|jobs?\b|vacanc|join[- ]?(us|our)|work[- ](with|for)[- ]us|we.?re hiring|opportunit|recruit|talent|وظائف|الوظائف|انضم|توظيف/i;
const HIRING_MAIL = /^(hr|careers?|jobs?|recruit\w*|talent\w*|hiring|cv|resumes?|people|join|employment|vacanc\w*|hr\.\w+|\w+\.hr)$/i;

/** Every link on a page, absolute, with its text. */
function linksOf(html: string, base: string): { href: string; label: string }[] {
  const out: { href: string; label: string }[] = [];
  for (const m of html.matchAll(/<a\b[^>]*?href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const raw = decode(m[1].trim());
    const label = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (/^(tel|javascript):/i.test(raw)) continue;
    if (/^mailto:/i.test(raw)) {
      out.push({ href: raw, label });
      continue;
    }
    try {
      out.push({ href: new URL(raw, base).toString(), label });
    } catch {
      /* bad link */
    }
  }
  return out;
}

/** A careers email on the page (hr@, careers@, jobs@…), from mailto links or plain text. */
export function hiringEmail(html: string): string | null {
  const found = [
    ...[...html.matchAll(/mailto:([^"'?\s>]+)/gi)].map((m) => decodeURIComponent(m[1])),
    ...[...html.matchAll(/\b([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})\b/gi)].map((m) => m[1]),
  ];
  return found.map((e) => e.toLowerCase()).find((e) => HIRING_MAIL.test(e.split('@')[0]) && !/\.(png|jpe?g|gif|svg|webp)$/.test(e)) ?? null;
}

/** Links that look like the careers page (by their text or address), same site or a hiring system. */
export function careersLinks(html: string, base: string): string[] {
  const root = rootOf(base);
  const scored = new Map<string, number>();
  for (const { href, label } of linksOf(html, base)) {
    if (/^mailto:/i.test(href)) continue;
    // Their own site (any subdomain) or a hiring system; a LinkedIn or Facebook "jobs" link isn't a careers page.
    const own = root !== null && rootOf(href) === root;
    if (!systemOf(href) && !(own && (CAREERS_WORDS.test(label) || CAREERS_WORDS.test(new URL(href).pathname)))) continue;
    const url = cleanUrl(href);
    const s = linkScore(url, label);
    if (s > -3 && s > (scored.get(url) ?? -Infinity)) scored.set(url, s);
  }
  return [...scored].sort((a, b) => b[1] - a[1]).map(([u]) => u);
}

/** Pages about careers that aren't the careers page: news, stories, student programmes, fraud warnings… */
const SIDE_PAGE = /news|blog|article|press-|case-?stud|award|fraud|scam|safety|student|graduate|internship|interns?|apprentice|early-career|meet-our|life-at|benefit|career-(path|area|in-)|stor(y|ies)|event|webinar|insight|podcast|career-development/i;

/** How much a link looks like *the* careers page: "Careers" / "Jobs" labels and short /careers paths win. */
function linkScore(url: string, label: string): number {
  let s = 0;
  if (systemOf(url)) s += 3;
  if (/^(careers?|jobs|join( us| our team)?|work with us|vacancies|we.?re hiring|open (positions|roles)|الوظائف|وظائف|انضم إلينا)$/i.test(label.trim())) s += 4;
  else if (CAREERS_WORDS.test(label)) s += 2;
  const path = new URL(url).pathname;
  if (/\/(careers?|jobs|join-us|vacancies|employment)\/?$/i.test(path) || /^(careers?|jobs)\./i.test(new URL(url).hostname)) s += 3;
  s -= path.split('/').filter(Boolean).length * 0.5;
  if (SIDE_PAGE.test(path)) s -= 6;
  return s;
}

/** "https://x.com/en/careers/technology" → "https://x.com/en/careers"; null when the page is already the section's top. */
export function careersRoot(url: string): string | null {
  try {
    const u = new URL(url);
    const seg = u.pathname.split('/').filter(Boolean);
    const at = seg.findIndex((p) => /^(careers?|jobs|join-us|vacancies)(\.[a-z]+)?$/i.test(p));
    if (at < 0 || at === seg.length - 1) return null;
    return `${u.origin}/${seg.slice(0, at + 1).join('/')}`;
  } catch {
    return null;
  }
}

/** Drops tracking bits (?utm_…, ?icid=, ?tab=) and a trailing slash. */
function cleanUrl(href: string): string {
  try {
    const u = new URL(href);
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|icid$|gclid$|fbclid$|tab$|ref$|src$)/i.test(k)) u.searchParams.delete(k);
    return u.toString().replace(/\/+$/, '').replace(/\/\?/, '?');
  } catch {
    return href;
  }
}

/** "https://careers.www.acme.com.eg/x" → "acme.com.eg" (the last two labels, three for country domains like .com.eg). */
function rootOf(url: string): string | null {
  try {
    const parts = new URL(url).hostname.toLowerCase().replace(/^www\./, '').split('.');
    const n = parts.length >= 3 && /^(com|co|net|org|gov|edu|ac)$/.test(parts[parts.length - 2]) ? 3 : 2;
    return parts.slice(-n).join('.');
  } catch {
    return null;
  }
}

/** Hiring-system links on a page (an embedded Workday board, an "Apply" link to Taleo…). */
export function systemLinks(html: string, base: string): { url: string; system: string }[] {
  const out = new Map<string, string>();
  for (const { href } of linksOf(html, base)) {
    const s = systemOf(href);
    if (s && !out.has(href)) out.set(href, s);
  }
  // Boards are often embedded in an iframe or a script, not linked.
  for (const m of html.matchAll(/(?:src|data-url|href)\s*=\s*["'](https?:\/\/[^"']+)["']/gi)) {
    const s = systemOf(decode(m[1]));
    if (s && !out.has(m[1])) out.set(decode(m[1]), s);
  }
  return [...out].map(([url, system]) => ({ url, system })).filter((l) => !/\.(js|css|png|svg|jpg)(\?|$)/i.test(l.url));
}

export interface HiringInfo {
  /** The careers page, or the hiring system's job list when there's no page of their own. */
  careers_url: string | null;
  /** How they hire: a hiring system ("Workday"), "Careers page", "Email" or "Wuzzuf"; null when nothing was found. */
  via: string | null;
  email: string | null;
  note: string;
}

type Fetch = (url: string) => Promise<{ ok: boolean; url: string; text: () => Promise<string> }>;

/** The usual places a careers page lives on a site. */
function guesses(site: URL): string[] {
  const root = site.hostname.replace(/^www\./, '');
  const o = site.origin;
  return [`${o}/careers`, `${o}/en/careers`, `${o}/jobs`, `${o}/join-us`, `${o}/career`, `https://careers.${root}`, `https://jobs.${root}`];
}

const looksLikeCareers = (url: string, html: string) => {
  let path = '';
  let host = '';
  try {
    ({ pathname: path, hostname: host } = new URL(url));
  } catch {
    return false;
  }
  if (systemOf(url)) return true;
  if (/^(careers?|jobs)\./i.test(host)) return true;
  if (SIDE_PAGE.test(path)) return false;
  if (CAREERS_WORDS.test(path)) return true;
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '';
  return CAREERS_WORDS.test(title);
};

/**
 * Looks for how a company hires. Fetches at most `budget` pages: the careers page you saved, the homepage,
 * careers links on it, then the usual careers addresses. Never throws.
 */
export async function findHiring(
  c: { website: string | null; careers_url?: string | null; careers_found_url?: string | null; wuzzuf?: string | null },
  fetchPage: Fetch = get,
  budget = 8,
): Promise<HiringInfo> {
  const fix = (u: string) => (/^https?:\/\//i.test(u) ? u : `https://${u}`);
  let site: URL | null = null;
  try {
    site = c.website ? new URL(fix(c.website.trim())) : null;
  } catch {
    site = null;
  }
  const queue: string[] = [];
  const add = (u: string | null | undefined, front = false) => {
    if (!u) return;
    const v = fix(u.trim()).replace(/\/+$/, '');
    if (!queue.includes(v)) front ? queue.unshift(v) : queue.push(v);
  };
  add(c.careers_url);
  add(c.careers_found_url);
  if (site) add(site.toString());

  const seen = new Set<string>();
  let careersPage: string | null = null;
  let system: { url: string; system: string } | null = null;
  let email: string | null = null;
  let homeAnswered = false;
  let guessed = false;

  while (queue.length && seen.size < budget) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    const sys = systemOf(url);
    if (sys && !system) system = { url, system: sys };
    let res: Awaited<ReturnType<Fetch>>;
    try {
      res = await fetchPage(url);
    } catch {
      continue;
    }
    if (!res.ok) continue;
    const html = await res.text().catch(() => '');
    const finalUrl = res.url || url;
    const isHome = site !== null && url.replace(/\/+$/, '') === site.toString().replace(/\/+$/, '');
    if (isHome) homeAnswered = true;
    // A guessed address that just sends you back to the homepage isn't a careers page.
    const backHome = site !== null && !isHome && new URL(finalUrl).pathname.replace(/\/+$/, '') === '' && new URL(finalUrl).hostname === site.hostname;

    const finalSys = systemOf(finalUrl);
    if (finalSys && !system) system = { url: finalUrl, system: finalSys };
    if (!isHome && !backHome && !careersPage && looksLikeCareers(finalUrl, html)) careersPage = finalUrl;

    const sl = systemLinks(html, finalUrl).filter((l) => l.system !== 'Google Form' || /career|job|cv|apply|recruit/i.test(html));
    if (!system && sl.length && (isHome ? sl.some((l) => !['Wuzzuf', 'Bayt'].includes(l.system)) : true)) system = sl.find((l) => !['Wuzzuf', 'Bayt'].includes(l.system)) ?? sl[0];
    if (!email && (!isHome || CAREERS_WORDS.test(html.slice(0, 200000)))) email = hiringEmail(html);

    // Follow careers links from the homepage and from a careers page (it may link on to the job list).
    // (Added to the front in reverse, so the best link is tried first.)
    if (isHome || (careersPage === finalUrl && !system)) for (const l of careersLinks(html, finalUrl).slice(0, 4).reverse()) add(l, true);
    if (system && careersPage) break;
    // Nothing linked from the homepage: try the usual careers addresses once.
    if (!queue.length && !guessed && site && !careersPage && !system) {
      guessed = true;
      for (const g of guesses(site)) add(g);
    }
  }

  // A page deep inside the careers section (/careers/technology, /careers/bpm-developer.html): use the section's own page.
  const top = careersPage ? careersRoot(careersPage) : null;
  if (top && seen.size < budget + 2) {
    try {
      const res = await fetchPage(top);
      // Only when it's still a careers page (some sites send it back to the homepage).
      const landed = res.url || top;
      if (res.ok && (CAREERS_WORDS.test(new URL(landed).pathname) || /^(careers?|jobs)\./i.test(new URL(landed).hostname))) careersPage = landed;
    } catch {
      /* keep the deeper page */
    }
  }

  const wuzzuf = c.wuzzuf?.trim() || null;
  if (system && !['Wuzzuf', 'Bayt', 'Google Form', 'Microsoft Form'].includes(system.system))
    return { careers_url: careersPage ?? system.url, via: system.system, email, note: `Hires through ${system.system}.` };
  if (careersPage) return { careers_url: careersPage, via: system?.system ?? 'Careers page', email, note: system ? `Careers page, applications through ${system.system}.` : 'Has its own careers page.' };
  if (system) return { careers_url: system.url, via: system.system, email, note: `Hires through ${system.system}.` };
  if (email) return { careers_url: null, via: 'Email', email, note: `Send your CV to ${email}.` };
  if (wuzzuf) return { careers_url: wuzzuf, via: 'Wuzzuf', email: null, note: 'Posts jobs on Wuzzuf.' };
  if (!site) return { careers_url: null, via: null, email: null, note: 'No website saved.' };
  return {
    careers_url: null,
    via: null,
    email: null,
    note: homeAnswered ? 'No careers page found on the website: probably hires through LinkedIn only.' : 'The website did not answer.',
  };
}
