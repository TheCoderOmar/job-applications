import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, type CareersStatus } from '../api';
import type { Company, LogoStatus, ScanStatus } from '../types';
import type { RefreshStatus } from '../api';
import CompanyLogo from '../components/CompanyLogo';
import Icon from '../components/Icon';
import Modal from '../components/Modal';
import CompanyForm from '../components/CompanyForm';
import CurrentBadge from '../components/CurrentBadge';

export function locationText(c: Company) {
  return [c.city, c.country].filter(Boolean).join(', ') || c.address || '';
}

export default function Companies() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'onsite' | 'remote'>('all');
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<Company | 'new' | null>(params.get('new') ? 'new' : null);

  const [logos, setLogos] = useState<LogoStatus | null>(null);
  const [refresh, setRefresh] = useState<RefreshStatus | null>(null);
  const [scan, setScan] = useState<ScanStatus | null>(null);
  const navigate = useNavigate();
  const [refreshAsked, setRefreshAsked] = useState(false);
  const [careers, setCareers] = useState<CareersStatus | null>(null);
  const [careersAsked, setCareersAsked] = useState(false);

  const load = () => api.companies().then(setCompanies);
  useEffect(() => {
    load();
    api.logoStatus().then(setLogos);
    api.refreshStatus().then(setRefresh);
    api.scanStatus().then(setScan);
    api.careersStatus().then(setCareers);
  }, []);

  // While careers pages are being looked for, follow along so the cards get their careers links.
  useEffect(() => {
    if (!careers?.running) return;
    const t = setTimeout(async () => {
      setCareers(await api.careersStatus());
      load();
    }, 3000);
    return () => clearTimeout(t);
  }, [careers]);

  // While jobs are being looked up, follow along so each card's openings count goes up as they're found.
  useEffect(() => {
    if (!scan?.running) return;
    const t = setTimeout(async () => {
      setScan(await api.scanStatus());
      load();
    }, 3000);
    return () => clearTimeout(t);
  }, [scan]);

  // While companies are being refreshed from LinkedIn, follow along and show new offices as they come in.
  useEffect(() => {
    if (!refresh?.running) return;
    const t = setTimeout(async () => {
      const next = await api.refreshStatus();
      setRefresh(next);
      load();
      if (!next.running) api.logoStatus().then(setLogos);
    }, 3000);
    return () => clearTimeout(t);
  }, [refresh]);

  // While logos are being fetched, poll and refresh the cards so they appear as they arrive.
  useEffect(() => {
    if (!logos?.running) return;
    const t = setTimeout(async () => {
      const next = await api.logoStatus();
      setLogos(next);
      load();
    }, 2500);
    return () => clearTimeout(t);
  }, [logos]);

  const shown = useMemo(() => {
    const needle = q.toLowerCase();
    return companies.filter((c) => {
      if (filter === 'remote' && !c.is_remote) return false;
      if (filter === 'onsite' && c.is_remote) return false;
      if (!needle) return true;
      return [c.name, c.industry, c.city, c.country, c.notes].some((v) => v?.toLowerCase().includes(needle));
    });
  }, [companies, q, filter]);

  const close = () => {
    setEditing(null);
    if (params.has('new')) setParams({});
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Companies</h1>
          <p className="mt-1 text-sm text-muted">{companies.length} companies tracked</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {companies.length > 0 && (
            <button
              className="btn-ghost"
              disabled={!!scan?.running}
              onClick={() => api.scanOpenings().then(setScan)}
              title="Looks up every company's open jobs on LinkedIn (and its careers page) and adds them to Openings"
            >
              <Icon name="briefcase" />
              {scan?.running ? `Finding jobs… ${scan.done} of ${scan.total}` : 'Find all jobs on LinkedIn'}
            </button>
          )}
          {companies.length > 0 && (
            <button
              className="btn-ghost"
              disabled={!!refresh?.running}
              onClick={async () => {
                setRefreshAsked(true);
                setRefresh(await api.refreshCompanies());
              }}
              title="Reads every company's LinkedIn page again: fills in details that are still empty and adds all the offices it lists. What you typed is kept."
            >
              <Icon name="refresh" />
              {refresh?.running ? `Refreshing from LinkedIn… ${refresh.done} of ${refresh.total}` : 'Refresh all from LinkedIn'}
            </button>
          )}
          {companies.length > 0 && (
            <button
              className="btn-ghost"
              disabled={!!careers?.running}
              onClick={async () => {
                setCareersAsked(true);
                setCareers(await api.findCareers());
              }}
              title="Searches every company's website for its careers page and how it hires (Workday, Taleo, a careers email…), for companies that don't post on LinkedIn"
            >
              <Icon name="search" />
              {careers?.running ? `Finding careers pages… ${careers.done} of ${careers.total}` : 'Find careers pages'}
            </button>
          )}
          {logos && (logos.running || logos.missing > 0) && (
            <button className="btn-ghost" disabled={logos.running} onClick={() => api.fetchMissingLogos().then(setLogos)}>
              <Icon name="download" />
              {logos.running ? `Fetching logos… ${logos.done} of ${logos.total}` : `Fetch ${logos.missing} missing logos`}
            </button>
          )}
          <button className="btn-primary" onClick={() => setEditing('new')}>
            <Icon name="plus" /> Add company
          </button>
        </div>
      </header>

      {scan && (scan.running || scan.done > 0) && (
        <div className="card flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm text-muted">
          <span>
            {scan.running
              ? `Looking for jobs at ${scan.current ?? 'your companies'} (${scan.done} of ${scan.total}). ${scan.found} found so far; you can keep using the app.`
              : `Checked ${scan.done} companies and found ${scan.found} job${scan.found === 1 ? '' : 's'}.`}
          </span>
          <Link to="/openings" className="font-medium text-brand-light hover:underline">
            See openings →
          </Link>
        </div>
      )}

      {careers && (careers.running || careersAsked) && (
        <div className="card px-4 py-3 text-sm text-muted">
          {careers.running
            ? `Looking at ${careers.current ?? 'company'} websites (${careers.done} of ${careers.total}). ${careers.found} show how they hire so far; you can keep using the app.`
            : `Done: ${careers.found} of ${careers.done} companies show how they hire (careers page, hiring system or email)${careers.done > careers.found ? '; the rest probably hire through LinkedIn only' : ''}. Find all jobs on LinkedIn now reads their careers pages too.`}
        </div>
      )}

      {refresh && (refresh.running || refreshAsked || refresh.done > 0) && (
        <div className={`card px-4 py-3 text-sm ${refresh.error ? 'border-red-500/40 text-red-300' : 'text-muted'}`}>
          {refresh.running ? (
            <>
              Reading {refresh.current ?? 'companies'} from LinkedIn ({refresh.done} of {refresh.total}). So far {refresh.updated} updated,{' '}
              {refresh.locations_added} new location{refresh.locations_added === 1 ? '' : 's'}. You can keep using the app; it takes a few seconds per
              company.
            </>
          ) : (
            <>
              {refresh.error ? `${refresh.error} ` : 'Done. '}
              {refresh.updated} of {refresh.done} companies updated, {refresh.locations_added} new location
              {refresh.locations_added === 1 ? '' : 's'} added (they're put on the map in the background).
              {refresh.no_page ? ` ${refresh.no_page} have no LinkedIn page we could find.` : ''}
              {refresh.failed && !refresh.error ? ` ${refresh.failed} could not be read.` : ''}
            </>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input className="input pl-9" placeholder="Search companies…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex rounded-lg border border-line p-0.5">
          {(['all', 'onsite', 'remote'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-md px-3 py-1.5 text-sm capitalize transition ${
                filter === f ? 'bg-brand/20 text-brand-light' : 'text-muted hover:text-fg'
              }`}
            >
              {f === 'onsite' ? 'With office' : f}
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="card p-10 text-center text-muted">
          {companies.length === 0 ? 'No companies yet. Add your first one.' : 'No companies match.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((c) => (
            <Link key={c.id} to={`/companies/${c.id}`} className="card card-hover flex flex-col p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <CompanyLogo id={c.id} name={c.name} logoAt={c.logo_at} />
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{c.name}</div>
                    {c.industry && <div className="truncate text-xs text-muted">{c.industry}</div>}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {c.is_current ? <CurrentBadge /> : null}
                  {c.is_remote ? (
                    <span className="chip border border-cyan-400/40 bg-cyan-400/10 text-cyan-300">
                      <Icon name="globe" className="h-3 w-3" /> Remote
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center sm:flex-nowrap justify-between gap-x-3 gap-y-1 text-sm">
                <span className="flex min-w-0 items-center gap-1.5 text-muted">
                  <Icon name="pin" className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">
                    {locationText(c) || (c.lat != null ? 'Pinned on map' : 'No location')}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-3 text-muted">
                  {c.linkedin && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        window.open(c.linkedin!, '_blank', 'noopener');
                      }}
                      className="hover:text-brand-light"
                      aria-label={`${c.name} on LinkedIn`}
                    >
                      <Icon name="linkedin" />
                    </button>
                  )}
                  {(c.careers_url || c.careers_found_url) && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        window.open((c.careers_url || c.careers_found_url)!, '_blank', 'noopener');
                      }}
                      className="hover:text-brand-light"
                      aria-label={`${c.name} careers page`}
                      title={`Careers page${c.hiring_via && c.hiring_via !== 'Careers page' ? ` (${c.hiring_via})` : ''}`}
                    >
                      <Icon name="briefcase" />
                    </button>
                  )}
                  <span title={`${c.job_count} logged in total`}>
                    <span className="font-semibold text-fg">{c.applied_count}</span> applied
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      navigate(`/openings?company=${c.id}`);
                    }}
                    className={c.opening_count ? 'hover:text-brand-light' : ''}
                    title={c.opening_count ? `See ${c.name}'s open jobs` : 'No open jobs found yet'}
                  >
                    <span className={`font-semibold ${c.opening_count ? 'text-emerald-300' : 'text-fg'}`}>{c.opening_count}</span>{' '}
                    {c.opening_count === 1 ? 'opening' : 'openings'}
                  </button>
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {editing && (
        <Modal title={editing === 'new' ? 'Add company' : 'Edit company'} onClose={close}>
          <CompanyForm
            initial={editing === 'new' ? undefined : editing}
            onCancel={close}
            onSaved={() => {
              close();
              load();
              // A new or changed company gets its logo in the background.
              setTimeout(() => api.logoStatus().then(setLogos), 500);
            }}
          />
        </Modal>
      )}
    </div>
  );
}
