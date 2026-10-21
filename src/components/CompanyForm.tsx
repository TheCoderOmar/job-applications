import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { Company, LinkedInCompany } from '../types';
import Icon from './Icon';

interface Props {
  initial?: Company;
  onSaved: (c: Company) => void;
  onCancel: () => void;
}

type Draft = Omit<Partial<Company>, 'lat' | 'lng'> & { lat?: string; lng?: string };

export default function CompanyForm({ initial, onSaved, onCancel }: Props) {
  const [d, setD] = useState<Draft>({
    ...initial,
    lat: initial?.lat?.toString() ?? '',
    lng: initial?.lng?.toString() ?? '',
  });
  const [error, setError] = useState('');
  const [linkStatus, setLinkStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [liStatus, setLiStatus] = useState<{ text: string; error?: boolean; existing?: LinkedInCompany['existing'] } | null>(null);
  const [liLoading, setLiLoading] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((prev) => ({ ...prev, [k]: v }));

  async function readLink() {
    if (!d.maps_link) return;
    setLinkStatus('Reading link…');
    try {
      const r = await api.resolveMapsLink(d.maps_link);
      setD((prev) => ({ ...prev, lat: r.lat.toFixed(6), lng: r.lng.toFixed(6) }));
      setLinkStatus(`Found ${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}`);
    } catch (e) {
      setLinkStatus((e as Error).message + ' Enter latitude/longitude manually.');
    }
  }

  /** Fills the form from the public LinkedIn page. Fields you already typed are kept. */
  async function fillFromLinkedIn() {
    if (!d.linkedin?.trim()) return;
    setLiLoading(true);
    setLiStatus({ text: 'Reading the LinkedIn page…' });
    try {
      const li = await api.linkedInCompany(d.linkedin);
      const [city, country] = splitPlace(li.headquarters);
      const filled: string[] = [];
      setD((prev) => {
        const next = { ...prev, linkedin: li.linkedin };
        const fill = (k: keyof Draft, v: string | null, label: string) => {
          if (v && !String(prev[k] ?? '').trim()) {
            (next as Record<string, unknown>)[k] = v;
            filled.push(label);
          }
        };
        fill('name', li.name, 'name');
        fill('website', li.website, 'website');
        fill('industry', li.industry, 'industry');
        fill('company_size', li.company_size, 'size');
        fill('founded', li.founded, 'founded');
        fill('headquarters', li.headquarters, 'headquarters');
        fill('description', li.description, 'about');
        if (!prev.lat && !prev.address) {
          fill('city', city, 'city');
          fill('country', country, 'country');
        }
        return next;
      });
      setLogoUrl(li.logo_url);
      const same = li.existing && li.existing.id !== initial?.id ? li.existing : null;
      setLiStatus({
        text: same
          ? `You already have ${same.name}.`
          : filled.length
            ? `Filled in ${filled.join(', ')}. The logo is saved with the company.`
            : 'Nothing new to fill in: every field already has a value.',
        existing: same,
      });
    } catch (err) {
      setLiStatus({ text: (err as Error).message, error: true });
    } finally {
      setLiLoading(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    const payload = { ...d, lat: d.lat === '' ? null : Number(d.lat), lng: d.lng === '' ? null : Number(d.lng) };
    try {
      const saved = initial
        ? await api.updateCompany(initial.id, payload as Partial<Company>)
        : await api.createCompany(payload as Partial<Company>);
      onSaved(saved);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="rounded-lg border border-brand/30 bg-brand/5 p-4">
        <label className="label">LinkedIn company page</label>
        <div className="flex gap-2">
          <input
            className="input"
            placeholder="https://www.linkedin.com/company/…"
            autoFocus={!initial}
            value={d.linkedin ?? ''}
            onChange={(e) => set('linkedin', e.target.value)}
            onPaste={(e) => {
              const pasted = e.clipboardData.getData('text');
              if (/linkedin\.com\/(company|school|showcase)\//i.test(pasted)) setTimeout(() => document.getElementById('li-fill')?.click(), 0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                fillFromLinkedIn();
              }
            }}
          />
          <button id="li-fill" type="button" className="btn-ghost shrink-0" onClick={fillFromLinkedIn} disabled={!d.linkedin?.trim() || liLoading}>
            <Icon name="linkedin" /> {liLoading ? 'Reading…' : 'Fill from LinkedIn'}
          </button>
        </div>
        <div className="mt-2 flex items-center gap-3">
          {logoUrl && <img src={logoUrl} alt="" className="h-9 w-9 rounded-md bg-white object-contain p-0.5" />}
          <p className={`text-xs ${liStatus?.error ? 'text-red-400' : 'text-muted'}`}>
            {liStatus?.text ?? 'Paste the link to fill in the name, website, industry, size, headquarters and logo.'}
            {liStatus?.existing && (
              <>
                {' '}
                <Link to={`/companies/${liStatus.existing.id}`} className="text-brand-light hover:underline">
                  Open it
                </Link>
              </>
            )}
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label">Company name *</label>
          <input className="input" required autoFocus={!!initial} value={d.name ?? ''} onChange={(e) => set('name', e.target.value)} />
        </div>
        <div>
          <label className="label">Website</label>
          <input className="input" placeholder="https://" value={d.website ?? ''} onChange={(e) => set('website', e.target.value)} />
        </div>
        <div>
          <label className="label">Careers page</label>
          <input className="input" placeholder="https://" value={d.careers_url ?? ''} onChange={(e) => set('careers_url', e.target.value)} />
        </div>
        <div>
          <label className="label">Industry</label>
          <input className="input" value={d.industry ?? ''} onChange={(e) => set('industry', e.target.value)} />
        </div>
        <div>
          <label className="label">Company size</label>
          <input
            className="input"
            placeholder="e.g. 201-500 employees"
            value={d.company_size ?? ''}
            onChange={(e) => set('company_size', e.target.value)}
          />
        </div>
        <div>
          <label className="label">Founded</label>
          <input className="input" placeholder="e.g. 2005" value={d.founded ?? ''} onChange={(e) => set('founded', e.target.value)} />
        </div>
        <div>
          <label className="label">Headquarters</label>
          <input
            className="input"
            placeholder="e.g. Riyadh, Saudi Arabia"
            value={d.headquarters ?? ''}
            onChange={(e) => set('headquarters', e.target.value)}
          />
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-line bg-ink/50 px-3 py-2.5">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[#3b82f6]"
            checked={!!d.is_remote}
            onChange={(e) => set('is_remote', e.target.checked ? 1 : 0)}
          />
          <span className="text-sm">
            Remote company <span className="text-muted">(on the map only with "Show remote")</span>
          </span>
        </label>
        <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-line bg-ink/50 px-3 py-2.5">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[#3b82f6]"
            checked={!!d.is_current}
            onChange={(e) => set('is_current', e.target.checked ? 1 : 0)}
          />
          <span className="text-sm">I currently work here</span>
        </label>
      </div>

      <fieldset className="space-y-4 rounded-lg border border-line p-4">
        <legend className="px-1 text-xs font-medium uppercase tracking-wide text-brand-light">Location</legend>
        <div>
          <label className="label">Google Maps link</label>
          <div className="flex gap-2">
            <input
              className="input"
              placeholder="https://maps.app.goo.gl/… or https://www.google.com/maps/…"
              value={d.maps_link ?? ''}
              onChange={(e) => set('maps_link', e.target.value)}
              onBlur={() => d.maps_link && !d.lat && readLink()}
            />
            <button type="button" className="btn-ghost shrink-0" onClick={readLink} disabled={!d.maps_link}>
              Read link
            </button>
          </div>
          {linkStatus && <p className="mt-1.5 text-xs text-muted">{linkStatus}</p>}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Latitude</label>
            <input className="input" inputMode="decimal" value={d.lat ?? ''} onChange={(e) => set('lat', e.target.value)} />
          </div>
          <div>
            <label className="label">Longitude</label>
            <input className="input" inputMode="decimal" value={d.lng ?? ''} onChange={(e) => set('lng', e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Address</label>
            <input className="input" value={d.address ?? ''} onChange={(e) => set('address', e.target.value)} />
          </div>
          <div>
            <label className="label">City</label>
            <input className="input" value={d.city ?? ''} onChange={(e) => set('city', e.target.value)} />
          </div>
          <div>
            <label className="label">Country</label>
            <input className="input" value={d.country ?? ''} onChange={(e) => set('country', e.target.value)} />
          </div>
        </div>
      </fieldset>

      <div>
        <label className="label">About</label>
        <textarea className="input min-h-[80px]" value={d.description ?? ''} onChange={(e) => set('description', e.target.value)} />
      </div>

      <div>
        <label className="label">Notes</label>
        <textarea className="input min-h-[80px]" value={d.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn-primary" disabled={saving}>
          {saving ? 'Saving…' : initial ? 'Save changes' : 'Add company'}
        </button>
      </div>
    </form>
  );
}

/** "Cairo, Egypt" → ["Cairo", "Egypt"]; "London" → ["London", null]. */
function splitPlace(hq: string | null): [string | null, string | null] {
  if (!hq) return [null, null];
  const parts = hq.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return [parts[0] ?? null, null];
  return [parts[0], parts[parts.length - 1]];
}
