import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapContainer, Marker, Popup, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { api } from '../api';
import type { Company, CompanyLocation, Home, Job, Stage } from '../types';
import Icon from '../components/Icon';
import CurrentBadge from '../components/CurrentBadge';
import { StageBadge } from '../components/Stage';
import { DarkTiles, distanceKm, formatKm, homeIcon, pinIcon } from '../mapConfig';
import { locationText } from './Companies';

const readBool = (key: string, fallback: boolean) => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
};
const writeBool = (key: string, v: boolean) => {
  try {
    localStorage.setItem(key, v ? '1' : '0');
  } catch {
    /* storage unavailable */
  }
};

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  const key = points.map((p) => p.join(',')).join('|');
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) map.setView(points[0], 11, { animate: false });
    else map.fitBounds(L.latLngBounds(points), { padding: [60, 60], maxZoom: 12, animate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map]);
  return null;
}

/** Clicking the map itself (not a pin) clears the selected company. */
function ClearOnMapClick({ onClear }: { onClear: () => void }) {
  useMapEvents({ click: onClear });
  return null;
}

/**
 * "Show all N offices" in a pin's popup: zooms out to fit them. Selecting a company never moves the map by itself:
 * one with offices around the world used to throw you out to the whole globe on every click.
 */
function ShowAllOffices({ points }: { points: [number, number][] }) {
  const map = useMap();
  return (
    <button
      type="button"
      className="text-xs font-medium text-amber-300 hover:underline"
      onClick={(e) => {
        e.stopPropagation();
        map.fitBounds(L.latLngBounds(points), { padding: [60, 60], maxZoom: 12, animate: false });
      }}
    >
      {points.length} offices highlighted · Show all
    </button>
  );
}

type Spot = Pick<CompanyLocation, 'lat' | 'lng' | 'label' | 'address' | 'city' | 'country'> & { id: number | string; is_primary: number };

/** A company's pinned offices (its own lat/lng when it has no location rows). */
const spotsOf = (c: Company): Spot[] => {
  const list: Spot[] = c.locations?.length
    ? c.locations
    : [{ id: `c${c.id}`, lat: c.lat, lng: c.lng, label: null, address: c.address, city: c.city, country: c.country, is_primary: 1 }];
  return list.filter((l) => l.lat != null && l.lng != null);
};

function Toggle({ checked, onChange, label, swatch }: { checked: boolean; onChange: (v: boolean) => void; label: string; swatch: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-1.5">
      <span className="flex items-center gap-2.5 text-sm">
        <span className={`pin ${swatch} !h-3 !w-3`} />
        {label}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 rounded-full border transition ${checked ? 'border-brand bg-brand/80 shadow-glow' : 'border-line bg-ink'}`}
      >
        <span className={`absolute top-0.5 h-[18px] w-[18px] rounded-full bg-fg transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
      </button>
    </label>
  );
}

export default function MapPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [showOffice, setShowOffice] = useState(() => readBool('map-office', true));
  const [showRemote, setShowRemote] = useState(() => readBool('map-remote', false));
  const [stageId, setStageId] = useState<number | ''>('');
  const [panelOpen, setPanelOpen] = useState(true);
  const [home, setHome] = useState<Home | null>(null);
  // The company whose pin you clicked: all its offices are highlighted.
  const [selected, setSelected] = useState<number | null>(null);
  // The pin you clicked (company id + location id): the only one that pulses.
  const [activeKey, setActiveKey] = useState<string | null>(null);

  useEffect(() => {
    api.companies().then(setCompanies);
    api.jobs().then(setJobs);
    api.stages().then(setStages);
    api.home().then(setHome);
  }, []);

  const jobsByCompany = useMemo(() => {
    const m = new Map<number, Job[]>();
    for (const j of jobs) m.set(j.company_id, [...(m.get(j.company_id) ?? []), j]);
    return m;
  }, [jobs]);

  const visible = useMemo(
    () =>
      companies.filter((c) => {
        if (c.is_remote ? !showRemote : !showOffice) return false;
        if (stageId !== '' && !(jobsByCompany.get(c.id) ?? []).some((j) => j.stage_id === stageId)) return false;
        return true;
      }),
    [companies, showOffice, showRemote, stageId, jobsByCompany],
  );

  const spots = visible.flatMap((c) => spotsOf(c).map((l) => ({ c, l })));
  const pinned = visible.filter((c) => spotsOf(c).length);
  const unpinned = visible.filter((c) => !spotsOf(c).length);
  const points = spots.map(({ l }) => [l.lat!, l.lng!] as [number, number]);
  if (home) points.push([home.lat, home.lng]);
  const selectedPoints = spots.filter(({ c }) => c.id === selected).map(({ l }) => [l.lat!, l.lng!] as [number, number]);

  const officeCount = companies.filter((c) => !c.is_remote).length;
  const remoteCount = companies.length - officeCount;

  return (
    <div className="absolute inset-0">
      <MapContainer center={[25, 20]} zoom={3} minZoom={2} worldCopyJump className="h-full w-full">
        <DarkTiles />
        <FitBounds points={points} />
        <ClearOnMapClick onClear={() => setSelected(null)} />
        {home && (
          <Marker position={[home.lat, home.lng]} icon={homeIcon} zIndexOffset={1000}>
            <Popup>
              <div className="font-semibold">{home.label}</div>
              <div className="text-xs text-muted">Where you live</div>
            </Popup>
          </Marker>
        )}
        {spots.map(({ c, l }) => {
          const cj = jobsByCompany.get(c.id) ?? [];
          const count = spotsOf(c).length;
          const key = `${c.id}-${l.id}`;
          const state = selected === null ? 'normal' : selected !== c.id ? 'dim' : key === activeKey ? 'active' : 'selected';
          const place = [l.city, l.country].filter(Boolean).join(', ') || l.address || locationText(c);
          return (
            <Marker
              key={key}
              position={[l.lat!, l.lng!]}
              icon={pinIcon(!!c.is_remote, state)}
              zIndexOffset={state === 'active' ? 1600 : state === 'selected' ? 1500 : 0}
              eventHandlers={{
                click: () => {
                  setSelected(c.id);
                  setActiveKey(key);
                },
                popupclose: () => setSelected((s) => (s === c.id ? null : s)),
              }}
            >
              <Popup>
                <div className="min-w-[200px] space-y-2">
                  <div>
                    <div className="font-semibold">{c.name}</div>
                    {c.is_current ? <CurrentBadge /> : null}
                    <div className="text-xs text-muted">
                      {c.is_remote ? 'Remote · ' : ''}
                      {place}
                      {l.label ? ` · ${l.label}` : ''}
                    </div>
                    {count > 1 && <ShowAllOffices points={selectedPoints.length ? selectedPoints : spotsOf(c).map((s) => [s.lat!, s.lng!])} />}
                    {home && (
                      <div className="text-xs text-muted">
                        ~{formatKm(distanceKm(home, { lat: l.lat!, lng: l.lng! }))} from home (straight line)
                      </div>
                    )}
                  </div>
                  {cj.length > 0 && (
                    <ul className="space-y-1">
                      {cj.slice(0, 5).map((j) => (
                        <li key={j.id} className="flex items-center justify-between gap-2 text-xs">
                          <span className="truncate">{j.title}</span>
                          <StageBadge name={j.stage_name} color={j.stage_color} />
                        </li>
                      ))}
                      {cj.length > 5 && <li className="text-xs text-muted">+{cj.length - 5} more</li>}
                    </ul>
                  )}
                  <Link to={`/companies/${c.id}`} className="inline-block text-xs font-medium !text-brand-light hover:underline">
                    Open company ({cj.length} {cj.length === 1 ? 'job' : 'jobs'}) →
                  </Link>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>

      <div className="pointer-events-none absolute inset-x-3 top-3 z-[500] flex justify-end md:inset-x-auto md:right-4 md:top-4">
        <div className="card pointer-events-auto w-full max-w-xs bg-surface/90 shadow-glow md:w-80">
          <button
            className="flex w-full items-center justify-between px-4 py-3 text-left"
            onClick={() => setPanelOpen((v) => !v)}
            aria-expanded={panelOpen}
          >
            <span className="font-semibold">Company map</span>
            <span className="text-xs text-muted">
              {pinned.length} pinned{spots.length > pinned.length ? ` · ${spots.length} offices` : ''} {panelOpen ? '▴' : '▾'}
            </span>
          </button>
          {panelOpen && (
            <div className="space-y-4 border-t border-line px-4 pb-4 pt-3">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="flex items-center gap-2.5">
                  <span className="grid h-6 w-6 place-items-center rounded-md border border-brand bg-fg text-ink">
                    <Icon name="home" className="h-3.5 w-3.5" />
                  </span>
                  {home ? home.label : 'No home set'}
                </span>
                <Link to="/settings" className="text-xs !text-brand-light hover:underline">
                  {home ? 'Change' : 'Set home'}
                </Link>
              </div>
              <div>
                <Toggle
                  label={`Companies with office (${officeCount})`}
                  swatch="pin-onsite"
                  checked={showOffice}
                  onChange={(v) => {
                    setShowOffice(v);
                    writeBool('map-office', v);
                  }}
                />
                <Toggle
                  label={`Show remote companies (${remoteCount})`}
                  swatch="pin-remote"
                  checked={showRemote}
                  onChange={(v) => {
                    setShowRemote(v);
                    writeBool('map-remote', v);
                  }}
                />
              </div>
              <div>
                <label className="label">Only companies with a job in</label>
                <select
                  className="input"
                  value={stageId}
                  onChange={(e) => setStageId(e.target.value ? Number(e.target.value) : '')}
                >
                  <option value="">Any stage</option>
                  {stages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              {unpinned.length > 0 && (
                <div>
                  <div className="label">Not on map ({unpinned.length})</div>
                  <ul className="max-h-48 space-y-1 overflow-y-auto pr-1">
                    {unpinned.map((c) => (
                      <li key={c.id}>
                        <Link
                          to={`/companies/${c.id}`}
                          className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-raised"
                        >
                          <span className="truncate">{c.name}</span>
                          {c.is_remote ? (
                            <Icon name="globe" className="h-3.5 w-3.5 shrink-0 text-cyan-300" />
                          ) : (
                            <span className="shrink-0 text-[11px] text-muted">no pin</span>
                          )}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {companies.length === 0 && <p className="text-sm text-muted">Add companies with a Google Maps link to see them here.</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
