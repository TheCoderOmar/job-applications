// Company office locations: reading them from LinkedIn (the "Locations" cards) and splitting addresses.

export interface ParsedLocation {
  /** What the card says besides the address: "Primary · Headquarters", or the office's entity name. */
  label: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  is_primary: boolean;
}

// ---------- Countries ----------

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
const COUNTRY_BY_NAME = new Map<string, string>();
for (let a = 65; a <= 90; a++)
  for (let b = 65; b <= 90; b++) {
    const code = String.fromCharCode(a, b);
    try {
      const name = regionNames.of(code);
      if (name && name !== code && !/unknown/i.test(name)) COUNTRY_BY_NAME.set(name.toLowerCase(), name);
    } catch {
      /* not a region */
    }
  }
for (const [alias, name] of [
  ['uae', 'United Arab Emirates'],
  ['ksa', 'Saudi Arabia'],
  ['usa', 'United States'],
  ['us', 'United States'],
  ['uk', 'United Kingdom'],
  ['kingdom of saudi arabia', 'Saudi Arabia'],
])
  COUNTRY_BY_NAME.set(alias, name);

/** "Egypt", "UAE" or "EG" → the English country name; anything else → null. */
export function countryName(s: string | null | undefined): string | null {
  const t = (s ?? '').trim();
  if (!t) return null;
  if (/^[A-Z]{2}$/.test(t)) {
    try {
      const n = regionNames.of(t);
      if (n && n !== t) return n;
    } catch {
      /* not a code */
    }
  }
  return COUNTRY_BY_NAME.get(t.toLowerCase()) ?? null;
}

// ---------- Addresses ----------

const NOISE = /^(get directions|show (more|less)|see all|locations?( \(\d+\))?|view on map|\d+ locations?)$/i;
const TAGS = /^(primary|headquarters|hq)$/i;

/** "Cairo Governorate 4471303" → "Cairo Governorate"; "Riyadh 19248" → "Riyadh". */
const dropPostal = (s: string) => s.replace(/\s*\b\d{4,7}(-\d{3,4})?\b\s*$/, '').trim();

/**
 * City from a LinkedIn-style address "street, area, City, Region 12345[, CC]":
 * the part before the region, and after a trailing " - " ("Al Olaya District - Riyadh" → "Riyadh").
 */
export function cityFromAddress(address: string): string | null {
  let parts = address
    .split(',')
    .map((p) => dropPostal(p.trim()))
    .filter(Boolean);
  if (parts.length && /^[A-Z]{2}$/.test(parts[parts.length - 1])) parts = parts.slice(0, -1);
  if (parts.length && countryName(parts[parts.length - 1])) parts = parts.slice(0, -1);
  if (!parts.length) return null;
  const pick = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
  const last = pick.split(/\s+-\s+/).pop()!.trim();
  // A street number or a floor is not a city.
  return /\d/.test(last) ? null : last || null;
}

/** Country from the end of an address: "…, AE" or "…, Egypt". */
function countryFromAddress(address: string): string | null {
  const last = address.split(',').pop()?.trim() ?? '';
  return countryName(last);
}

/**
 * One location card's lines, as LinkedIn shows them:
 *   United Arab Emirates / Primary / Headquarters / 2506 Mazaya Business Avenue…, Dubai 346060 / Get directions
 * The country heading is optional; short lines without digits or commas before the address are its tags.
 */
export function parseLocationCard(lines: string[], heading?: string | null): ParsedLocation | null {
  let rest = lines.map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l && !NOISE.test(l));
  let country = countryName(heading);
  if (rest.length > 1 && countryName(rest[0])) {
    country = countryName(rest[0]);
    rest = rest.slice(1);
  }
  const tags: string[] = [];
  while (rest.length > 1 && (TAGS.test(rest[0]) || !/[\d,]/.test(rest[0]))) tags.push(rest.shift()!);
  const address = rest.join(', ').replace(/,\s*,/g, ',').trim() || null;
  if (!address && !tags.length) return null;
  // A card with only a city name ("Cairo") is an address too.
  const addr = address ?? tags.pop() ?? null;
  return {
    label: tags.join(' · ') || null,
    address: addr,
    city: addr ? cityFromAddress(addr) : null,
    country: country ?? (addr ? countryFromAddress(addr) : null),
    is_primary: tags.some((t) => /^primary$/i.test(t)),
  };
}

const normKey = (s: string | null) => (s ?? '').toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, '');

/** Drops repeats (same address), keeps the first primary, and makes the first one primary when none is. */
export function tidyLocations(list: (ParsedLocation | null)[]): ParsedLocation[] {
  const seen = new Set<string>();
  const out: ParsedLocation[] = [];
  for (const l of list) {
    if (!l) continue;
    const key = normKey(l.address) || normKey(`${l.city}${l.country}`);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ ...l });
  }
  let primary = false;
  for (const l of out) {
    if (l.is_primary && !primary) primary = true;
    else l.is_primary = false;
  }
  if (out.length && !primary) out[0].is_primary = true;
  return out;
}

// ---------- From page HTML ----------

const decodeEntities = (s: string) => {
  for (let i = 0; i < 3; i++) {
    const next = s
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&#x27;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
      .replace(/&amp;/g, '&');
    if (next === s) break;
    s = next;
  }
  return s;
};
const textOf = (html: string) => decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/**
 * Locations in a LinkedIn company page's HTML, whichever form it has:
 * 1. the public page's cards (id="address-0"…, each a few <p> lines and a "Get directions" link),
 * 2. the logged-in page's data (JSON with "line1", "city", "geographicArea", "postalCode", "country"),
 * 3. any "Get directions" map link (bing.com/maps?where=…).
 */
export function parseLocationsFromHtml(html: string): ParsedLocation[] {
  // 1. Public page cards.
  const cards: ParsedLocation[] = [];
  const blocks = html.split(/(?=<[^>]+\bid="address-\d+")/i).slice(1);
  for (const block of blocks) {
    const body = block.split(/<\/li>|<li\b/i)[0];
    const lines = [...body.matchAll(/<(p|span|h3|h4|div)\b[^>]*>([^<]+)</gi)].map((m) => textOf(m[2])).filter(Boolean);
    cards.push(...[parseLocationCard(lines)].filter((x): x is ParsedLocation => !!x));
  }
  if (cards.length) return tidyLocations(cards);

  // 2. Logged-in page data.
  const data = decodeEntities(html);
  const fromJson: ParsedLocation[] = [];
  for (const m of data.matchAll(/"line1"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) {
    // The fields of one address sit together; look a little before and after "line1".
    const win = data.slice(Math.max(0, m.index! - 400), m.index! + 600);
    const field = (k: string) => {
      const r = new RegExp(`"${k}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(win);
      return r ? JSON.parse(`"${r[1]}"`).trim() || null : null;
    };
    const line1 = JSON.parse(`"${m[1]}"`).trim();
    const city = field('city');
    const parts = [line1, field('line2'), city, [field('geographicArea'), field('postalCode')].filter(Boolean).join(' ')].filter(Boolean);
    const hq = /"headquarter"\s*:\s*true/.test(win);
    const desc = field('description') ?? field('localizedName');
    fromJson.push({
      label: [hq ? 'Headquarters' : null, desc].filter(Boolean).join(' · ') || null,
      address: parts.join(', ') || null,
      city,
      country: countryName(field('country')),
      is_primary: hq,
    });
  }
  if (fromJson.length) return tidyLocations(fromJson);

  // 3. Map links only.
  const links = [...html.matchAll(/bing\.com\/maps\?[^"']*?\bwhere=([^&"']+)/gi)].map((m) => {
    const where = decodeURIComponent(decodeEntities(m[1]).replace(/\+/g, ' ')).trim();
    return parseLocationCard([where]);
  });
  return tidyLocations(links);
}
