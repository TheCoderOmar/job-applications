import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import JobForm from '../components/JobForm';
import Icon, { type IconName } from '../components/Icon';
import { ContactForm } from './Contacts';
import { api } from '../api';
import type { LinkedInCompany } from '../types';

type Kind = 'job' | 'company' | 'contact';
const HEADINGS: Record<Kind, { title: string; icon: IconName }> = {
  job: { title: 'Log application', icon: 'briefcase' },
  company: { title: 'Add company', icon: 'building' },
  contact: { title: 'Add person', icon: 'users' },
};

/**
 * The browser extension's small window, for the page you were on:
 * - a job or a recruiter's post (?import=<link>&title=…): the "Log application" form, filled from it;
 * - a LinkedIn company page (?kind=company): the company with all its offices;
 * - a LinkedIn profile (?kind=contact): the person, and their company if you don't have it.
 * &page=<id> when the extension sent the page itself. Saving closes the window.
 */
export default function QuickAdd() {
  const [params] = useSearchParams();
  const url = params.get('import') ?? '';
  const title = params.get('title') ?? '';
  const page = params.get('page') ?? undefined;
  const kind: Kind = params.get('kind') === 'company' ? 'company' : params.get('kind') === 'contact' ? 'contact' : 'job';
  const [saved, setSaved] = useState<{ text: string; href: string } | null>(null);

  function done(text: string, href: string) {
    setSaved({ text, href });
    // Windows the extension opened can close themselves; if the browser refuses, the message stays.
    setTimeout(() => window.close(), 1500);
  }

  if (saved)
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <div>
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-emerald-500/15 text-emerald-300">
            <Icon name="check" className="h-6 w-6" />
          </div>
          <p className="font-semibold">{saved.text}</p>
          <p className="mt-1 text-sm text-muted">You can close this window.</p>
          <a href={saved.href} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm text-brand-light hover:underline">
            Open it in the app
          </a>
        </div>
      </div>
    );

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl p-4">
        <h1 className="mb-4 flex items-center gap-2 text-lg font-semibold">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-brand/15 text-brand-light">
            <Icon name={HEADINGS[kind].icon} className="h-4 w-4" />
          </span>
          {HEADINGS[kind].title}
        </h1>
        {kind === 'company' ? (
          <CompanyImport url={url} page={page} onDone={done} />
        ) : kind === 'contact' ? (
          <ContactForm
            initial={{ linkedin_url: url }}
            autoImportPage={page ?? null}
            onCancel={() => window.close()}
            onSaved={(c) => done(`Saved ${c.full_name}`, `/contacts`)}
          />
        ) : (
          <JobForm
            initial={url ? { url, title: title || undefined } : undefined}
            autoImport={url || undefined}
            autoImportPage={page}
            onCancel={() => window.close()}
            onSaved={(j) => done(`Saved "${j.title}"`, `/jobs/${j.id}`)}
          />
        )}
      </div>
    </div>
  );
}

/** A LinkedIn company page → preview, then add it with all its offices (or add the new offices to the one you have). */
function CompanyImport({ url, page, onDone }: { url: string; page?: string; onDone: (text: string, href: string) => void }) {
  const [data, setData] = useState<LinkedInCompany | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.linkedInCompany(url, page).then(setData, (e) => setError((e as Error).message));
  }, [url, page]);

  async function save() {
    if (!data) return;
    setSaving(true);
    setError('');
    try {
      if (data.existing) {
        const r = await api.addLocations(data.existing.id, data.locations);
        onDone(
          r.added ? `Added ${r.added} location${r.added === 1 ? '' : 's'} to ${data.existing.name}` : `${data.existing.name} already has these locations`,
          `/companies/${data.existing.id}`,
        );
      } else {
        const { existing: _e, logo_url: _l, locations, ...rest } = data;
        const c = await api.createCompany({ ...rest, name: data.name ?? '', locations: locations.map((l) => ({ ...l })) });
        onDone(`Added ${c.name}`, `/companies/${c.id}`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (error && !data) return <p className="rounded-lg border border-red-500/40 px-4 py-3 text-sm text-red-300">{error}</p>;
  if (!data) return <p className="text-sm text-muted">Reading the company from LinkedIn…</p>;

  const facts = [data.industry, data.company_size, data.headquarters && `HQ ${data.headquarters}`, data.founded && `Founded ${data.founded}`].filter(Boolean);
  return (
    <div className="space-y-4">
      <div className="card flex items-start gap-3 p-4">
        {data.logo_url ? (
          <img src={data.logo_url} alt="" className="h-12 w-12 shrink-0 rounded-lg bg-white object-contain p-1" />
        ) : (
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-raised text-muted">
            <Icon name="building" />
          </span>
        )}
        <div className="min-w-0">
          <p className="font-semibold">{data.name}</p>
          {facts.length > 0 && <p className="text-sm text-muted">{facts.join(' · ')}</p>}
          {data.website && <p className="truncate text-sm text-brand-light">{data.website.replace(/^https?:\/\/(www\.)?/, '')}</p>}
        </div>
      </div>

      <section>
        <h2 className="label">{data.locations.length ? `Locations (${data.locations.length})` : 'Locations'}</h2>
        {data.locations.length ? (
          <ul className="space-y-2">
            {data.locations.map((l, i) => (
              <li key={i} className="rounded-lg border border-line bg-ink/40 px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">{[l.city, l.country].filter(Boolean).join(', ') || 'Office'}</span>
                  {l.is_primary && <span className="chip border border-brand/40 bg-brand/10 text-brand-light">Primary</span>}
                </div>
                {l.label && <div className="text-xs text-muted">{l.label}</div>}
                {l.address && <div className="text-muted">{l.address}</div>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">LinkedIn didn't list any locations. You can add them on the company page later.</p>
        )}
        {data.locations.length > 0 && <p className="mt-2 text-xs text-muted">Each location is put on the map from its address after you save.</p>}
      </section>

      {data.existing && (
        <p className="rounded-lg border border-amber-400/30 bg-amber-400/5 px-3 py-2 text-sm text-amber-200">
          You already have {data.existing.name}
          {data.existing.location_count ? ` with ${data.existing.location_count} location${data.existing.location_count === 1 ? '' : 's'}` : ''}. Only
          locations it doesn't have yet are added.
        </p>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={() => window.close()}>
          Cancel
        </button>
        {data.existing && !data.locations.length ? (
          <a className="btn-primary" href={`/companies/${data.existing.id}`} target="_blank" rel="noreferrer">
            Open {data.existing.name}
          </a>
        ) : (
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : data.existing ? 'Add new locations' : 'Add company'}
          </button>
        )}
      </div>
    </div>
  );
}
