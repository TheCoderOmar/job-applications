import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import type { Company, Opening, ScanStatus } from '../types';
import Icon from '../components/Icon';
import CompanyLogo from '../components/CompanyLogo';
import StarButton from '../components/Star';
import { StageBadge } from '../components/Stage';
import { dmy, dmyTime } from '../dates';

const fmtDate = (iso: string | null) => dmy(iso);
const sqlToDate = (s: string) => new Date(s.replace(' ', 'T') + 'Z');

export default function Openings() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [openings, setOpenings] = useState<Opening[] | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [scan, setScan] = useState<ScanStatus | null>(null);
  const [q, setQ] = useState(params.get('q') ?? '');

  const companyId = params.get('company') ?? '';
  const source = params.get('source') ?? '';
  const view = params.get('view') ?? 'open'; // open | new | starred | hidden | closed

  const load = useCallback(() => {
    api
      .openings({
        company_id: companyId,
        source,
        status: view === 'closed' ? 'closed' : 'open',
        starred: view === 'starred' ? 1 : undefined,
        hidden: view === 'hidden' ? 1 : undefined,
        days: view === 'new' ? 7 : undefined,
      })
      .then(setOpenings);
  }, [companyId, source, view]);

  useEffect(load, [load]);
  useEffect(() => {
    api.companies().then(setCompanies);
    api.scanStatus().then(setScan);
  }, []);

  // While scanning, poll and refresh the list so results appear as companies finish.
  useEffect(() => {
    if (!scan?.running) return;
    const t = setTimeout(async () => {
      setScan(await api.scanStatus());
      load();
    }, 3000);
    return () => clearTimeout(t);
  }, [scan, load]);

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  // Search words all have to match title, company or location ("java cairo", "integration").
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!openings || !words.length) return openings ?? [];
    return openings.filter((o) => {
      const hay = `${o.title} ${o.company_name} ${o.location ?? ''}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [openings, q]);

  const companyCount = new Set(shown.map((o) => o.company_id)).size;
  const scanned = companies.filter((c) => c.openings_scanned_at).length;

  async function patch(o: Opening, data: { starred?: boolean; hidden?: boolean }) {
    setOpenings((prev) =>
      (prev ?? [])
        .map((x) => (x.id === o.id ? { ...x, ...('starred' in data ? { starred: data.starred ? 1 : 0 } : {}), ...('hidden' in data ? { hidden: data.hidden ? 1 : 0 } : {}) } as Opening : x))
        .filter((x) => !('hidden' in data) || x.id !== o.id),
    );
    await api.updateOpening(o.id, data);
  }

  async function applied(o: Opening) {
    const job = await api.appliedToOpening(o.id);
    navigate(`/jobs/${job.id}?edit=1`);
  }

  const VIEWS: [string, string][] = [
    ['open', 'All open'],
    ['new', 'New this week'],
    ['starred', 'Starred'],
    ['closed', 'Closed'],
    ['hidden', 'Hidden'],
  ];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Openings</h1>
          <p className="mt-1 text-sm text-muted">
            Positions your companies have open on LinkedIn and their own careers pages.
            {scan?.last_scan && ` Last checked ${dmyTime(scan.last_scan)}.`}
          </p>
        </div>
        <button className="btn-primary" disabled={scan?.running} onClick={() => api.scanOpenings().then(setScan)}>
          <Icon name="refresh" />
          {scan?.running ? `Checking ${scan.done + 1} of ${scan.total}…` : scanned ? 'Check all companies again' : 'Find openings'}
        </button>
      </header>

      {scan?.running && (
        <div className="card px-5 py-3 text-sm">
          <div className="flex justify-between gap-4">
            <span className="truncate text-muted">
              Checking <span className="text-fg">{scan.current ?? '…'}</span> · {scan.found} positions found so far
            </span>
            <span className="tabular-nums text-muted">
              {scan.done}/{scan.total}
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-raised">
            <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${(scan.done / Math.max(scan.total, 1)) * 100}%` }} />
          </div>
          <p className="mt-2 text-xs text-muted">About 5–10 seconds per company. You can leave this page; it keeps going.</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap rounded-lg border border-line p-0.5">
          {VIEWS.map(([v, label]) => (
            <button
              key={v}
              onClick={() => setParam('view', v === 'open' ? '' : v)}
              className={`rounded-md px-3 py-1.5 text-sm transition ${view === v ? 'bg-brand/20 text-brand-light' : 'text-muted hover:text-fg'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="relative min-w-[220px] flex-1">
          <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            className="input pl-9"
            placeholder='Search title, company, location: "java cairo", "integration"'
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onBlur={() => setParam('q', q.trim())}
          />
        </div>
        <select className="input w-auto" value={companyId} onChange={(e) => setParam('company', e.target.value)}>
          <option value="">All companies</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select className="input w-auto" value={source} onChange={(e) => setParam('source', e.target.value)}>
          <option value="">LinkedIn and websites</option>
          <option value="linkedin">LinkedIn only</option>
          <option value="website">Company websites only</option>
        </select>
      </div>

      {openings === null ? (
        <p className="text-muted">Loading…</p>
      ) : !scanned && !scan?.running ? (
        <div className="card p-10 text-center">
          <p className="text-lg font-medium">No openings checked yet</p>
          <p className="mx-auto mt-1 max-w-lg text-sm text-muted">
            Click <span className="text-fg">Find openings</span> to look up every company's public LinkedIn jobs and its careers page. It takes a few
            minutes for all {companies.length} companies.
          </p>
        </div>
      ) : shown.length === 0 ? (
        <div className="card p-10 text-center text-muted">No openings match.</div>
      ) : (
        <>
          <p className="text-sm text-muted">
            {shown.length} {shown.length === 1 ? 'position' : 'positions'} at {companyCount} {companyCount === 1 ? 'company' : 'companies'}
          </p>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                  <th className="w-10 px-2 py-3" aria-label="Starred" />
                  <th className="px-4 py-3 font-medium">Position</th>
                  <th className="px-4 py-3 font-medium">Company</th>
                  <th className="hidden px-4 py-3 font-medium md:table-cell">Location</th>
                  <th className="hidden px-4 py-3 font-medium sm:table-cell">Posted</th>
                  <th className="px-4 py-3 text-right font-medium">Your application</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {shown.map((o) => (
                  <tr key={o.id} className={`transition hover:bg-raised/60 ${o.closed_at ? 'opacity-60' : ''}`}>
                    <td className="px-2 py-3 text-center">
                      <StarButton starred={!!o.starred} onToggle={() => patch(o, { starred: !o.starred })} />
                    </td>
                    <td className="px-4 py-3">
                      {o.url ? (
                        <a href={o.url} target="_blank" rel="noreferrer" className="font-medium hover:text-brand-light">
                          {o.title}
                        </a>
                      ) : (
                        <span className="font-medium">{o.title}</span>
                      )}
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                        <span className={`chip px-1.5 ${o.source === 'linkedin' ? 'bg-sky-500/10 text-sky-300' : 'bg-violet-500/10 text-violet-300'}`}>
                          {o.source === 'linkedin' ? 'LinkedIn' : 'Website'}
                        </span>
                        {sqlToDate(o.first_seen) > new Date(Date.now() - 3 * 86400000) && !o.closed_at && (
                          <span className="chip bg-emerald-500/15 px-1.5 text-emerald-300">New</span>
                        )}
                        {o.closed_at && <span>Gone since {fmtDate(o.closed_at)}</span>}
                        <span className="md:hidden">{o.location}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Link to={`/companies/${o.company_id}`} className="flex items-center gap-2 text-muted hover:text-brand-light">
                        <CompanyLogo id={o.company_id} name={o.company_name} logoAt={o.logo_at} size="sm" />
                        <span className="truncate">{o.company_name}</span>
                      </Link>
                    </td>
                    <td className="hidden px-4 py-3 text-muted md:table-cell">{o.location ?? '—'}</td>
                    <td className="hidden whitespace-nowrap px-4 py-3 tabular-nums text-muted sm:table-cell">{fmtDate(o.posted_at)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      {o.job_id ? (
                        <Link to={`/jobs/${o.job_id}`}>
                          <StageBadge name={o.job_stage_name ?? 'Applied'} color={o.job_stage_color ?? '#199e70'} />
                        </Link>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          <button className="btn-ghost px-2.5 py-1 text-xs" onClick={() => applied(o)} title="Log this as an application">
                            I applied
                          </button>
                          <button
                            className="rounded-md p-1.5 text-muted hover:text-fg"
                            onClick={() => patch(o, { hidden: !o.hidden })}
                            title={o.hidden ? 'Show again' : 'Not interested: hide it'}
                            aria-label={o.hidden ? 'Show again' : 'Hide'}
                          >
                            <Icon name={o.hidden ? 'up' : 'x'} />
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
