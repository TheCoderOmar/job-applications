import { useState } from 'react';
import { api } from '../api';
import type { CompanyLocation, FoundLocation, LocationDraft } from '../types';
import Icon from './Icon';

/** A location in the form: coordinates as typed text. `key` keeps React rows stable for new ones. */
export type LocationRowDraft = Omit<LocationDraft, 'lat' | 'lng'> & { key: string; lat: string; lng: string };

let seq = 0;
const newKey = () => `n${++seq}`;

export const toDraft = (l: Partial<CompanyLocation> | FoundLocation): LocationRowDraft => ({
  ...l,
  key: 'id' in l && l.id ? `l${l.id}` : newKey(),
  lat: 'lat' in l && l.lat != null ? String(l.lat) : '',
  lng: 'lng' in l && l.lng != null ? String(l.lng) : '',
});

export const emptyLocation = (primary: boolean): LocationRowDraft => ({ key: newKey(), lat: '', lng: '', is_primary: primary });

export const fromDraft = (l: LocationRowDraft): LocationDraft => {
  const { key: _k, lat, lng, ...rest } = l;
  return { ...rest, lat: lat.trim() === '' ? null : Number(lat), lng: lng.trim() === '' ? null : Number(lng) };
};

const placeKey = (l: { address?: string | null; city?: string | null; country?: string | null }) =>
  ((l.address ?? '') || `${l.city ?? ''}${l.country ?? ''}`).toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, '');

/** Adds LinkedIn's offices that aren't in the list yet; a single blank row is replaced. Returns the list and how many were added. */
export function mergeFound(list: LocationRowDraft[], found: FoundLocation[]): [LocationRowDraft[], number] {
  const blank = (l: LocationRowDraft) => !l.address?.trim() && !l.city?.trim() && !l.lat.trim();
  let out = list.filter((l) => !blank(l));
  const have = new Set(out.map(placeKey));
  let added = 0;
  for (const f of found) {
    const k = placeKey(f);
    if (!k || have.has(k)) continue;
    have.add(k);
    out.push({ ...toDraft(f), is_primary: !out.length ? true : out.some((l) => l.is_primary) ? false : f.is_primary });
    added++;
  }
  if (out.length && !out.some((l) => l.is_primary)) out = out.map((l, i) => ({ ...l, is_primary: i === 0 }));
  return [out, added];
}

const PRECISION: Record<string, string> = {
  exact: 'Exact pin',
  manual: 'Pin set by you',
  street: 'Pin on the street',
  area: 'Approximate pin (area)',
  city: 'Approximate pin (city)',
};

export const mapsSearch = (l: { address?: string | null; city?: string | null; country?: string | null }) => {
  const place = l.address || l.city || '';
  const q = l.country && !place.toLowerCase().includes(l.country.toLowerCase()) ? [place, l.country].filter(Boolean).join(', ') : place;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
};

/** What the pin status of a saved location says. */
export function pinNote(l: Pick<CompanyLocation, 'lat' | 'precision' | 'geocode_status' | 'address'>) {
  if (l.lat != null) return { text: PRECISION[l.precision ?? 'manual'] ?? 'Pinned', approx: l.precision === 'area' || l.precision === 'city' };
  if (!l.address) return { text: 'No pin', approx: true };
  if (l.geocode_status === 'not_found') return { text: 'Not found on the map. Paste a Google Maps link.', approx: true };
  return { text: 'Finding it on the map…', approx: false };
}

/** The company form's list of offices: address, city, country and a pin (Maps link or coordinates). */
export default function LocationsEditor({ value, onChange }: { value: LocationRowDraft[]; onChange: (v: LocationRowDraft[]) => void }) {
  const [linkStatus, setLinkStatus] = useState<Record<string, string>>({});
  const update = (key: string, patch: Partial<LocationRowDraft>) => onChange(value.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  /** Changing the address of a pin the map search found drops that pin, so it's looked up again. */
  const updateAddress = (l: LocationRowDraft, patch: Partial<LocationRowDraft>) =>
    update(l.key, l.precision && l.precision !== 'manual' ? { ...patch, lat: '', lng: '', precision: null } : patch);
  const setPrimary = (key: string) => onChange(value.map((l) => ({ ...l, is_primary: l.key === key })));
  const remove = (key: string) => {
    const rest = value.filter((l) => l.key !== key);
    if (rest.length && !rest.some((l) => l.is_primary)) rest[0] = { ...rest[0], is_primary: true };
    onChange(rest);
  };

  async function readLink(l: LocationRowDraft) {
    if (!l.maps_link?.trim()) return;
    setLinkStatus((s) => ({ ...s, [l.key]: 'Reading link…' }));
    try {
      const r = await api.resolveMapsLink(l.maps_link);
      update(l.key, { lat: r.lat.toFixed(6), lng: r.lng.toFixed(6), precision: 'manual' });
      setLinkStatus((s) => ({ ...s, [l.key]: `Pinned at ${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}` }));
    } catch (e) {
      setLinkStatus((s) => ({ ...s, [l.key]: (e as Error).message + ' Enter latitude and longitude instead.' }));
    }
  }

  return (
    <fieldset className="space-y-3 rounded-lg border border-line p-4">
      <legend className="px-1 text-xs font-medium uppercase tracking-wide text-brand-light">
        Locations{value.length > 1 ? ` (${value.length})` : ''}
      </legend>
      {value.length === 0 && <p className="text-sm text-muted">No locations yet. Fill from LinkedIn, or add one.</p>}
      {value.map((l, i) => {
        const pinned = l.lat.trim() !== '' && l.lng.trim() !== '';
        const note = pinned ? pinNote({ lat: 1, precision: l.precision ?? 'manual', geocode_status: 'found', address: l.address ?? null }) : null;
        return (
          <div key={l.key} className={`space-y-3 rounded-lg border p-3 ${l.is_primary ? 'border-brand/40 bg-brand/5' : 'border-line bg-ink/40'}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="radio" name="primary-location" className="accent-[#3b82f6]" checked={!!l.is_primary} onChange={() => setPrimary(l.key)} />
                {l.is_primary ? <span className="font-medium">Primary location</span> : <span className="text-muted">Make primary</span>}
              </label>
              <div className="flex items-center gap-1">
                {(l.address?.trim() || l.city?.trim()) && (
                  <a
                    href={mapsSearch(l)}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-brand-light hover:bg-raised"
                    title="Search this address on Google Maps, then copy the pin's link into the field below"
                  >
                    <Icon name="external" className="h-3.5 w-3.5" /> Find on Google Maps
                  </a>
                )}
                <button
                  type="button"
                  className="rounded-md p-1.5 text-muted hover:text-red-300"
                  aria-label={`Remove location ${i + 1}`}
                  onClick={() => remove(l.key)}
                >
                  <Icon name="trash" />
                </button>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="label">Address</label>
                <input
                  className="input"
                  placeholder="e.g. King Fahd Road, Ebdaa Tower, Al Olaya District, Riyadh"
                  value={l.address ?? ''}
                  onChange={(e) => updateAddress(l, { address: e.target.value })}
                />
              </div>
              <div>
                <label className="label">City</label>
                <input className="input" value={l.city ?? ''} onChange={(e) => updateAddress(l, { city: e.target.value })} />
              </div>
              <div>
                <label className="label">Country</label>
                <input className="input" value={l.country ?? ''} onChange={(e) => updateAddress(l, { country: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <label className="label">Label (optional)</label>
                <input
                  className="input"
                  placeholder="e.g. Headquarters, Riyadh office"
                  value={l.label ?? ''}
                  onChange={(e) => update(l.key, { label: e.target.value })}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="label">Google Maps link</label>
                <div className="flex gap-2">
                  <input
                    className="input"
                    placeholder="https://maps.app.goo.gl/… (pins it exactly)"
                    value={l.maps_link ?? ''}
                    onChange={(e) => update(l.key, { maps_link: e.target.value })}
                    onBlur={() => l.maps_link?.trim() && !pinned && readLink(l)}
                  />
                  <button type="button" className="btn-ghost shrink-0" onClick={() => readLink(l)} disabled={!l.maps_link?.trim()}>
                    Read link
                  </button>
                </div>
                {linkStatus[l.key] && <p className="mt-1.5 text-xs text-muted">{linkStatus[l.key]}</p>}
              </div>
              <div>
                <label className="label">Latitude</label>
                <input className="input" inputMode="decimal" value={l.lat} onChange={(e) => update(l.key, { lat: e.target.value, precision: 'manual' })} />
              </div>
              <div>
                <label className="label">Longitude</label>
                <input className="input" inputMode="decimal" value={l.lng} onChange={(e) => update(l.key, { lng: e.target.value, precision: 'manual' })} />
              </div>
            </div>
            <p className={`text-xs ${note?.approx ? 'text-amber-300' : 'text-muted'}`}>
              {note
                ? note.text
                : l.address?.trim()
                  ? 'No pin yet: it is looked up on the map from the address when you save.'
                  : 'Add an address or a Google Maps link to put it on the map.'}
            </p>
          </div>
        );
      })}
      <button type="button" className="btn-ghost" onClick={() => onChange([...value, emptyLocation(!value.length)])}>
        <Icon name="plus" /> Add location
      </button>
    </fieldset>
  );
}
