// Address → map pin. OpenStreetMap (Nominatim, free, no key) by default; Google's Geocoding API when a key is set.

export type Precision = 'exact' | 'street' | 'area' | 'city';

export interface GeoHit {
  lat: number;
  lng: number;
  precision: Precision;
  /** The search that found it. */
  query: string;
}

export interface GeoInput {
  address: string | null;
  city: string | null;
  country: string | null;
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/** Floors, office numbers and P.O. boxes only confuse a map search. */
const UNIT = /\b(floor|flr|fl\.|office|suite|unit|level|apt|apartment|room|p\.?\s?o\.?\s?box|mailbox)\b|^\d+(st|nd|rd|th)\b|^(bb|b)\d+$/i;
const LANDMARK = /\b(tower|towers|building|bldg|mall|plaza|village|park|centre|center|complex|business|square|compound|city)\b/i;

/**
 * Searches to try for an address, most precise first, at most 6:
 * the whole cleaned address, a named landmark + city, then dropping leading parts down to "City, Country".
 */
export function geocodeQueries({ address, city, country }: GeoInput): string[] {
  const segs: string[] = [];
  for (const raw of (address ?? '').replace(/\([^)]*\)/g, ' ').split(/,|\s+-\s+/)) {
    let s = raw.replace(/\s*\b\d{4,7}\b\s*$/, '').replace(/\s+/g, ' ').trim(); // postal code
    if (/^[A-Z]{2}$/.test(s)) continue; // country code
    if (!s || UNIT.test(s)) continue;
    if (!segs.some((x) => x.toLowerCase() === s.toLowerCase())) segs.push(s);
  }
  if (country) {
    // Drop a trailing country already in the address (we add it back once).
    while (segs.length && segs[segs.length - 1].toLowerCase() === country.toLowerCase()) segs.pop();
  }
  const tail = country ? [country] : [];
  const queries: string[] = [];
  const add = (parts: (string | null)[]) => {
    const q = parts.filter(Boolean).join(', ');
    if (q && !queries.includes(q)) queries.push(q);
  };
  if (segs.length) add([...segs, ...tail]);
  const landmark = segs.find((s) => LANDMARK.test(s));
  const cityName = city ?? segs[segs.length - 1] ?? null;
  if (landmark && cityName && landmark !== cityName) add([landmark, cityName, ...tail]);
  for (let i = 1; i < segs.length; i++) add([...segs.slice(i), ...tail]);
  if (city) add([city, ...tail]);
  return queries.slice(0, 6);
}

/** Nominatim's place type → how close the pin is. */
export function osmPrecision(addresstype: string | undefined, type?: string): Precision {
  const t = (addresstype ?? type ?? '').toLowerCase();
  if (['road', 'street', 'pedestrian', 'highway'].includes(t)) return 'street';
  if (['suburb', 'neighbourhood', 'quarter', 'city_district', 'residential', 'borough', 'district', 'hamlet', 'isolated_dwelling'].includes(t))
    return 'area';
  if (['city', 'town', 'village', 'municipality', 'state', 'county', 'region', 'province', 'country', 'administrative'].includes(t))
    return 'city';
  return 'exact';
}

const googlePrecision = (locationType: string | undefined, types: string[] = []): Precision => {
  if (locationType === 'ROOFTOP') return 'exact';
  if (types.some((t) => ['route', 'street_address'].includes(t))) return 'street';
  if (types.some((t) => ['locality', 'administrative_area_level_1', 'administrative_area_level_2', 'country'].includes(t))) return 'city';
  if (locationType === 'APPROXIMATE') return 'area';
  return 'street';
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Finds a pin for an address, trying the searches from `geocodeQueries` in order.
 * Nominatim allows one request a second, so OSM searches are spaced out.
 */
export async function geocode(
  input: GeoInput,
  opts: { googleKey?: string | null; fetchFn?: FetchFn; delayMs?: number } = {},
): Promise<GeoHit | null> {
  const fetchFn = opts.fetchFn ?? fetch;
  const delay = opts.delayMs ?? 1100;
  const queries = geocodeQueries(input);
  for (const [i, query] of queries.entries()) {
    if (opts.googleKey) {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${encodeURIComponent(opts.googleKey)}`;
      const res = await fetchFn(url, { signal: AbortSignal.timeout(15000) });
      const body = (await res.json()) as {
        status: string;
        error_message?: string;
        results?: { geometry: { location: { lat: number; lng: number }; location_type?: string }; types?: string[] }[];
      };
      if (body.status === 'REQUEST_DENIED' || body.status === 'OVER_DAILY_LIMIT')
        throw new Error(`Google refused the key: ${body.error_message ?? body.status}`);
      const r = body.results?.[0];
      if (r) return { ...r.geometry.location, precision: googlePrecision(r.geometry.location_type, r.types), query };
    } else {
      if (i > 0) await sleep(delay);
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=en&q=${encodeURIComponent(query)}`;
      const res = await fetchFn(url, {
        headers: { 'User-Agent': 'JobTracker/1.2 (personal job-application tracker; local app)' },
        signal: AbortSignal.timeout(15000),
      });
      if (res.status === 429) throw new Error('OpenStreetMap asked us to slow down.');
      if (!res.ok) continue;
      const hits = (await res.json()) as { lat: string; lon: string; addresstype?: string; type?: string }[];
      const h = hits[0];
      if (h) return { lat: Number(h.lat), lng: Number(h.lon), precision: osmPrecision(h.addresstype, h.type), query };
    }
  }
  return null;
}

/** A Google Maps search for the address, to check or correct a pin by hand. */
export function mapsSearchLink({ address, city, country }: GeoInput) {
  const place = address ?? city ?? '';
  const q = country && !place.toLowerCase().includes(country.toLowerCase()) ? [place, country].filter(Boolean).join(', ') : place;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}
