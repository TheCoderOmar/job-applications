import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { Home, Stage, StageKind } from '../types';
import Icon from '../components/Icon';

const KIND_LABEL: Record<StageKind, string> = {
  active: 'Open',
  closed_won: 'Won (offer)',
  closed_lost: 'Closed / lost',
};

const COMPANY_COLS = ['website', 'linkedin', 'careers_url', 'industry', 'company_size', 'founded', 'headquarters', 'is_remote', 'is_current', 'address', 'city', 'country', 'lat', 'lng', 'maps_link'];

/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, newlines in quotes). */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') row.push(field), (field = '');
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field || row.length) row.push(field), rows.push(row);
  const [header, ...body] = rows.filter((r) => r.some((c) => c.trim() !== ''));
  if (!header) return [];
  const keys = header.map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

const truthy = (v: string | undefined) => /^(1|true|yes|y|remote)$/i.test(v ?? '');

function csvToImport(rows: Record<string, string>[]) {
  const isJobs = rows.length > 0 && 'title' in rows[0];
  if (!isJobs) {
    return {
      mode: 'merge',
      companies: rows.map((r) => ({ ...r, name: r.name ?? r.company, is_remote: truthy(r.is_remote) })),
      jobs: [],
    };
  }
  // A jobs CSV may also carry company columns; collect one company record per name.
  const companies = new Map<string, Record<string, unknown>>();
  for (const r of rows) {
    const name = r.company ?? r.company_name;
    if (!name || companies.has(name.toLowerCase())) continue;
    const c: Record<string, unknown> = { name };
    for (const k of COMPANY_COLS) if (r[k]) c[k] = r[k];
    c.is_remote = truthy(r.is_remote) || r.location_type === 'remote';
    companies.set(name.toLowerCase(), c);
  }
  return { mode: 'merge', companies: [...companies.values()], jobs: rows };
}

export default function Settings() {
  const [stages, setStages] = useState<Stage[]>([]);
  const [newName, setNewName] = useState('');
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.stages().then(setStages);
  }, []);

  const run = async (fn: () => Promise<Stage[]>) => {
    try {
      setStages(await fn());
      setMsg(null);
    } catch (e) {
      setMsg({ text: (e as Error).message, ok: false });
    }
  };

  const patchLocal = (id: number, patch: Partial<Stage>) =>
    setStages((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const save = (s: Stage) => run(() => api.updateStage(s.id, s));

  const move = (idx: number, dir: -1 | 1) => {
    const next = [...stages];
    const [item] = next.splice(idx, 1);
    next.splice(idx + dir, 0, item);
    setStages(next);
    run(() => api.reorderStages(next.map((s) => s.id)));
  };

  async function onFile(file: File) {
    setBusy(true);
    setMsg(null);
    try {
      const text = await file.text();
      let payload: unknown;
      if (file.name.toLowerCase().endsWith('.csv')) {
        payload = csvToImport(parseCsv(text));
      } else {
        const data = JSON.parse(text);
        const isFullExport = data.version && Array.isArray(data.stages) && Array.isArray(data.stage_history);
        if (isFullExport) {
          if (!confirm('This is a full backup. Restoring it REPLACES all current data. Continue?')) return;
          payload = { ...data, mode: 'replace' };
        } else {
          payload = { mode: 'merge', companies: data.companies ?? [], jobs: data.jobs ?? [] };
        }
      }
      const r = await api.import(payload);
      const skipped = r.skipped?.length ? ` Skipped ${r.skipped.length} row(s) with no title or company.` : '';
      setMsg({ text: `Imported ${r.companies} companies and ${r.jobs} jobs.${skipped}`, ok: true });
      setStages(await api.stages());
    } catch (e) {
      setMsg({ text: `Import failed: ${(e as Error).message}`, ok: false });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="page-title">Settings</h1>
        <p className="mt-1 text-sm text-muted">Customize your pipeline stages and move your data in or out.</p>
      </header>

      {msg && (
        <div className={`card px-4 py-3 text-sm ${msg.ok ? 'border-emerald-500/40 text-emerald-300' : 'border-red-500/40 text-red-300'}`}>
          {msg.text}
        </div>
      )}

      <section className="card p-5">
        <h2 className="font-semibold">Pipeline stages</h2>
        <p className="mt-0.5 text-xs text-muted">
          The order here is the order of your pipeline. A job counts as "applied" once it moves past the first stage.
        </p>
        <ul className="mt-4 space-y-2">
          {stages.map((s, i) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-ink/50 p-2">
              <div className="flex flex-col">
                <button className="rounded p-0.5 text-muted hover:text-fg disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                  <Icon name="up" className="h-3.5 w-3.5" />
                </button>
                <button
                  className="rounded p-0.5 text-muted hover:text-fg disabled:opacity-30"
                  disabled={i === stages.length - 1}
                  onClick={() => move(i, 1)}
                  aria-label="Move down"
                >
                  <Icon name="down" className="h-3.5 w-3.5" />
                </button>
              </div>
              <input
                type="color"
                value={s.color}
                onChange={(e) => patchLocal(s.id, { color: e.target.value })}
                onBlur={() => save(s)}
                className="h-8 w-10 cursor-pointer rounded border border-line bg-transparent"
                aria-label="Stage color"
              />
              <input
                className="input min-w-[140px] flex-1"
                value={s.name}
                onChange={(e) => patchLocal(s.id, { name: e.target.value })}
                onBlur={() => save(s)}
              />
              <select
                className="input w-auto"
                value={s.kind}
                onChange={(e) => {
                  const next = { ...s, kind: e.target.value as StageKind };
                  patchLocal(s.id, next);
                  save(next);
                }}
              >
                {Object.entries(KIND_LABEL).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
              <span className="w-16 text-right text-xs tabular-nums text-muted">{s.job_count} {s.job_count === 1 ? 'job' : 'jobs'}</span>
              <button
                className="rounded-md p-2 text-muted hover:bg-red-500/10 hover:text-red-300"
                onClick={() => confirm(`Delete stage "${s.name}"?`) && run(() => api.deleteStage(s.id))}
                aria-label="Delete stage"
              >
                <Icon name="trash" />
              </button>
            </li>
          ))}
        </ul>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newName.trim()) return;
            run(() => api.createStage({ name: newName.trim(), color: '#3987e5', kind: 'active' }));
            setNewName('');
          }}
        >
          <input className="input" placeholder="New stage name, e.g. Technical test" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <button className="btn-primary shrink-0">
            <Icon name="plus" /> Add stage
          </button>
        </form>
      </section>

      <HomeSection />
      <MapSearchSection />
      <StarterCompaniesSection />

      <section className="card p-5">
        <h2 className="font-semibold">Import & export</h2>
        <p className="mt-0.5 text-xs text-muted">Your data lives in data/jobs.db. Export a backup any time.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <a href="/api/export" className="btn-ghost" download>
            <Icon name="download" /> Export backup (JSON)
          </a>
          <button className="btn-ghost" disabled={busy} onClick={() => fileRef.current?.click()}>
            <Icon name="upload" /> {busy ? 'Importing…' : 'Import JSON or CSV'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,.csv"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
          />
        </div>
        <details className="mt-4 text-sm text-muted">
          <summary className="cursor-pointer text-brand-light">Import formats</summary>
          <div className="mt-3 space-y-3">
            <p>
              <b className="text-fg">Jobs CSV</b>: one row per job. Required: <code>company</code>, <code>title</code>.
              Optional: <code>stage</code> (stage name), <code>description</code>, <code>url</code>,{' '}
              <code>location_type</code> (onsite/hybrid/remote/unknown), <code>salary</code>, <code>applied_date</code> (YYYY-MM-DD),{' '}
              <code>notes</code>, and company columns <code>maps_link</code>, <code>city</code>, <code>country</code>,{' '}
              <code>is_remote</code>, <code>is_current</code>, <code>website</code>, <code>linkedin</code>, <code>careers_url</code>,{' '}
              <code>industry</code>, <code>company_size</code>, <code>founded</code>, <code>headquarters</code>.
            </p>
            <p>
              <b className="text-fg">Companies CSV</b>: no <code>title</code> column. Required: <code>name</code>. Optional: the
              company columns above, plus <code>lat</code>/<code>lng</code>.
            </p>
            <p>
              <b className="text-fg">JSON</b>: <code>{'{ "companies": [...], "jobs": [...] }'}</code> with the same fields, or a
              backup file from Export (restoring a backup replaces everything).
            </p>
            <p>Google Maps links are turned into map pins during import. Companies already in the app (same name) are skipped.</p>
          </div>
        </details>
      </section>
    </div>
  );
}

function HomeSection() {
  const [home, setHome] = useState<Home | null>(null);
  const [link, setLink] = useState('');
  const [label, setLabel] = useState('Home');
  const [status, setStatus] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.home().then((h) => {
      setHome(h);
      if (h) {
        setLink(h.link ?? '');
        setLabel(h.label);
      }
    });
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStatus(null);
    try {
      const h = await api.setHome({ link, label });
      setHome(h);
      setStatus({ text: `Saved: ${h.lat.toFixed(5)}, ${h.lng.toFixed(5)}`, ok: true });
    } catch (err) {
      setStatus({ text: (err as Error).message, ok: false });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card p-5">
      <h2 className="font-semibold">Home location</h2>
      <p className="mt-0.5 text-xs text-muted">Shown as a house pin on the map, with the distance to each company.</p>
      <form onSubmit={save} className="mt-4 grid gap-3 sm:grid-cols-[1fr_180px_auto]">
        <input
          className="input"
          placeholder="Google Maps link, e.g. https://maps.app.goo.gl/…"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          required
        />
        <input className="input" placeholder="Label" value={label} onChange={(e) => setLabel(e.target.value)} />
        <button className="btn-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save home'}
        </button>
      </form>
      {status && <p className={`mt-2 text-xs ${status.ok ? 'text-emerald-300' : 'text-red-300'}`}>{status.text}</p>}
      {home && !status && (
        <p className="mt-2 text-xs text-muted">
          Current: {home.label} at {home.lat.toFixed(5)}, {home.lng.toFixed(5)}
        </p>
      )}
    </section>
  );
}

/** Optional Google Maps key: exact pins for company addresses. Without one, OpenStreetMap finds them (free, sometimes approximate). */
function MapSearchSection() {
  const [state, setState] = useState<{ set: boolean; hint: string | null } | null>(null);
  const [key, setKey] = useState('');
  const [status, setStatus] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.googleKey().then(setState);
  }, []);

  async function save(value: string) {
    setBusy(true);
    setStatus(null);
    try {
      const r = await api.setGoogleKey(value);
      setState(r);
      setKey('');
      setStatus({
        text: r.set ? 'Saved. Addresses OpenStreetMap could not find are being looked up again with Google.' : 'Removed. OpenStreetMap is used again.',
        ok: true,
      });
    } catch (err) {
      setStatus({ text: (err as Error).message, ok: false });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card p-5">
      <h2 className="font-semibold">Finding addresses on the map</h2>
      <p className="mt-0.5 text-xs text-muted">
        Company addresses are put on the map with OpenStreetMap: free, no setup, but some pins land on the street or district instead of the
        building. A Google Maps API key (from Google Cloud, with the Geocoding API turned on) gives exact pins; Google's free monthly credit
        covers personal use. You can always fix a pin by pasting a Google Maps link on the company.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save(key);
        }}
        className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_auto]"
      >
        <input
          className="input"
          type="password"
          autoComplete="off"
          placeholder={state?.set ? `Google key saved (${state.hint})` : 'Google Maps API key (optional)'}
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <button className="btn-primary" disabled={busy || !key.trim()}>
          {busy ? 'Saving…' : 'Save key'}
        </button>
        {state?.set && (
          <button type="button" className="btn-ghost" disabled={busy} onClick={() => save('')}>
            Remove key
          </button>
        )}
      </form>
      {status && <p className={`mt-2 text-xs ${status.ok ? 'text-emerald-300' : 'text-red-300'}`}>{status.text}</p>}
      {!status && (
        <p className="mt-2 text-xs text-muted">{state?.set ? `Using Google (key ${state.hint}).` : 'Using OpenStreetMap.'}</p>
      )}
    </section>
  );
}

/** The companies the app ships with: add back any you don't have (same name = skipped). */
function StarterCompaniesSection() {
  const [info, setInfo] = useState<{ total: number; missing: number } | null>(null);
  const [status, setStatus] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.defaultCompanies().then(setInfo);
  }, []);

  async function load() {
    setBusy(true);
    setStatus(null);
    try {
      const r = await api.loadDefaultCompanies();
      setInfo((i) => i && { ...i, missing: 0 });
      setStatus({ text: r.added ? `Added ${r.added} companies.` : 'You already have all of them.', ok: true });
    } catch (err) {
      setStatus({ text: (err as Error).message, ok: false });
    } finally {
      setBusy(false);
    }
  }

  if (!info?.total) return null;
  return (
    <section className="card p-5">
      <h2 className="font-semibold">Starter companies</h2>
      <p className="mt-0.5 text-xs text-muted">
        The app comes with {info.total} tech companies and banks in Egypt and the Gulf, with their locations and logos. A new install starts with
        them; add back any you deleted here. Companies you already have (same name) are skipped.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button className="btn-ghost" onClick={load} disabled={busy || info.missing === 0}>
          <Icon name="building" /> {busy ? 'Adding…' : info.missing ? `Add ${info.missing} starter companies` : 'All starter companies added'}
        </button>
        {status && <span className={`text-xs ${status.ok ? 'text-emerald-300' : 'text-red-300'}`}>{status.text}</span>}
      </div>
    </section>
  );
}
