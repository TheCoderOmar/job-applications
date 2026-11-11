// Reads a public LinkedIn company page (no login) and company logos.
import { parseLocationsFromHtml, type ParsedLocation } from './locations.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

export interface LinkedInCompany {
  linkedin: string;
  name: string | null;
  description: string | null;
  website: string | null;
  industry: string | null;
  company_size: string | null;
  headquarters: string | null;
  founded: string | null;
  logo_url: string | null;
  /** Offices listed on the page ("Locations"), primary first. */
  locations: ParsedLocation[];
}

/** "linkedin.com/company/acme/about/?x" or "eg.linkedin.com/company/acme" → "https://www.linkedin.com/company/acme". */
export function canonicalCompanyUrl(input: string): string | null {
  const t = input.trim();
  if (!t) return null;
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
  } catch {
    return null;
  }
  if (!/(^|\.)linkedin\.com$/i.test(u.hostname)) return null;
  const m = /^\/(company|school|showcase)\/([^/?#]+)/i.exec(u.pathname);
  if (!m) return null;
  return `https://www.linkedin.com/${m[1].toLowerCase()}/${decodeURIComponent(m[2])}`;
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

const text = (html: string) => decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

function meta(html: string, prop: string): string | null {
  const re = new RegExp(`<meta[^>]+(?:property|name)="${prop}"[^>]*content="([^"]*)"`, 'i');
  const re2 = new RegExp(`<meta[^>]+content="([^"]*)"[^>]*(?:property|name)="${prop}"`, 'i');
  const m = re.exec(html) ?? re2.exec(html);
  return m ? decode(m[1]).trim() || null : null;
}

/** The "About" list on the page: <div data-test-id="about-us__industry"><dt>Industry</dt><dd>…</dd></div>. */
function about(html: string, key: string): { text: string; html: string } | null {
  const re = new RegExp(`data-test-id="about-us__${key}"[\\s\\S]*?<dd[^>]*>([\\s\\S]*?)</dd>`, 'i');
  const m = re.exec(html);
  return m ? { text: text(m[1]), html: m[1] } : null;
}

/** LinkedIn wraps outgoing links: /redir/redirect?url=http%3A%2F%2Fwww.acme.com&… */
function unwrapRedirect(href: string): string {
  try {
    const u = new URL(decode(href), 'https://www.linkedin.com');
    const inner = u.searchParams.get('url');
    return inner ?? u.toString();
  } catch {
    return href;
  }
}

export function parseCompanyPage(html: string, linkedin: string): LinkedInCompany {
  const title = meta(html, 'og:title');
  const site = about(html, 'website');
  const href = site && /href="([^"]+)"/i.exec(site.html)?.[1];
  const descMatch = /data-test-id="about-us__description"[^>]*>([\s\S]*?)<\/p>/i.exec(html);
  const description = descMatch ? text(descMatch[1]) : meta(html, 'og:description');
  return {
    linkedin,
    name: title ? title.replace(/\s*\|\s*LinkedIn\s*$/i, '').trim() || null : null,
    description: description || null,
    website: href ? unwrapRedirect(href) : site?.text || null,
    industry: about(html, 'industry')?.text || null,
    company_size: about(html, 'size')?.text || null,
    headquarters: about(html, 'headquarters')?.text || null,
    founded: about(html, 'foundedOn')?.text || null,
    logo_url: meta(html, 'og:image'),
    locations: parseLocationsFromHtml(html),
  };
}

export async function fetchLinkedInCompany(input: string): Promise<LinkedInCompany> {
  const url = canonicalCompanyUrl(input);
  if (!url) throw new Error('That is not a LinkedIn company link (it should look like linkedin.com/company/name).');
  // LinkedIn answers logged-out browsers with a 403 "Just a moment..." challenge (since Nov 2026),
  // but still serves the public company page to link-preview bots, same as profiles and posts below.
  const res = await fetch(url, {
    headers: { 'User-Agent': 'facebookexternalhit/1.1', 'Accept-Language': 'en-US,en;q=0.9' },
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 404) throw new Error('LinkedIn has no company page at that link. Check the name after /company/.');
  if (!res.ok) throw new Error(`LinkedIn did not answer (status ${res.status}). Try again in a minute.`);
  const html = await res.text();
  const data = parseCompanyPage(html, url);
  if (!data.name) throw new Error('LinkedIn showed a login page instead of the company. Try again in a minute.');
  return data;
}

// ---------- Logos ----------

export interface Logo {
  data: Buffer;
  mime: string;
}

async function download(url: string): Promise<Logo | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const mime = (res.headers.get('content-type') ?? '').split(';')[0].trim();
    if (!mime.startsWith('image/')) return null;
    const data = Buffer.from(await res.arrayBuffer());
    // Skip tracking pixels and empty images; cap at 2 MB.
    if (data.length < 200 || data.length > 2_000_000) return null;
    return { data, mime };
  } catch {
    return null;
  }
}

/** The site's own icon: apple-touch-icon or a large <link rel="icon">, else /favicon.ico. */
async function websiteIcon(website: string): Promise<Logo | null> {
  let base: URL;
  try {
    base = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`);
  } catch {
    return null;
  }
  try {
    const res = await fetch(base, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(8000) });
    const html = res.ok ? await res.text() : '';
    const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
    const rank = (tag: string) => (/apple-touch-icon/i.test(tag) ? 0 : /rel="[^"]*icon/i.test(tag) ? (/\.svg/i.test(tag) ? 2 : 1) : 9);
    const candidates = links
      .filter((t) => rank(t) < 9)
      .sort((a, b) => rank(a) - rank(b))
      .map((t) => /href="([^"]+)"/i.exec(t)?.[1])
      .filter((h): h is string => !!h);
    for (const href of candidates) {
      const logo = await download(new URL(decode(href), res.url || base).toString());
      if (logo) return logo;
    }
  } catch {
    /* fall through to /favicon.ico */
  }
  return (
    (await download(new URL('/favicon.ico', base).toString())) ??
    // Many company sites block scripts or have broken certificates; Google's icon cache usually has them.
    // It only sees the domain, and answers 404 for sites it doesn't know.
    download(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(base.hostname)}&sz=128`)
  );
}

/** Logo from the LinkedIn page first (square, good quality), then the company's website. */
export async function findLogo(c: { linkedin?: string | null; website?: string | null }): Promise<Logo | null> {
  if (c.linkedin) {
    try {
      const page = await fetchLinkedInCompany(c.linkedin);
      if (page.logo_url) {
        const logo = await download(page.logo_url);
        if (logo) return logo;
      }
    } catch {
      /* try the website */
    }
  }
  return c.website ? websiteIcon(c.website) : null;
}

// ---------- Person profiles ----------

export interface LinkedInProfile {
  linkedin_url: string;
  full_name: string | null;
  company: string | null;
  position: string | null;
  location: string | null;
}

/** "linkedin.com/in/Some-One/?x" or "eg.linkedin.com/in/some-one" → "https://www.linkedin.com/in/some-one". */
export function canonicalProfileUrl(input: string): string | null {
  const m = /linkedin\.com\/in\/([^/?#\s]+)/i.exec(input.trim());
  return m ? `https://www.linkedin.com/in/${decodeURIComponent(m[1]).toLowerCase()}` : null;
}

// Arabic/RTL pages wrap text in direction marks.
const clean = (s: string | null | undefined) => (s ? s.replace(/[‎‏‪-‮]/g, '').replace(/\s+/g, ' ').trim() || null : null);

export function parseProfilePage(html: string, url: string): LinkedInProfile {
  // The profile's own Person entry is the one that lists where they work.
  let person: Record<string, any> | null = null; // eslint-disable-line @typescript-eslint/no-explicit-any
  const walk = (o: unknown): void => {
    if (person || !o || typeof o !== 'object') return;
    if (Array.isArray(o)) return o.forEach(walk);
    const r = o as Record<string, unknown>;
    if (r['@type'] === 'Person' && ('worksFor' in r || 'jobTitle' in r)) person = r;
    else Object.values(r).forEach(walk);
  };
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      walk(JSON.parse(m[1]));
    } catch {
      /* not JSON */
    }
  }
  const p = person as Record<string, any> | null; // eslint-disable-line @typescript-eslint/no-explicit-any
  const ogTitle = clean(meta(html, 'og:title'));
  // og:title is "Name - Company | LinkedIn".
  const [ogName, ogCompany] = (ogTitle ?? '').replace(/\s*\|\s*LinkedIn\s*$/i, '').split(/\s+-\s+/);
  const works = Array.isArray(p?.worksFor) ? p!.worksFor : p?.worksFor ? [p.worksFor] : [];
  const jobTitle = (Array.isArray(p?.jobTitle) ? p!.jobTitle : [p?.jobTitle]).map((t: unknown) => clean(String(t ?? ''))).find(Boolean);
  const firstRole = /experience-item__title[^>]*>([\s\S]*?)<\/(?:h3|span|a|div)>/.exec(html)?.[1];
  return {
    linkedin_url: url,
    full_name: clean(p?.name) ?? clean(ogName),
    company: clean(works[0]?.name) ?? clean(ogCompany),
    position: jobTitle ?? clean(firstRole ? text(firstRole) : null),
    location: clean(p?.address?.addressLocality),
  };
}

/**
 * LinkedIn blocks ordinary requests for profiles (status 999) but serves the public profile to
 * link-preview bots, the same page a chat app uses to show a link preview.
 */
export async function fetchLinkedInProfile(input: string): Promise<LinkedInProfile> {
  const url = canonicalProfileUrl(input);
  if (!url) throw new Error('That is not a LinkedIn profile link (it should look like linkedin.com/in/name).');
  const res = await fetch(url, {
    headers: { 'User-Agent': 'facebookexternalhit/1.1', 'Accept-Language': 'en-US,en;q=0.9' },
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 404) throw new Error('LinkedIn has no profile at that link.');
  if (!res.ok) throw new Error(`LinkedIn did not answer (status ${res.status}). Try again in a minute.`);
  const profile = parseProfilePage(await res.text(), url);
  if (!profile.full_name) throw new Error('LinkedIn did not show this profile publicly. Fill it in by hand.');
  return profile;
}

// ---------- Posts (recruiters' "we're hiring" posts) ----------

/** linkedin.com/posts/…, /feed/update/urn:li:activity:…, /feed/update/urn:li:share:… */
export const isLinkedInPost = (url: string | null | undefined) =>
  /linkedin\.com\/(posts\/|feed\/update\/urn:li:(activity|share|ugcPost):)/i.test(String(url ?? ''));

export interface LinkedInPost {
  text: string | null;
  author: string | null;
  posted_at: string | null;
}

export function parsePostPage(html: string): LinkedInPost {
  let post: Record<string, any> | null = null; // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const d = JSON.parse(m[1]);
      for (const o of Array.isArray(d['@graph']) ? d['@graph'] : [d])
        if (!post && /SocialMediaPosting|DiscussionForumPosting|Article/.test(String(o['@type']))) post = o;
    } catch {
      /* not JSON */
    }
  }
  const p = post as Record<string, any> | null; // eslint-disable-line @typescript-eslint/no-explicit-any
  const body = p?.articleBody ?? p?.text ?? meta(html, 'og:description');
  return {
    text: body ? decode(String(body)).replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() || null : null,
    author: clean(p?.author?.name ?? (Array.isArray(p?.author) ? p.author[0]?.name : null)),
    posted_at: p?.datePublished ?? null,
  };
}

export async function fetchLinkedInPost(url: string): Promise<LinkedInPost> {
  if (!isLinkedInPost(url)) throw new Error('That is not a LinkedIn post link.');
  const res = await fetch(url.trim(), {
    headers: { 'User-Agent': 'facebookexternalhit/1.1', 'Accept-Language': 'en-US,en;q=0.9' },
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 404) throw new Error('LinkedIn has no post at that link (it may have been deleted).');
  if (!res.ok) throw new Error(`LinkedIn did not answer (status ${res.status}). Try again in a minute.`);
  const post = parsePostPage(await res.text());
  if (!post.text) throw new Error('LinkedIn did not show this post publicly. Paste the text by hand.');
  return post;
}
