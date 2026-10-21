import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { MapContainer, Marker } from 'react-leaflet';
import { api } from '../api';
import { WORK_TYPE_LABELS, type Company, type Home, type Job, type Opening, type Stage } from '../types';
import Icon, { type IconName } from '../components/Icon';
import Modal from '../components/Modal';
import CompanyForm from '../components/CompanyForm';
import CurrentBadge from '../components/CurrentBadge';
import CompanyLogo from '../components/CompanyLogo';
import JobForm from '../components/JobForm';
import { ConnectionsPanel } from '../components/Contacts';
import { StageSelect } from '../components/Stage';
import { DarkTiles, distanceKm, formatKm, homeIcon, pinIcon } from '../mapConfig';
import { locationText } from './Companies';
import { dmy } from '../dates';

export default function CompanyDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [company, setCompany] = useState<Company | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [modal, setModal] = useState<'edit' | 'job' | null>(null);
  const [error, setError] = useState('');
  const [home, setHome] = useState<Home | null>(null);

  const load = useCallback(() => {
    api.company(id!).then(setCompany).catch((e) => setError(e.message));
    api.jobs({ company_id: id }).then(setJobs);
  }, [id]);

  useEffect(() => {
    load();
    api.stages().then(setStages);
    api.home().then(setHome);
  }, [load]);

  async function remove() {
    if (!company) return;
    if (!confirm(`Delete ${company.name} and its ${company.job_count} job(s)? This cannot be undone.`)) return;
    await api.deleteCompany(company.id);
    navigate('/companies');
  }

  async function changeStage(job: Job, stageId: number) {
    await api.setJobStage(job.id, stageId);
    api.jobs({ company_id: id }).then(setJobs);
  }

  if (error) return <p className="text-red-400">{error}</p>;
  if (!company) return <p className="text-muted">Loading…</p>;

  const hasPin = company.lat != null && company.lng != null;
  const fromHome = home && hasPin ? formatKm(distanceKm(home, { lat: company.lat!, lng: company.lng! })) : null;

  return (
    <div className="space-y-6">
      <Link to="/companies" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-brand-light">
        <Icon name="arrowLeft" /> Companies
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <LogoMenu company={company} onChange={load} />
          <div>
            <h1 className="page-title flex items-center gap-3">
              {company.name}
              {company.is_remote ? (
                <span className="chip border border-cyan-400/40 bg-cyan-400/10 text-cyan-300">
                  <Icon name="globe" className="h-3 w-3" /> Remote
                </span>
              ) : null}
              {company.is_current ? <CurrentBadge /> : null}
            </h1>
            <p className="mt-1 text-sm text-muted">{[company.industry, locationText(company)].filter(Boolean).join(' · ')}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={() => setModal('edit')}>
            <Icon name="edit" /> Edit
          </button>
          <button className="btn-danger" onClick={remove}>
            <Icon name="trash" /> Delete
          </button>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-1">
        <section className="card space-y-4 p-5">
          <div className="space-y-2">
            {company.website && <ExtLink href={company.website} icon="link" label={company.website.replace(/^https?:\/\/(www\.)?/, '')} />}
            {company.linkedin && (
              <ExtLink
                href={company.linkedin}
                icon="linkedin"
                label={/linkedin\.com\/search\//i.test(company.linkedin) ? 'Search on LinkedIn' : 'LinkedIn page'}
              />
            )}
            {company.linkedin && /linkedin\.com\/search\//i.test(company.linkedin) && (
              <p className="rounded-lg border border-amber-400/30 bg-amber-400/5 px-3 py-2 text-xs text-amber-200">
                This is a LinkedIn search, not the company page. Open it, copy the company's page link, then click Edit and paste it under
                "LinkedIn company page" to fill in the logo and details.
              </p>
            )}
            {company.careers_url && <ExtLink href={company.careers_url} icon="briefcase" label="Careers page" />}
          </div>
          {(company.company_size || company.founded || company.headquarters || fromHome) && (
            <dl className="space-y-1.5 border-t border-line pt-4 text-sm">
              {company.headquarters && <Fact label="Headquarters" value={company.headquarters} />}
              {company.company_size && <Fact label="Size" value={company.company_size} />}
              {company.founded && <Fact label="Founded" value={company.founded} />}
              {fromHome && <Fact label="From home" value={`~${fromHome} (straight line)`} />}
            </dl>
          )}
          {company.address && <p className="text-sm text-muted">{company.address}</p>}
          {company.maps_link && (
            <a href={company.maps_link} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm text-brand-light hover:underline">
              <Icon name="external" /> Open in Google Maps
            </a>
          )}
          {hasPin ? (
            <div className="h-56 overflow-hidden rounded-lg border border-line">
              <MapContainer center={[company.lat!, company.lng!]} zoom={13} scrollWheelZoom={false} className="h-full w-full">
                <DarkTiles />
                <Marker position={[company.lat!, company.lng!]} icon={pinIcon(!!company.is_remote)} />
                {home && <Marker position={[home.lat, home.lng]} icon={homeIcon} />}
              </MapContainer>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-line p-4 text-center text-sm text-muted">
              No map location. Edit the company and paste a Google Maps link.
            </div>
          )}
          {company.description && (
            <div>
              <div className="label">About</div>
              <p className="line-clamp-6 whitespace-pre-wrap text-sm text-fg/90" title={company.description}>
                {company.description}
              </p>
            </div>
          )}
          {company.notes && (
            <div>
              <div className="label">Notes</div>
              <p className="whitespace-pre-wrap text-sm">{company.notes}</p>
            </div>
          )}
        </section>
        <OpeningsPanel company={company} onScanned={load} />
        <ConnectionsPanel companyId={company.id} companyName={company.name} />
        </div>

        <section className="card p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold">Jobs ({jobs.length})</h2>
            <button className="btn-primary" onClick={() => setModal('job')}>
              <Icon name="plus" /> Add job
            </button>
          </div>
          {jobs.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">No jobs at this company yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {jobs.map((j) => (
                <li key={j.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <Link to={`/jobs/${j.id}`} className="min-w-0 flex-1 hover:text-brand-light">
                    <div className="truncate font-medium">{j.title}</div>
                    <div className="text-xs text-muted">
                      {WORK_TYPE_LABELS[j.location_type]}
                      {j.applied_date && ` · applied ${dmy(j.applied_date)}`}
                    </div>
                  </Link>
                  <StageSelect stages={stages} value={j.stage_id} onChange={(s) => changeStage(j, s)} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {modal === 'edit' && (
        <Modal title="Edit company" onClose={() => setModal(null)}>
          <CompanyForm
            initial={company}
            onCancel={() => setModal(null)}
            onSaved={() => {
              setModal(null);
              load();
            }}
          />
        </Modal>
      )}
      {modal === 'job' && (
        <Modal title={`Add job at ${company.name}`} onClose={() => setModal(null)} wide>
          <JobForm
            initial={{ company_id: company.id }}
            onCancel={() => setModal(null)}
            onSaved={() => {
              setModal(null);
              load();
            }}
          />
        </Modal>
      )}
    </div>
  );
}


function ExtLink({ href, icon, label }: { href: string; icon: IconName; label: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm text-brand-light hover:underline">
      <Icon name={icon} className="h-4 w-4 shrink-0" /> <span className="truncate">{label}</span>
    </a>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

/** Logo with a small menu: look it up again, use your own image, or remove it. */
function LogoMenu({ company, onChange }: { company: Company; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState('');

  async function refresh() {
    setOpen(false);
    setBusy('Looking for the logo…');
    await api.refreshLogo(company.id);
    // The lookup runs in the background; check back until it's done.
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const st = await api.logoStatus();
      if (!st.running) break;
    }
    setBusy('');
    onChange();
  }

  function upload(file: File) {
    setOpen(false);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await api.uploadLogo(company.id, String(reader.result));
        onChange();
      } catch (e) {
        alert((e as Error).message);
      }
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="block rounded-xl shadow-glow" aria-label="Change logo" title={busy || 'Change logo'}>
        <CompanyLogo id={company.id} name={company.name} logoAt={company.logo_at} size="lg" />
        {busy && <span className="absolute inset-0 grid place-items-center rounded-xl bg-ink/70 text-[10px] text-muted">…</span>}
      </button>
      {open && (
        <div className="absolute left-0 top-16 z-20 w-56 rounded-lg border border-line bg-surface py-1 text-sm shadow-glow">
          {(company.linkedin || company.website) && (
            <button className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-raised" onClick={refresh}>
              <Icon name="refresh" /> Look up logo again
            </button>
          )}
          <label className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 hover:bg-raised">
            <Icon name="upload" /> Use my own image
            <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </label>
          {company.logo_at && (
            <button
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-red-300 hover:bg-raised"
              onClick={async () => {
                setOpen(false);
                await api.removeLogo(company.id);
                onChange();
              }}
            >
              <Icon name="trash" /> Remove logo
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Open positions found for this company, with a link to see them all on the Openings page. */
function OpeningsPanel({ company, onScanned }: { company: Company; onScanned: () => void }) {
  const [rows, setRows] = useState<Opening[] | null>(null);
  const [checking, setChecking] = useState(false);

  const loadRows = useCallback(() => {
    api.openings({ company_id: company.id }).then(setRows);
  }, [company.id]);
  useEffect(loadRows, [loadRows]);

  async function check() {
    setChecking(true);
    await api.scanOpenings([company.id]);
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      if (!(await api.scanStatus()).running) break;
    }
    setChecking(false);
    loadRows();
    onScanned();
  }

  const careers = company.careers_url || company.careers_found_url;

  return (
    <section className="card p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">
          Open positions {rows && rows.length > 0 && <span className="text-sm font-normal text-muted">{rows.length}</span>}
        </h2>
        <button className="btn-ghost px-2.5 py-1 text-xs" onClick={check} disabled={checking}>
          <Icon name="refresh" /> {checking ? 'Checking…' : company.openings_scanned_at ? 'Check again' : 'Check now'}
        </button>
      </div>
      {rows === null ? (
        <p className="mt-2 text-sm text-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{company.openings_scanned_at ? 'None found.' : 'Not checked yet.'}</p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {rows.slice(0, 6).map((o) => (
            <li key={o.id} className="py-2 text-sm">
              <a href={o.url ?? undefined} target="_blank" rel="noreferrer" className="font-medium hover:text-brand-light">
                {o.title}
              </a>
              <div className="text-xs text-muted">
                {[o.location, o.source === 'linkedin' ? 'LinkedIn' : 'Website'].filter(Boolean).join(' · ')}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {rows && rows.length > 0 && (
          <Link to={`/openings?company=${company.id}`} className="text-brand-light hover:underline">
            See all {rows.length}
          </Link>
        )}
        {careers && (
          <a href={careers} target="_blank" rel="noreferrer" className="text-brand-light hover:underline">
            Careers page
          </a>
        )}
      </div>
      {company.openings_note && <p className="mt-2 text-xs text-muted">{company.openings_note}</p>}
    </section>
  );
}
