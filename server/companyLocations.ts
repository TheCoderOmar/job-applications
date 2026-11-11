// Storing a company's locations, keeping the primary one mirrored on the company row, and pinning them in the background.
import { db } from './db.js';
import { resolveMapsLink } from './mapsLink.js';
import { geocode } from './geocode.js';
import type { ParsedLocation } from './locations.js';

export interface LocationRow {
  id: number;
  company_id: number;
  label: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
  maps_link: string | null;
  precision: string | null;
  geocode_status: string | null;
  is_primary: number;
  sort_order: number;
}

export type LocationInput = Partial<Omit<LocationRow, 'is_primary'>> & { is_primary?: boolean | number };

const str = (v: unknown) => {
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v);
  return s || null;
};
const num = (v: unknown) => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function locationsOf(companyId: number | string): LocationRow[] {
  return db
    .prepare('SELECT * FROM company_locations WHERE company_id = ? ORDER BY is_primary DESC, sort_order, id')
    .all(companyId) as LocationRow[];
}

/** Every company's locations, for lists and the map. */
export function allLocations(): Map<number, LocationRow[]> {
  const m = new Map<number, LocationRow[]>();
  for (const l of db.prepare('SELECT * FROM company_locations ORDER BY company_id, is_primary DESC, sort_order, id').all() as LocationRow[])
    m.set(l.company_id, [...(m.get(l.company_id) ?? []), l]);
  return m;
}

export const withLocations = <T extends { id: number }>(rows: T[]) => {
  const all = allLocations();
  return rows.map((r) => ({ ...r, locations: all.get(r.id) ?? [] }));
};

/** The company row's address/city/country/lat/lng/maps_link follow its primary location (or are cleared without one). */
export function syncPrimary(companyId: number | string) {
  const p = db
    .prepare('SELECT * FROM company_locations WHERE company_id = ? ORDER BY is_primary DESC, sort_order, id LIMIT 1')
    .get(companyId) as LocationRow | undefined;
  if (p && !p.is_primary) db.prepare('UPDATE company_locations SET is_primary = 1 WHERE id = ?').run(p.id);
  db.prepare('UPDATE companies SET address = ?, city = ?, country = ?, lat = ?, lng = ?, maps_link = ? WHERE id = ?').run(
    p?.address ?? null,
    p?.city ?? null,
    p?.country ?? null,
    p?.lat ?? null,
    p?.lng ?? null,
    p?.maps_link ?? null,
    companyId,
  );
}

/** Maps links without coordinates are read before saving (it may follow a short-link redirect). */
export async function resolveLinks(list: LocationInput[]): Promise<LocationInput[]> {
  const out: LocationInput[] = [];
  for (const l of list) {
    const lat = num(l.lat);
    const lng = num(l.lng);
    if ((lat === null || lng === null) && typeof l.maps_link === 'string' && l.maps_link.trim()) {
      const { coords } = await resolveMapsLink(l.maps_link).catch(() => ({ coords: null }));
      out.push(coords ? { ...l, ...coords, precision: 'manual' } : l);
    } else out.push(l);
  }
  return out;
}

/**
 * Replaces a company's locations with `list` (ids kept for rows that stay). A pin typed or read from a Maps link
 * counts as exact ("manual"); an address that changed without a pin is looked up again.
 */
export function replaceLocations(companyId: number | string, list: LocationInput[]) {
  const before = new Map(locationsOf(companyId).map((l) => [l.id, l]));
  const keep = new Set<number>();
  const primaryIdx = Math.max(0, list.findIndex((l) => !!l.is_primary));
  const update = db.prepare(
    `UPDATE company_locations SET label = @label, address = @address, city = @city, country = @country, lat = @lat, lng = @lng,
       maps_link = @maps_link, precision = @precision, geocode_status = @geocode_status, is_primary = @is_primary, sort_order = @sort_order
     WHERE id = @id AND company_id = @company_id`,
  );
  const insert = db.prepare(
    `INSERT INTO company_locations (company_id, label, address, city, country, lat, lng, maps_link, precision, geocode_status, is_primary, sort_order)
     VALUES (@company_id, @label, @address, @city, @country, @lat, @lng, @maps_link, @precision, @geocode_status, @is_primary, @sort_order)`,
  );
  list.forEach((l, i) => {
    const row = {
      company_id: Number(companyId),
      label: str(l.label),
      address: str(l.address),
      city: str(l.city),
      country: str(l.country),
      lat: num(l.lat),
      lng: num(l.lng),
      maps_link: str(l.maps_link),
      precision: str(l.precision),
      geocode_status: null as string | null,
      is_primary: i === primaryIdx ? 1 : 0,
      sort_order: i,
    };
    if (!row.address && !row.city && row.lat === null) return; // an empty row in the form
    const old = l.id ? before.get(Number(l.id)) : undefined;
    const pinned = row.lat !== null && row.lng !== null;
    if (pinned) {
      const moved = !old || old.lat !== row.lat || old.lng !== row.lng;
      row.precision = moved ? (row.precision ?? 'manual') : (old.precision ?? row.precision ?? 'manual');
      row.geocode_status = 'found';
    } else {
      const sameAddress = old && old.address === row.address && old.city === row.city && old.country === row.country;
      row.precision = null;
      row.geocode_status = sameAddress ? old.geocode_status : null;
    }
    if (old) (update.run({ ...row, id: old.id }), keep.add(old.id));
    else keep.add(Number(insert.run(row).lastInsertRowid));
  });
  for (const id of before.keys()) if (!keep.has(id)) db.prepare('DELETE FROM company_locations WHERE id = ?').run(id);
  syncPrimary(companyId);
}

const key = (s: string | null) => (s ?? '').toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, '');

/** Adds the locations a company doesn't have yet (same address = same place). Returns how many were added. */
export function addLocations(companyId: number | string, found: ParsedLocation[]): number {
  const have = locationsOf(companyId);
  const known = new Set(have.map((l) => key(l.address) || key(`${l.city}${l.country}`)));
  // A company whose only location is a bare city ("Cairo", from before) gets it replaced by the real addresses.
  const bare = have.length === 1 && !have[0].address && have[0].lat === null ? have[0] : null;
  let added = 0;
  let order = have.length;
  const insert = db.prepare(
    `INSERT INTO company_locations (company_id, label, address, city, country, is_primary, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  db.transaction(() => {
    if (bare && found.length) db.prepare('DELETE FROM company_locations WHERE id = ?').run(bare.id);
    const hasPrimary = !bare && have.some((l) => l.is_primary);
    for (const l of found) {
      const k = key(l.address) || key(`${l.city}${l.country}`);
      if (!k || known.has(k)) continue;
      known.add(k);
      insert.run(companyId, l.label, l.address, l.city, l.country, !hasPrimary && l.is_primary ? 1 : 0, order++);
      added++;
    }
    syncPrimary(companyId);
  })();
  if (added) queueGeocoding();
  return added;
}

/** Saving a company without a locations list (older screens, imports): its flat address becomes/updates the primary location. */
export function primaryFromCompany(companyId: number | string) {
  const c = db.prepare('SELECT address, city, country, lat, lng, maps_link FROM companies WHERE id = ?').get(companyId) as
    | Pick<LocationRow, 'address' | 'city' | 'country' | 'lat' | 'lng' | 'maps_link'>
    | undefined;
  if (!c) return;
  const others = locationsOf(companyId).filter((l) => !l.is_primary);
  const primary = locationsOf(companyId).find((l) => l.is_primary);
  const empty = !c.address && !c.city && c.lat === null;
  replaceLocations(companyId, [...(empty ? [] : [{ ...primary, ...c, id: primary?.id, is_primary: true }]), ...others]);
}

// ---------- Background pinning ----------

export const geocodeState = { running: false, done: 0, failed: 0, error: null as string | null };

const googleKey = () =>
  ((db.prepare(`SELECT value FROM settings WHERE key = 'google_maps_key'`).get() as { value: string } | undefined)?.value ?? '').trim() || null;

/** Looks up every location that has a street address but no pin yet, one at a time (a bare city stays unpinned). */
export function queueGeocoding() {
  if (geocodeState.running) return;
  geocodeState.running = true;
  geocodeState.error = null;
  void (async () => {
    try {
      for (;;) {
        const l = db
          .prepare(
            `SELECT * FROM company_locations WHERE lat IS NULL AND geocode_status IS NULL
               AND trim(IFNULL(address, '')) != '' ORDER BY id LIMIT 1`,
          )
          .get() as LocationRow | undefined;
        if (!l) break;
        let hit = null;
        try {
          hit = await geocode(l, { googleKey: googleKey() });
        } catch (e) {
          // Refused key or rate limit: stop for now; the next save or restart tries again.
          geocodeState.error = (e as Error).message;
          break;
        }
        db.prepare(`UPDATE company_locations SET lat = ?, lng = ?, precision = ?, geocode_status = ? WHERE id = ?`).run(
          hit?.lat ?? null,
          hit?.lng ?? null,
          hit?.precision ?? null,
          hit ? 'found' : 'not_found',
          l.id,
        );
        if (hit) geocodeState.done++;
        else geocodeState.failed++;
        if (l.is_primary) syncPrimary(l.company_id);
        await new Promise((r) => setTimeout(r, 1100));
      }
    } finally {
      geocodeState.running = false;
    }
  })();
}
