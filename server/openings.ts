// Finds a company's open positions: LinkedIn's public job search, and the company's own careers page.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

export interface FoundOpening {
  external_id: string;
  title: string;
  location: string | null;
  url: string | null;
  posted_at: string | null;
}

const decodeOnce = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
/** LinkedIn sometimes encodes twice ("&amp;amp;"), so decode until nothing changes. */
const decode = (s: string) => {
  for (let i = 0; i < 3; i++) {
    const next = decodeOnce(s);
    if (next === s) break;
    s = next;
  }
  return s;
};
export const text = (html: string) => decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function get(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
    ...init,
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', ...(init.headers ?? {}) },
  });
}

// ---------- LinkedIn ----------

/** LinkedIn answers 429 when asked too fast: wait and retry a few times. */
async function liGet(url: string): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await get(url);
    if (res.status !== 429 || attempt >= 3) return res;
    await sleep(15000 * (attempt + 1));
  }
}

const COUNTRY_NAMES: Record<string, string> = {
  uae: 'United Arab Emirates',
  'u.a.e': 'United Arab Emirates',
  ksa: 'Saudi Arabia',
  'saudi': 'Saudi Arabia',
  uk: 'United Kingdom',
  usa: 'United States',
  us: 'United States',
};

/** "UAE" → "United Arab Emirates"; used as LinkedIn's search location and to filter website results. */
export function countryName(country: string | null | undefined): string | null {
  const t = String(country ?? '').trim();
  if (!t) return null;
  return COUNTRY_NAMES[t.toLowerCase()] ?? t;
}

/** Keeps postings in the company's country (or city). Postings with no place, or "3 Locations", are kept. */
export function inRegion(location: string | null, country: string | null, city: string | null): boolean {
  if (!country && !city) return true;
  const loc = String(location ?? '').toLowerCase();
  if (!loc || /\d+\s+locations?/.test(loc) || /remote|anywhere/.test(loc)) return true;
  const words = [country, countryName(country), city].filter(Boolean).map((w) => String(w).toLowerCase());
  // Short codes too: "EG", "SA", "AE".
  const codes: Record<string, string> = { egypt: 'eg', 'saudi arabia': 'sa', 'united arab emirates': 'ae', jordan: 'jo', kuwait: 'kw', qatar: 'qa' };
  const code = codes[String(countryName(country) ?? '').toLowerCase()];
  return words.some((w) => loc.includes(w)) || (!!code && new RegExp(`(^|[ ,])${code}($|[ ,])`).test(loc));
}

/** The numeric company id LinkedIn uses in job search (f_C=…), read from the public company page. */
export function parseLinkedInCompanyId(html: string): string | null {
  return /f_C=(\d+)/.exec(html)?.[1] ?? /urn:li:(?:fs_normalized_)?company:(\d+)/.exec(html)?.[1] ?? null;
}

/** Job cards from LinkedIn's guest job search (jobs-guest/jobs/api/seeMoreJobPostings/search). */
export function parseLinkedInJobCards(html: string): (FoundOpening & { company: string | null })[] {
  const out: (FoundOpening & { company: string | null })[] = [];
  for (const li of html.split(/<li\b[^>]*>/).slice(1)) {
    const pick = (re: RegExp) => {
      const m = re.exec(li);
      return m ? text(m[1]) || null : null;
    };
    const title = pick(/base-search-card__title[^>]*>([\s\S]*?)<\/h3>/);
    const href = /href="(https:\/\/[^"]*?\/jobs\/view\/[^"?]+)/.exec(li)?.[1];
    const id = /urn:li:jobPosting:(\d+)/.exec(li)?.[1] ?? (href ? /-(\d+)$/.exec(href)?.[1] : undefined);
    if (!title || !id) continue;
    out.push({
      external_id: id,
      title,
      company: pick(/base-search-card__subtitle[^>]*>([\s\S]*?)<\/h4>/),
      location: pick(/job-search-card__location[^>]*>([\s\S]*?)<\/span>/),
      url: href ? `https://www.linkedin.com/jobs/view/${id}` : null,
      posted_at: /datetime="([^"]+)"/.exec(li)?.[1] ?? null,
    });
  }
  return out;
}

/**
 * Finds a company's LinkedIn page from job search when only its name is known:
 * job cards link to the hiring company's page (linkedin.com/company/<slug>).
 */
export async function findLinkedInCompanyPage(
  name: string,
  country: string | null,
  same: (a: string, b: string) => boolean,
): Promise<string | null> {
  const location = encodeURIComponent(countryName(country) ?? 'Worldwide');
  const res = await liGet(
    `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${encodeURIComponent(name)}&location=${location}&start=0`,
  );
  if (!res.ok) return null;
  for (const li of (await res.text()).split(/<li\b[^>]*>/).slice(1)) {
    const sub = /base-search-card__subtitle[^>]*>([\s\S]*?)<\/h4>/.exec(li)?.[1] ?? '';
    const href = /href="(https:\/\/[a-z.]*linkedin\.com\/company\/[^"?]+)/.exec(sub)?.[1];
    if (href && same(text(sub), name)) return href.replace(/^https:\/\/[a-z]+\.linkedin/, 'https://www.linkedin');
  }
  return null;
}

export async function linkedInCompanyId(companyUrl: string): Promise<string | null> {
  const res = await liGet(companyUrl);
  if (!res.ok) return null;
  return parseLinkedInCompanyId(await res.text());
}

/** All public LinkedIn postings for a company id in one country (or worldwide), capped at 200. */
export async function linkedInOpenings(companyId: string, country: string | null): Promise<FoundOpening[]> {
  const seen = new Map<string, FoundOpening>();
  const location = encodeURIComponent(countryName(country) ?? 'Worldwide');
  for (let start = 0; start < 200; start += 10) {
    const res = await liGet(
      `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?f_C=${companyId}&location=${location}&start=${start}`,
    );
    if (res.status === 429) throw new Error('LinkedIn is rate-limiting; try again later.');
    if (!res.ok) break;
    const cards = parseLinkedInJobCards(await res.text());
    if (!cards.length) break;
    for (const { company: _c, ...card } of cards) seen.set(card.external_id, card);
    if (cards.length < 10) break;
    await sleep(1500);
  }
  return [...seen.values()];
}

// ---------- Company websites ----------

/** Job boards with public JSON feeds, recognised from a careers link. */
type Board =
  | { kind: 'greenhouse' | 'lever' | 'smartrecruiters' | 'workable' | 'ashby' | 'recruitee' | 'bamboohr'; slug: string }
  | { kind: 'workday'; host: string; tenant: string; site: string };

export function detectBoard(url: string): Board | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const h = u.hostname.toLowerCase();
  const seg = u.pathname.split('/').filter(Boolean);
  if (/(^|\.)greenhouse\.io$/.test(h)) {
    const slug = u.searchParams.get('for') ?? (seg[0] === 'embed' ? null : seg[0]);
    return slug ? { kind: 'greenhouse', slug } : null;
  }
  if (h === 'jobs.lever.co' || h === 'jobs.eu.lever.co') return seg[0] ? { kind: 'lever', slug: seg[0] } : null;
  if (h === 'jobs.smartrecruiters.com' || h === 'careers.smartrecruiters.com') return seg[0] ? { kind: 'smartrecruiters', slug: seg[0] } : null;
  if (h === 'apply.workable.com') return seg[0] ? { kind: 'workable', slug: seg[0] } : null;
  if (h === 'jobs.ashbyhq.com') return seg[0] ? { kind: 'ashby', slug: seg[0] } : null;
  let m = /^([a-z0-9-]+)\.recruitee\.com$/.exec(h);
  if (m) return { kind: 'recruitee', slug: m[1] };
  m = /^([a-z0-9-]+)\.bamboohr\.com$/.exec(h);
  if (m) return { kind: 'bamboohr', slug: m[1] };
  m = /^([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com$/.exec(h);
  if (m) {
    const site = seg.find((s) => !/^[a-z]{2}-[A-Z]{2}$/.test(s));
    return site ? { kind: 'workday', host: h, tenant: m[1], site } : null;
  }
  return null;
}

const BOARD_RE =
  /https?:\/\/(?:[a-z0-9-]+\.)?(?:boards\.greenhouse\.io|job-boards\.greenhouse\.io|jobs\.(?:eu\.)?lever\.co|jobs\.smartrecruiters\.com|careers\.smartrecruiters\.com|apply\.workable\.com|jobs\.ashbyhq\.com|[a-z0-9-]+\.recruitee\.com|[a-z0-9-]+\.bamboohr\.com|[a-z0-9-]+\.wd\d+\.myworkdayjobs\.com)[^"'\s<>)]*/gi;

async function boardOpenings(b: Board): Promise<FoundOpening[]> {
  const json = async (url: string, init?: RequestInit) => {
    const res = await get(url, { ...init, headers: { Accept: 'application/json', ...(init?.headers ?? {}) } });
    if (!res.ok) throw new Error(`${b.kind} answered ${res.status}`);
    return res.json() as Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  switch (b.kind) {
    case 'greenhouse': {
      const d = await json(`https://boards-api.greenhouse.io/v1/boards/${b.slug}/jobs`);
      return (d.jobs ?? []).map((j: any) => ({
        external_id: String(j.id),
        title: j.title,
        location: j.location?.name ?? null,
        url: j.absolute_url ?? null,
        posted_at: j.updated_at ?? null,
      }));
    }
    case 'lever': {
      const d = await json(`https://api.lever.co/v0/postings/${b.slug}?mode=json`);
      return (d ?? []).map((j: any) => ({
        external_id: j.id,
        title: j.text,
        location: j.categories?.location ?? null,
        url: j.hostedUrl ?? null,
        posted_at: j.createdAt ? new Date(j.createdAt).toISOString() : null,
      }));
    }
    case 'smartrecruiters': {
      const d = await json(`https://api.smartrecruiters.com/v1/companies/${b.slug}/postings?limit=100`);
      return (d.content ?? []).map((j: any) => ({
        external_id: j.id,
        title: j.name,
        location: [j.location?.city, j.location?.country?.toUpperCase()].filter(Boolean).join(', ') || null,
        url: `https://jobs.smartrecruiters.com/${b.slug}/${j.id}`,
        posted_at: j.releasedDate ?? null,
      }));
    }
    case 'workable': {
      const d = await json(`https://apply.workable.com/api/v1/widget/accounts/${b.slug}`);
      return (d.jobs ?? []).map((j: any) => ({
        external_id: j.shortcode,
        title: j.title,
        location: [j.city, j.country].filter(Boolean).join(', ') || null,
        url: j.url ?? j.shortlink ?? null,
        posted_at: j.published_on ?? null,
      }));
    }
    case 'ashby': {
      const d = await json(`https://api.ashbyhq.com/posting-api/job-board/${b.slug}`);
      return (d.jobs ?? []).map((j: any) => ({
        external_id: j.id,
        title: j.title,
        location: j.location ?? null,
        url: j.jobUrl ?? null,
        posted_at: j.publishedAt ?? null,
      }));
    }
    case 'recruitee': {
      const d = await json(`https://${b.slug}.recruitee.com/api/offers/`);
      return (d.offers ?? []).map((j: any) => ({
        external_id: String(j.id),
        title: j.title,
        location: j.location ?? null,
        url: j.careers_url ?? null,
        posted_at: j.published_at ?? null,
      }));
    }
    case 'bamboohr': {
      const d = await json(`https://${b.slug}.bamboohr.com/careers/list`);
      return (d.result ?? []).map((j: any) => ({
        external_id: String(j.id),
        title: j.jobOpeningName,
        location: [j.location?.city, j.location?.state].filter(Boolean).join(', ') || null,
        url: `https://${b.slug}.bamboohr.com/careers/${j.id}`,
        posted_at: null,
      }));
    }
    case 'workday': {
      const out: FoundOpening[] = [];
      for (let offset = 0; offset < 400; offset += 20) {
        const d = await json(`https://${b.host}/wday/cxs/${b.tenant}/${b.site}/jobs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ appliedFacets: {}, limit: 20, offset, searchText: '' }),
        });
        const posts = d.jobPostings ?? [];
        for (const j of posts)
          out.push({
            external_id: j.externalPath ?? j.title,
            title: j.title,
            location: j.locationsText ?? null,
            url: j.externalPath ? `https://${b.host}/${b.site}${j.externalPath}` : null,
            posted_at: null,
          });
        if (posts.length < 20) break;
      }
      return out;
    }
  }
}

/** schema.org JobPosting blocks (many careers pages and ATSs embed them). */
export function parseJobPostingLd(html: string, pageUrl: string): FoundOpening[] {
  const out: FoundOpening[] = [];
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const walk = (v: any): void => {
      if (Array.isArray(v)) return v.forEach(walk);
      if (!v || typeof v !== 'object') return;
      if (v['@graph']) walk(v['@graph']);
      if (v.itemListElement) walk(v.itemListElement.map((i: any) => i.item ?? i));
      const type = Array.isArray(v['@type']) ? v['@type'] : [v['@type']];
      if (type.includes('JobPosting') && v.title) {
        const loc = (Array.isArray(v.jobLocation) ? v.jobLocation[0] : v.jobLocation)?.address;
        const url = v.url ?? pageUrl;
        out.push({
          external_id: String(v.identifier?.value ?? v.identifier ?? url + '#' + v.title),
          title: text(String(v.title)),
          location: loc ? [loc.addressLocality, loc.addressCountry?.name ?? loc.addressCountry].filter(Boolean).join(', ') || null : null,
          url,
          posted_at: v.datePosted ?? null,
        });
      }
    };
    walk(data);
  }
  return out;
}

/** Links on a page that look like a careers/jobs page. */
export function findCareersLinks(html: string, base: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<a\b[^>]*href="([^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = decode(m[1]);
    const label = text(m[2]).toLowerCase();
    if (/^(mailto|tel|javascript):/i.test(href)) continue;
    if (/career|jobs?\b|vacanc|join[- ]?us|work[- ]with[- ]us|we.?re hiring|opportunit|وظائف|انضم/i.test(label + ' ' + href)) {
      try {
        out.push(new URL(href, base).toString());
      } catch {
        /* bad link */
      }
    }
  }
  return [...new Set(out)].slice(0, 5);
}

export interface WebsiteResult {
  openings: FoundOpening[];
  careersUrl: string | null;
  note: string;
}

/** Careers page (given or found from the homepage) → job board feed or JobPosting markup. */
export async function websiteOpenings(c: {
  website: string | null;
  careers_url: string | null;
  country: string | null;
  city: string | null;
}): Promise<WebsiteResult> {
  const r = await websiteOpeningsAll(c);
  const kept = r.openings.filter((o) => inRegion(o.location, c.country, c.city));
  if (kept.length === r.openings.length) return r;
  return { ...r, openings: kept, note: `${r.note.replace(/\.$/, '')}, ${kept.length} in ${countryName(c.country) ?? c.city}.` };
}

async function websiteOpeningsAll(c: { website: string | null; careers_url: string | null }): Promise<WebsiteResult> {
  const start = c.careers_url || c.website;
  if (!start) return { openings: [], careersUrl: null, note: 'No website saved.' };
  const fix = (u: string) => (/^https?:\/\//i.test(u) ? u : `https://${u}`);

  const pages: string[] = [fix(start)];
  const tried = new Set<string>();
  let careersUrl: string | null = c.careers_url ? fix(c.careers_url) : null;

  for (let i = 0; i < pages.length && tried.size < 4; i++) {
    const url = pages[i];
    if (tried.has(url)) continue;
    tried.add(url);

    const board = detectBoard(url);
    if (board) {
      const openings = await boardOpenings(board);
      return { openings, careersUrl: careersUrl ?? url, note: `Read ${openings.length} from ${board.kind}.` };
    }

    let res: Response;
    try {
      res = await get(url);
    } catch (e) {
      if (i === 0 && !c.careers_url) return { openings: [], careersUrl, note: `Website did not answer (${(e as Error).message}).` };
      continue;
    }
    if (!res.ok) continue;
    const html = await res.text();
    const finalUrl = res.url || url;

    const ld = parseJobPostingLd(html, finalUrl);
    if (ld.length) return { openings: ld, careersUrl: careersUrl ?? finalUrl, note: `Read ${ld.length} job postings from the page.` };

    // A job board embedded or linked from this page.
    const boards = [...new Set([...html.matchAll(BOARD_RE)].map((m) => decode(m[0])))];
    for (const b of boards) {
      const found = detectBoard(b);
      if (found) {
        try {
          const openings = await boardOpenings(found);
          return { openings, careersUrl: careersUrl ?? finalUrl, note: `Read ${openings.length} from ${found.kind}.` };
        } catch {
          /* try the next one */
        }
      }
    }

    // From the homepage, follow links that look like a careers page.
    if (i === 0 && !c.careers_url) {
      const links = findCareersLinks(html, finalUrl);
      if (links.length) careersUrl = links[0];
      pages.push(...links);
    }
  }
  return {
    openings: [],
    careersUrl,
    note: careersUrl ? 'Found a careers page, but its job list could not be read automatically.' : 'No careers page found on the website.',
  };
}

// ---------- One LinkedIn job posting (description etc.) ----------

/** linkedin.com/jobs/view/some-title-4473208616, …/jobs/view/4473208616, …?currentJobId=4473208616 → "4473208616". */
export function linkedInJobId(url: string | null | undefined): string | null {
  const u = String(url ?? '');
  if (!/linkedin\.com/i.test(u)) return null;
  return /\/jobs\/view\/(?:[^/?#]*?-)?(\d{6,})/.exec(u)?.[1] ?? /[?&](?:currentJobId|jobId)=(\d{6,})/.exec(u)?.[1] ?? null;
}

export interface LinkedInJob {
  title: string | null;
  company: string | null;
  /** The hiring company's LinkedIn page, when the posting links it. */
  company_linkedin: string | null;
  location: string | null;
  description: string | null;
  workplace: 'remote' | 'hybrid' | 'onsite' | null;
  details: Record<string, string>;
  /** LinkedIn shows "No longer accepting applications". */
  closed: boolean;
}

/** Job description HTML → readable plain text: paragraphs, line breaks and "• " bullets. */
export function htmlToText(html: string): string {
  return decode(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<li[^>]*>/gi, '\n• ')
      .replace(/<\/(p|div|ul|ol|h[1-6])>/gi, '\n\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function parseLinkedInJob(html: string): LinkedInJob {
  const pick = (re: RegExp) => {
    const m = re.exec(html);
    return m ? text(m[1]) || null : null;
  };
  const desc = /show-more-less-html__markup[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1];
  const details: Record<string, string> = {};
  for (const m of html.matchAll(/description__job-criteria-subheader[^>]*>([\s\S]*?)<\/h3>\s*<span[^>]*>([\s\S]*?)<\/span>/g))
    details[text(m[1])] = text(m[2]);
  const bullets = [...html.matchAll(/topcard__flavor--bullet[^>]*>([\s\S]*?)<\/span>/g)].map((m) => text(m[1]));
  const location = bullets.find((b) => b && !/applicant|ago$/i.test(b)) ?? null;
  const description = desc ? htmlToText(desc) : null;
  // LinkedIn's guest page rarely labels the workplace; read it from the location, title or text.
  const hay = `${location ?? ''} ${pick(/topcard__title[^>]*>([\s\S]*?)<\/h[12]>/) ?? ''} ${description?.slice(0, 600) ?? ''}`.toLowerCase();
  const workplace = /\bhybrid\b/.test(hay) ? 'hybrid' : /\bremote\b/.test(hay) ? 'remote' : /\bon-?site\b/.test(hay) ? 'onsite' : null;
  return {
    title: pick(/topcard__title[^>]*>([\s\S]*?)<\/h[12]>/),
    company: pick(/topcard__org-name-link[^>]*>([\s\S]*?)<\/a>/),
    company_linkedin:
      /topcard__org-name-link[^>]*href="(https:\/\/[a-z.]*linkedin\.com\/company\/[^"?]+)/
        .exec(html)?.[1]
        ?.replace(/^https:\/\/[a-z]+\.linkedin/, 'https://www.linkedin') ?? null,
    location,
    description,
    workplace,
    details,
    closed: /closed-job__flavor--closed|no longer accepting applications/i.test(html),
  };
}

export async function fetchLinkedInJob(urlOrId: string): Promise<LinkedInJob> {
  const id = /^\d+$/.test(urlOrId) ? urlOrId : linkedInJobId(urlOrId);
  if (!id) throw new Error('That is not a LinkedIn job link (it should look like linkedin.com/jobs/view/…).');
  const res = await liGet(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${id}`);
  if (res.status === 404) throw new Error('LinkedIn has no job at that link (it may have been removed).');
  if (!res.ok) throw new Error(`LinkedIn did not answer (status ${res.status}). Try again in a minute.`);
  const job = parseLinkedInJob(await res.text());
  if (!job.title && !job.description) throw new Error('LinkedIn showed a login page instead of the job. Try again in a minute.');
  return job;
}

// ---------- Workable job pages (apply.workable.com/<account>/j/<code>) ----------

/** "apply.workable.com/acme/j/FC15C6EBF3/apply/?x" → { account: 'acme', code: 'FC15C6EBF3' }; short links have no account. */
export function workableJobRef(url: string | null | undefined): { account: string | null; code: string } | null {
  const m = /apply\.workable\.com\/(?:([a-z0-9-]+)\/)?j\/([A-Z0-9]{6,})/i.exec(String(url ?? ''));
  if (!m) return null;
  return { account: m[1] && m[1].toLowerCase() !== 'j' ? m[1] : null, code: m[2].toUpperCase() };
}

/** A Workable job in the same shape as a LinkedIn one, so the form treats both alike. */
export async function fetchWorkableJob(url: string): Promise<LinkedInJob & { source: 'workable' }> {
  let ref = workableJobRef(url);
  if (!ref) throw new Error('That is not a Workable job link (it should look like apply.workable.com/company/j/CODE).');
  if (!ref.account) {
    // Short link: Workable redirects it to the company's own page.
    const res = await get(`https://apply.workable.com/j/${ref.code}`, { redirect: 'manual' });
    ref = workableJobRef(res.headers.get('location')) ?? ref;
    if (!ref.account) throw new Error('Could not find the company for that Workable link.');
  }
  const res = await get(`https://apply.workable.com/api/v2/accounts/${ref.account}/jobs/${ref.code}`, {
    headers: { Accept: 'application/json' },
  });
  if (res.status === 404) throw new Error('Workable has no job at that link (it may have been removed).');
  if (!res.ok) throw new Error(`Workable did not answer (status ${res.status}).`);
  const j = (await res.json()) as any; // eslint-disable-line @typescript-eslint/no-explicit-any

  const company = await get(`https://apply.workable.com/api/v1/widget/accounts/${ref.account}`, { headers: { Accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : null))
    .then((w: any) => (w?.name as string) ?? null) // eslint-disable-line @typescript-eslint/no-explicit-any
    .catch(() => null);

  const places = (j.locations?.length ? j.locations : [j.location]).filter(Boolean);
  const location = places.map((l: any) => [l.city, l.country].filter(Boolean).join(', ')).filter(Boolean).join(' · ') || null; // eslint-disable-line @typescript-eslint/no-explicit-any
  const section = (title: string, html: string | null | undefined) => (html ? `${title}\n${htmlToText(html)}` : null);
  const description = [htmlToText(j.description ?? ''), section('Requirements', j.requirements), section('Benefits', j.benefits)]
    .filter(Boolean)
    .join('\n\n');
  const wp = String(j.workplace ?? '').toLowerCase();
  const details: Record<string, string> = {};
  if (j.type) details['Employment type'] = j.type === 'full' ? 'Full-time' : j.type === 'part' ? 'Part-time' : String(j.type);
  if (j.department?.length) details.Department = [].concat(j.department).join(', ');
  if (location) details.Locations = location;
  return {
    source: 'workable',
    title: j.title ?? null,
    company,
    company_linkedin: null,
    location,
    description: description || null,
    workplace: wp === 'remote' || j.remote ? 'remote' : wp === 'hybrid' ? 'hybrid' : wp === 'on_site' || wp === 'onsite' ? 'onsite' : null,
    details,
    closed: j.state !== 'published',
  };
}
