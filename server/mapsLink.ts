export interface LatLng {
  lat: number;
  lng: number;
}

const valid = (lat: number, lng: number) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

/** Extract coordinates from a full Google Maps URL (or a raw "lat,lng" string). */
export function parseCoords(input: string): LatLng | null {
  const text = decodeURIComponent(input.trim());
  const num = '(-?\\d{1,3}(?:\\.\\d+)?)';

  // Prefer the exact place pin (!3d…!4d…) over the viewport center (@…).
  const patterns = [
    new RegExp(`!3d${num}!4d${num}`),
    new RegExp(`[?&](?:q|query|ll|destination|center)=${num}\\s*,\\s*${num}`),
    new RegExp(`@${num},${num}`),
    new RegExp(`^${num}\\s*,\\s*${num}$`),
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const lat = parseFloat(m[1]);
      const lng = parseFloat(m[2]);
      if (valid(lat, lng)) return { lat, lng };
    }
  }
  return null;
}

/** Resolve short links (maps.app.goo.gl, goo.gl/maps) by following redirects, then parse. */
export async function resolveMapsLink(link: string): Promise<{ coords: LatLng | null; finalUrl: string }> {
  const direct = parseCoords(link);
  if (direct) return { coords: direct, finalUrl: link };

  if (!/^https?:\/\//i.test(link)) return { coords: null, finalUrl: link };

  let url = link;
  for (let i = 0; i < 6; i++) {
    const res = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0' } });
    const next = res.headers.get('location');
    if (!next) {
      // Some pages embed the coordinates in the body instead of redirecting.
      if (res.ok) {
        const body = await res.text();
        const fromBody = parseCoords(url) ?? matchBody(body);
        return { coords: fromBody, finalUrl: url };
      }
      break;
    }
    url = new URL(next, url).toString();
    const coords = parseCoords(url);
    if (coords) return { coords, finalUrl: url };
  }
  return { coords: parseCoords(url), finalUrl: url };
}

function matchBody(body: string): LatLng | null {
  const m = body.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) ?? body.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lng = parseFloat(m[2]);
  return valid(lat, lng) ? { lat, lng } : null;
}
