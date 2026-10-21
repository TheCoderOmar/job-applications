import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import type { Company, LogoStatus } from '../types';
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

  const load = () => api.companies().then(setCompanies);
  useEffect(() => {
    load();
    api.logoStatus().then(setLogos);
  }, []);

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
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
              <div className="mt-4 flex items-center justify-between text-sm">
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
                  <span>
                    <span className="font-semibold text-fg">{c.job_count}</span> {c.job_count === 1 ? 'job' : 'jobs'}
                  </span>
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
