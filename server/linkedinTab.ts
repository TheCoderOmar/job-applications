// What the browser extension reads from a LinkedIn tab you're logged in on (company page, profile, post),
// and working out which company a recruiter's post is about.
import { normalizeCompany, sameCompany } from './contacts.js';

export type LinkedInKind = 'company' | 'profile' | 'post';

/** A LinkedIn company page, profile or post link → its kind; anything else → null. */
export function linkedInKind(url: string): LinkedInKind | null {
  if (!/^https?:\/\/([a-z]+\.)?linkedin\.com\//i.test(url)) return null;
  if (/linkedin\.com\/(posts\/|feed\/update\/urn:li:(activity|share|ugcPost):)/i.test(url)) return 'post';
  if (/linkedin\.com\/(company|school|showcase)\/[^/?#]+/i.test(url) && !/[?&]currentJobId=/i.test(url)) return 'company';
  if (/linkedin\.com\/in\/[^/?#]+/i.test(url)) return 'profile';
  return null;
}

/** Read in the tab: the company's name and each location card's lines (country heading, tags, address). */
export interface TabCompany {
  name?: string | null;
  cards?: { lines: string[]; heading?: string | null }[];
}

/** Read in the tab: the person's top card. */
export interface TabProfile {
  name?: string | null;
  headline?: string | null;
  company?: string | null;
  company_url?: string | null;
  location?: string | null;
}

/** Read in the tab: who posted, their headline, and the post. */
export interface TabPost {
  author?: string | null;
  author_url?: string | null;
  headline?: string | null;
  text?: string | null;
}

/** Trims every string field and drops non-strings (the tab sends whatever the page had). */
export function cleanTab<T extends object>(data: unknown): Partial<T> {
  const out: Record<string, unknown> = {};
  if (!data || typeof data !== 'object') return out as Partial<T>;
  for (const [k, v] of Object.entries(data)) {
    // A post's text keeps its line breaks; everything else is one line.
    if (typeof v === 'string' && k === 'text') out[k] = v.replace(/[^\S\n]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim() || null;
    else if (typeof v === 'string') out[k] = v.replace(/\s+/g, ' ').trim() || null;
    else if (Array.isArray(v)) out[k] = v;
  }
  return out as Partial<T>;
}

/**
 * The employer in a headline: "Talent Acquisition at Valeo", "HR Manager @ Sumerge | Hiring",
 * "Recruiter - Fawry". Null when there isn't a clear one.
 */
export function companyFromHeadline(headline: string | null | undefined): string | null {
  const h = (headline ?? '').split(/\s[|•·]\s/)[0].trim();
  const m = /(?:\bat\b|@)\s*([^,|•·()]+)/i.exec(h) ?? /\s[-–—]\s([^,|•·()]+)$/.exec(h);
  const name = m?.[1].trim().replace(/[.!]+$/, '');
  return name && name.length >= 2 && name.length <= 60 ? name : null;
}

export interface CompanyGuess {
  /** A company you already have, or null for a new one. */
  id: number | null;
  name: string;
  linkedin: string | null;
  /** How it was found, for the message in the form. */
  why: 'author' | 'mentioned' | 'headline';
}

const canonical = (u: string | null | undefined) => {
  const m = /linkedin\.com\/(company|school|showcase)\/([^/?#]+)/i.exec(u ?? '');
  return m ? `https://www.linkedin.com/${m[1].toLowerCase()}/${decodeURIComponent(m[2])}` : null;
};

/**
 * Which company a job post is for:
 * 1. posted by a company page → that company;
 * 2. else one of your companies named in the author's headline, then in the post (the earliest mention);
 * 3. else the employer in the author's headline ("Recruiter at X");
 * otherwise null, and you pick it.
 */
export function guessPostCompany(post: TabPost, companies: { id: number; name: string; linkedin: string | null }[]): CompanyGuess | null {
  const known = (name: string, linkedin: string | null) =>
    companies.find((c) => (linkedin && canonical(c.linkedin) === linkedin) || sameCompany(c.name, name));

  const page = canonical(post.author_url);
  if (page && post.author) {
    const k = known(post.author, page);
    return { id: k?.id ?? null, name: k?.name ?? post.author, linkedin: page, why: 'author' };
  }

  for (const source of [post.headline, post.text]) {
    const hay = ` ${normalizeCompany(source)} `;
    if (hay.trim() === '') continue;
    let best: { c: (typeof companies)[number]; at: number } | null = null;
    for (const c of companies) {
      const n = normalizeCompany(c.name);
      // Short names ("IBM" is fine, "AI" is not) need to be whole words.
      if (n.length < 3) continue;
      const at = hay.indexOf(` ${n} `);
      if (at >= 0 && (!best || at < best.at || (at === best.at && n.length > normalizeCompany(best.c.name).length))) best = { c, at };
    }
    if (best) return { id: best.c.id, name: best.c.name, linkedin: best.c.linkedin, why: 'mentioned' };
  }

  const fromHeadline = companyFromHeadline(post.headline);
  if (fromHeadline) {
    const k = known(fromHeadline, null);
    return { id: k?.id ?? null, name: k?.name ?? fromHeadline, linkedin: k?.linkedin ?? null, why: 'headline' };
  }
  return null;
}
