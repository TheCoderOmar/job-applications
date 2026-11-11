import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { CONTACT_STATUS, type Contact, type ContactStatus } from '../types';
import Icon from '../components/Icon';
import Modal from '../components/Modal';
import { ContactStatusSelect, TalkedStatus, hasTalked } from '../components/Contacts';
import StarButton from '../components/Star';
import { unzipSync, strFromU8 } from 'fflate';

export default function Contacts() {
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [q, setQ] = useState('');
  const [talkedOnly, setTalkedOnly] = useState(false);
  // Tab (All / Favourites, kept in ?tab=) and status filter ('' = any, 'none' = no status yet).
  const [tab, setTab] = useState<'all' | 'favorites'>(() =>
    new URLSearchParams(location.search).get('tab') === 'favorites' ? 'favorites' : 'all',
  );
  const [statusFilter, setStatusFilter] = useState<'' | 'none' | ContactStatus>('');
  const [editing, setEditing] = useState<Partial<Contact> | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    api.contacts().then(setContacts);
  }, []);
  useEffect(load, [load]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (contacts ?? []).filter(
      (c) =>
        (!talkedOnly || hasTalked(c)) &&
        (tab === 'all' || !!c.favorite) &&
        (!statusFilter || (statusFilter === 'none' ? !c.status : c.status === statusFilter)) &&
        (!needle || [c.full_name, c.company, c.position].some((v) => v?.toLowerCase().includes(needle))),
    );
  }, [contacts, q, talkedOnly, tab, statusFilter]);
  const talkedCount = contacts?.filter(hasTalked).length ?? 0;
  const favoriteCount = contacts?.filter((c) => c.favorite).length ?? 0;
  const replace = (u: Contact) => setContacts((prev) => prev && prev.map((x) => (x.id === u.id ? u : x)));

  function switchTab(t: 'all' | 'favorites') {
    setTab(t);
    const url = new URL(location.href);
    if (t === 'favorites') url.searchParams.set('tab', 'favorites');
    else url.searchParams.delete('tab');
    history.replaceState(history.state, '', url);
  }

  async function toggleFavorite(c: Contact) {
    replace({ ...c, favorite: c.favorite ? 0 : 1 });
    try {
      replace(await api.patchContact(c.id, { favorite: !c.favorite }));
    } catch (e) {
      replace(c);
      setMessage({ text: `Couldn't save the star: ${(e as Error).message}`, error: true });
    }
  }

  /**
   * Takes LinkedIn's export .zip (or Connections.csv / messages.csv picked directly).
   * From the zip only those two files are read; nothing else leaves the browser.
   */
  async function importFiles(files: File[]) {
    setImporting(true);
    setMessage(null);
    try {
      let connections: string | null = null;
      let messages: string | null = null;
      for (const f of files) {
        if (/\.zip$/i.test(f.name)) {
          const entries = unzipSync(new Uint8Array(await f.arrayBuffer()), {
            filter: (e) => /(^|\/)(connections|messages)\.csv$/i.test(e.name),
          });
          for (const [name, data] of Object.entries(entries)) {
            if (/connections\.csv$/i.test(name)) connections = strFromU8(data);
            if (/messages\.csv$/i.test(name)) messages = strFromU8(data);
          }
        } else {
          const t = await f.text();
          if (/CONVERSATION ID/i.test(t.slice(0, 500))) messages = t;
          else connections = t;
        }
      }
      if (!connections && !messages) throw new Error('No Connections.csv or messages.csv found in what you picked.');
      const parts: string[] = [];
      if (connections) {
        const r = await api.importLinkedIn(connections);
        parts.push(`${r.total} connections (${r.added} new, ${r.updated} updated)`);
      }
      if (messages) {
        const r = await api.importMessages(messages);
        parts.push(`conversations with ${r.matched} of your connections`);
      }
      setMessage({ text: `Imported ${parts.join(' and ')}.` });
      load();
    } catch (e) {
      setMessage({ text: (e as Error).message, error: true });
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function remove(c: Contact) {
    const used = c.referral_count ? ` They are a referrer on ${c.referral_count} application(s).` : '';
    if (!confirm(`Delete ${c.full_name}?${used}`)) return;
    await api.deleteContact(c.id);
    load();
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Contacts</h1>
          <p className="mt-1 text-sm text-muted">Your LinkedIn connections and the people who referred you.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost" onClick={() => setEditing({})}>
            <Icon name="plus" /> Add person
          </button>
          <button className="btn-primary" onClick={() => fileRef.current?.click()} disabled={importing}>
            <Icon name="upload" /> {importing ? 'Importing…' : 'Import LinkedIn export'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".zip,.csv,text/csv,application/zip"
            multiple
            className="hidden"
            onChange={(e) => e.target.files?.length && importFiles([...e.target.files])}
          />
        </div>
      </header>

      {message && (
        <p className={`rounded-lg border px-4 py-2.5 text-sm ${message.error ? 'border-red-500/40 text-red-300' : 'border-emerald-500/40 text-emerald-300'}`}>
          {message.text}
        </p>
      )}

      <details className="card p-5 text-sm" open={contacts?.length === 0}>
        <summary className="cursor-pointer font-semibold">How to get your connections file from LinkedIn</summary>
        <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-muted">
          <li>
            On LinkedIn, open <span className="text-fg">Me → Settings &amp; Privacy → Data privacy → Get a copy of your data</span>.
          </li>
          <li>
            If <span className="text-fg">"Want something in particular?"</span> lists <span className="text-fg">Connections</span>, tick it. If not, choose{' '}
            <span className="text-fg">"Download larger data archive, including connections…"</span>. Then click{' '}
            <span className="text-fg">Request archive</span>.
          </li>
          <li>LinkedIn emails you a download link: about 10 minutes for the small archive, up to a day for the larger one.</li>
          <li>
            Click <span className="text-fg">Import LinkedIn export</span> above and pick the <span className="text-fg">.zip</span> as it is. Only{' '}
            <span className="text-fg">Connections.csv</span> and <span className="text-fg">messages.csv</span> are read from it, and from the messages
            only who you talked to and how often is kept, never what was said.
          </li>
        </ol>
        <p className="mt-3 text-muted">
          Re-import any time to refresh job titles and companies; nobody is duplicated. The file stays on this computer: it's only saved in your
          local database.
        </p>
      </details>

      {contacts && contacts.length > 0 && (
        <div role="tablist" aria-label="Contacts" className="flex gap-1 border-b border-line">
          {(
            [
              ['all', `All (${contacts.length})`],
              ['favorites', `Favourites (${favoriteCount})`],
            ] as const
          ).map(([t, label]) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => switchTab(t)}
              className={`-mb-px flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm font-medium transition ${
                tab === t ? 'border-brand text-fg' : 'border-transparent text-muted hover:text-fg'
              }`}
            >
              {t === 'favorites' && (
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-amber-300" fill="currentColor" aria-hidden>
                  <path d="M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.8L12 16.9l-5.25 2.7 1-5.8L3.5 9.7l5.9-.9L12 3.5z" />
                </svg>
              )}
              {label}
            </button>
          ))}
        </div>
      )}

      {contacts && contacts.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] max-w-md flex-1">
            <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input className="input pl-9" placeholder="Search name, company, position…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <button
            onClick={() => setTalkedOnly((v) => !v)}
            aria-pressed={talkedOnly}
            className={`btn-ghost py-1.5 ${talkedOnly ? 'border-emerald-400/60 text-emerald-300' : ''}`}
          >
            Talked to ({talkedCount})
          </button>
          <select
            aria-label="Filter by status"
            className="input w-auto py-1.5 text-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          >
            <option value="">Any status</option>
            {(Object.keys(CONTACT_STATUS) as ContactStatus[]).map((k) => (
              <option key={k} value={k}>
                {CONTACT_STATUS[k].label} ({contacts.filter((c) => c.status === k).length})
              </option>
            ))}
            <option value="none">No status</option>
          </select>
          <span className="text-sm text-muted">{shown.length} shown</span>
        </div>
      )}

      {contacts === null ? (
        <p className="text-muted">Loading…</p>
      ) : contacts.length === 0 ? (
        <div className="card p-10 text-center text-muted">No contacts yet. Import your LinkedIn connections or add a person.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <th className="w-8 py-3 pl-3" aria-label="Favourite" />
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">Position</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Talked</th>
                <th className="px-4 py-3 font-medium">Referrals</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shown.slice(0, 500).map((c) => (
                <tr key={c.id} className="transition hover:bg-raised/60">
                  <td className="py-2.5 pl-3">
                    <StarButton
                      starred={!!c.favorite}
                      onToggle={() => toggleFavorite(c)}
                      label={`Add ${c.full_name} to favourites`}
                      onLabel="Favourite"
                    />
                  </td>
                  <td className="px-4 py-2.5 font-medium">
                    {c.linkedin_url ? (
                      <a href={c.linkedin_url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 hover:text-brand-light">
                        <Icon name="linkedin" className="h-3.5 w-3.5 shrink-0 text-muted" /> {c.full_name}
                      </a>
                    ) : (
                      c.full_name
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-muted">{c.company ?? '—'}</td>
                  <td className="hidden px-4 py-2.5 text-muted md:table-cell">{c.position ?? '—'}</td>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    <ContactStatusSelect c={c} onChange={replace} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    <TalkedStatus c={c} onChange={replace} />
                  </td>
                  <td className="px-4 py-2.5 tabular-nums">
                    {c.referral_count ? (
                      <Link to={`/jobs?referrer=${c.id}`} className="text-brand-light hover:underline">
                        {c.referral_count}
                      </Link>
                    ) : (
                      <span className="text-muted">0</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right">
                    <button className="p-1.5 text-muted hover:text-fg" aria-label={`Edit ${c.full_name}`} onClick={() => setEditing(c)}>
                      <Icon name="edit" />
                    </button>
                    <button className="p-1.5 text-muted hover:text-red-300" aria-label={`Delete ${c.full_name}`} onClick={() => remove(c)}>
                      <Icon name="trash" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length > 500 && <p className="px-4 py-3 text-xs text-muted">Showing 500 of {shown.length}. Search to narrow down.</p>}
          {shown.length === 0 && (
            <p className="px-4 py-6 text-center text-muted">
              {tab === 'favorites' && !favoriteCount ? 'No favourites yet. Click the star next to a name to add one.' : 'No one matches.'}
            </p>
          )}
        </div>
      )}

      {editing && (
        <Modal title={editing.id ? 'Edit person' : 'Add person'} onClose={() => setEditing(null)}>
          <ContactForm
            initial={editing}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              load();
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function ContactForm({ initial, onSaved, onCancel }: { initial: Partial<Contact>; onSaved: () => void; onCancel: () => void }) {
  const [d, setD] = useState<Partial<Contact>>(initial);
  const [error, setError] = useState('');
  const [companies, setCompanies] = useState<string[]>([]);
  const [li, setLi] = useState<{ text: string; error?: boolean; existing?: { id: number; full_name: string } | null } | null>(null);
  const [importing, setImporting] = useState(false);

  /** Fill the form from a public LinkedIn profile. The company is matched to your list when it's there. */
  async function importProfile() {
    if (!d.linkedin_url?.trim()) return;
    setImporting(true);
    setLi({ text: 'Reading the profile from LinkedIn…' });
    try {
      const p = await api.linkedInProfile(d.linkedin_url);
      const norm = (n: string) => n.toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, '');
      const company = p.company ? (companies.find((c) => norm(c) === norm(p.company!)) ?? p.company) : null;
      const filled: string[] = [];
      const next = { ...d, linkedin_url: p.linkedin_url };
      if (p.full_name) (next.full_name = p.full_name), filled.push('name');
      if (company) (next.company = company), filled.push('company');
      if (p.position) (next.position = p.position), filled.push('position');
      setD(next);
      const other = p.existing && p.existing.id !== initial.id ? p.existing : null;
      setLi({
        text: other
          ? `${other.full_name} is already in your contacts.`
          : `Imported the ${filled.length > 1 ? `${filled.slice(0, -1).join(', ')} and ${filled[filled.length - 1]}` : filled[0]} from LinkedIn.${p.position ? '' : ' Their job title is hidden on their public profile; add it if you know it.'}`,
        existing: other,
        error: !!other,
      });
    } catch (e) {
      setLi({ text: (e as Error).message, error: true });
    } finally {
      setImporting(false);
    }
  }

  useEffect(() => {
    api.companies().then((cs) => setCompanies(cs.map((c) => c.name)));
  }, []);
  const set = (k: keyof Contact, v: string) => setD((p) => ({ ...p, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      if (initial.id) await api.updateContact(initial.id, d);
      else await api.createContact(d);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const field = (k: keyof Contact, label: string, props: Record<string, unknown> = {}) => (
    <div>
      <label className="label">{label}</label>
      <input className="input" value={(d[k] as string) ?? ''} onChange={(e) => set(k, e.target.value)} {...props} />
    </div>
  );

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="rounded-lg border border-brand/30 bg-brand/5 p-4">
        <label className="label">LinkedIn profile</label>
        <div className="flex gap-2">
          <input
            className="input"
            placeholder="https://www.linkedin.com/in/…"
            autoFocus={!initial.id}
            value={d.linkedin_url ?? ''}
            onChange={(e) => set('linkedin_url', e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                importProfile();
              }
            }}
          />
          <button
            type="button"
            className="btn-ghost shrink-0"
            onClick={importProfile}
            disabled={importing || !/linkedin\.com\/in\//i.test(d.linkedin_url ?? '')}
          >
            <Icon name="linkedin" /> {importing ? 'Importing…' : 'Import from LinkedIn'}
          </button>
        </div>
        <p className={`mt-1.5 text-xs ${li?.error ? 'text-red-400' : 'text-muted'}`}>
          {li?.text ?? 'Paste their profile link to fill in the name, company and position.'}
        </p>
      </div>
      {field('full_name', 'Name *', { required: true, autoFocus: !!initial.id })}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label">Company</label>
          {/* Pick one of your companies, or type any other name. */}
          <input
            className="input"
            list="contact-companies"
            placeholder="Pick from your companies or type"
            value={d.company ?? ''}
            onChange={(e) => set('company', e.target.value)}
          />
          <datalist id="contact-companies">
            {companies.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </div>
        {field('position', 'Position')}
        {field('email', 'Email', { type: 'email' })}
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn-primary">{initial.id ? 'Save changes' : 'Add person'}</button>
      </div>
    </form>
  );
}
