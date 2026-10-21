import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { Contact } from '../types';
import Icon from '../components/Icon';
import Modal from '../components/Modal';
import { TalkedStatus, hasTalked } from '../components/Contacts';
import { unzipSync, strFromU8 } from 'fflate';

export default function Contacts() {
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [q, setQ] = useState('');
  const [talkedOnly, setTalkedOnly] = useState(false);
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
        (!needle || [c.full_name, c.company, c.position].some((v) => v?.toLowerCase().includes(needle))),
    );
  }, [contacts, q, talkedOnly]);
  const talkedCount = contacts?.filter(hasTalked).length ?? 0;

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
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">Position</th>
                <th className="px-4 py-3 font-medium">Talked</th>
                <th className="px-4 py-3 font-medium">Referrals</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shown.slice(0, 500).map((c) => (
                <tr key={c.id} className="transition hover:bg-raised/60">
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
                    <TalkedStatus c={c} onChange={(u) => setContacts((prev) => prev && prev.map((x) => (x.id === u.id ? u : x)))} />
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
          {shown.length === 0 && <p className="px-4 py-6 text-center text-muted">No one matches.</p>}
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
      {field('full_name', 'Name *', { required: true, autoFocus: true })}
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
        {field('linkedin_url', 'LinkedIn profile', { placeholder: 'https://www.linkedin.com/in/…' })}
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
