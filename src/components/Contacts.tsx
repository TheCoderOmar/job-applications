import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { CONTACT_STATUS, type Contact, type ContactStatus } from '../types';
import Icon from './Icon';
import { dmy } from '../dates';

export const MAX_REFERRERS = 3;

const ago = (iso: string) => {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days < 1) return 'today';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
};

/** "Talked" with message counts, from LinkedIn messages.csv. Nothing when you've never messaged. */
export function TalkedChip({ c }: { c: Contact }) {
  if (!c.conversations) return <span className="text-xs text-muted">—</span>;
  const replied = c.messages_from_them > 0;
  const title = `${c.messages} messages in ${c.conversations} conversation(s), ${c.messages_from_them} from them${
    c.last_message_at ? `; last ${dmy(c.last_message_at)}` : ''
  }`;
  return (
    <span
      title={title}
      className={`chip border ${replied ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300' : 'border-line bg-raised text-muted'}`}
    >
      {replied ? 'Talked' : 'You wrote'} · {c.messages}
      {c.last_message_at && <span className="opacity-70">· {ago(c.last_message_at)}</span>}
    </span>
  );
}

/** From LinkedIn messages, or marked by hand. */
export const hasTalked = (c: Contact) => c.conversations > 0 || !!c.talked_at;

/**
 * The LinkedIn message tag (if any) plus your own "talked to" mark:
 * a "Mark talked" button when unmarked, a green tag with × when marked.
 */
export function TalkedStatus({ c, onChange }: { c: Contact; onChange: (c: Contact) => void }) {
  const [busy, setBusy] = useState(false);
  const toggle = async (talked: boolean) => {
    setBusy(true);
    try {
      onChange(await api.setTalked(c.id, talked));
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {c.conversations > 0 && <TalkedChip c={c} />}
      {c.talked_at ? (
        <span
          className="chip border border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
          title={`You marked this on ${dmy(c.talked_at)}`}
        >
          <Icon name="check" className="h-3 w-3" /> Talked
          <button type="button" onClick={() => toggle(false)} disabled={busy} aria-label="Unmark talked" className="hover:text-fg">
            <Icon name="x" className="h-3 w-3" />
          </button>
        </span>
      ) : c.conversations > 0 ? null : (
        <button
          type="button"
          onClick={() => toggle(true)}
          disabled={busy}
          className="chip border border-line text-muted transition hover:border-emerald-400/50 hover:text-emerald-300"
          title="Mark that you've talked to this person (outside LinkedIn messages too)"
        >
          <Icon name="plus" className="h-3 w-3" /> Mark talked
        </button>
      )}
    </span>
  );
}

/** People you've talked to first, then by most messages, then name. */
export const byTalked = (a: Contact, b: Contact) =>
  Number(hasTalked(b)) - Number(hasTalked(a)) ||
  b.messages_from_them - a.messages_from_them ||
  b.messages - a.messages ||
  a.full_name.localeCompare(b.full_name);

const STATUS_KEYS = Object.keys(CONTACT_STATUS) as ContactStatus[];

/**
 * Where you stand with a person: no status, Message sent, Chatting or Referred. Saves straight away;
 * every row's box is as wide as the longest label (same invisible-copies trick as StageSelect).
 */
export function ContactStatusSelect({ c, onChange }: { c: Contact; onChange: (c: Contact) => void }) {
  const [error, setError] = useState(false);
  const current = c.status ? CONTACT_STATUS[c.status] : null;
  async function pick(v: string) {
    const status = (v || null) as ContactStatus | null;
    onChange({ ...c, status }); // show it at once; put it back if saving fails
    try {
      onChange(await api.patchContact(c.id, { status }));
      setError(false);
    } catch {
      onChange(c);
      setError(true);
    }
  }
  return (
    <span className="inline-grid" title={error ? 'Not saved. Try again.' : undefined}>
      {['No status', ...STATUS_KEYS.map((k) => CONTACT_STATUS[k].label)].map((l) => (
        <span key={l} aria-hidden className="input invisible col-start-1 row-start-1 h-0 whitespace-nowrap border-y-0 py-0 pr-10 text-xs font-medium">
          {l}
        </span>
      ))}
      <select
        aria-label={`Status with ${c.full_name}`}
        className={`input col-start-1 row-start-1 cursor-pointer whitespace-nowrap py-1 text-xs font-medium ${current ? '' : 'text-muted'} ${error ? 'border-red-500/60' : ''}`}
        style={current ? { color: current.color, borderColor: current.color + '66', backgroundColor: current.color + '14' } : undefined}
        value={c.status ?? ''}
        onChange={(e) => pick(e.target.value)}
        onClick={(e) => e.stopPropagation()}
      >
        <option value="" style={{ color: '#e5edff', background: '#0b1220' }}>
          No status
        </option>
        {STATUS_KEYS.map((k) => (
          <option key={k} value={k} style={{ color: '#e5edff', background: '#0b1220' }}>
            {CONTACT_STATUS[k].label}
          </option>
        ))}
      </select>
    </span>
  );
}

export function ContactLine({ c }: { c: Contact }) {
  return (
    <span className="min-w-0">
      <span className="font-medium">{c.full_name}</span>
      {(c.position || c.company) && (
        <span className="text-muted"> · {[c.position, c.company].filter(Boolean).join(' at ')}</span>
      )}
    </span>
  );
}

export function ReferrerChip({ c, onRemove }: { c: Contact; onRemove?: () => void }) {
  return (
    <span className="chip max-w-full border border-brand/40 bg-brand/10 text-brand-light">
      {c.linkedin_url ? (
        <a href={c.linkedin_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 truncate hover:underline">
          <Icon name="linkedin" className="h-3.5 w-3.5 shrink-0" /> {c.full_name}
        </a>
      ) : (
        <span className="truncate">{c.full_name}</span>
      )}
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`Remove ${c.full_name}`} className="hover:text-fg">
          <Icon name="x" className="h-3.5 w-3.5" />
        </button>
      )}
    </span>
  );
}

interface PickerProps {
  value: Contact[];
  onChange: (v: Contact[]) => void;
  /** Company being applied to: its connections are suggested first. */
  companyId?: number;
}

/** Up to three referrers, picked from your contacts (connections at the company first) or added by name. */
export function ReferrerPicker({ value, onChange, companyId }: PickerProps) {
  const [all, setAll] = useState<Contact[]>([]);
  const [atCompany, setAtCompany] = useState<Contact[]>([]);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.contacts().then(setAll);
  }, []);
  useEffect(() => {
    if (!companyId) return setAtCompany([]);
    api.connectionsAt(companyId).then((r) => setAtCompany([...r].sort(byTalked))).catch(() => setAtCompany([]));
  }, [companyId]);

  const chosen = new Set(value.map((c) => c.id));
  const full = value.length >= MAX_REFERRERS;
  const options = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const atIds = new Set(atCompany.map((c) => c.id));
    const match = (c: Contact) =>
      !needle || [c.full_name, c.company, c.position].some((v) => v?.toLowerCase().includes(needle));
    const rest = all.filter((c) => !atIds.has(c.id));
    return [...atCompany.filter(match), ...rest.filter(match)].filter((c) => !chosen.has(c.id)).slice(0, 30);
  }, [q, all, atCompany, value]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (c: Contact) => {
    onChange([...value, c]);
    setQ('');
    setOpen(false);
  };

  async function addNew() {
    setError('');
    try {
      const c = await api.createContact({ full_name: q.trim() });
      setAll((prev) => [...prev, c]);
      pick(c);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const atIds = new Set(atCompany.map((c) => c.id));

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {value.map((c) => (
            <ReferrerChip key={c.id} c={c} onRemove={() => onChange(value.filter((x) => x.id !== c.id))} />
          ))}
        </div>
      )}
      {full ? (
        <p className="text-xs text-muted">That's the maximum of {MAX_REFERRERS} referrers.</p>
      ) : (
        <div className="relative">
          <input
            className="input"
            placeholder={atCompany.length ? `Search people · ${atCompany.length} of your connections work here` : 'Search people or type a new name'}
            value={q}
            onChange={(e) => (setQ(e.target.value), setOpen(true))}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (options[0]) pick(options[0]);
                else if (q.trim()) addNew();
              }
              if (e.key === 'Escape') setOpen(false);
            }}
          />
          {open && (options.length > 0 || q.trim()) && (
            <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-line bg-surface py-1 text-sm shadow-glow">
              {options.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(c)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-raised"
                  >
                    <ContactLine c={c} />
                    <span className="flex shrink-0 gap-1">
                      {c.conversations > 0 && <TalkedChip c={c} />}
                      {atIds.has(c.id) && <span className="chip bg-sky-500/15 text-sky-300">Works here</span>}
                    </span>
                  </button>
                </li>
              ))}
              {q.trim() && !options.some((c) => c.full_name.toLowerCase() === q.trim().toLowerCase()) && (
                <li>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={addNew}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-brand-light hover:bg-raised"
                  >
                    <Icon name="plus" /> Add "{q.trim()}" as a new person
                  </button>
                </li>
              )}
            </ul>
          )}
        </div>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

/** "Your connections at <company>", from the imported LinkedIn connections. */
export function ConnectionsPanel({
  companyId,
  companyName,
  onUse,
  usedIds = [],
}: {
  companyId: number;
  companyName: string;
  onUse?: (c: Contact) => void;
  usedIds?: number[];
}) {
  const [rows, setRows] = useState<Contact[] | null>(null);
  const [any, setAny] = useState(true);

  useEffect(() => {
    api.connectionsAt(companyId).then((r) => setRows([...r].sort(byTalked)));
    api.contacts().then((c) => setAny(c.length > 0));
  }, [companyId]);

  return (
    <section className="card p-5">
      <h2 className="font-semibold">
        Your connections at {companyName}
        {rows && rows.length > 0 && (
          <span className="ml-2 text-sm font-normal text-muted">
            {rows.length}
            {rows.some(hasTalked) && `, talked to ${rows.filter(hasTalked).length}`}
          </span>
        )}
      </h2>
      {rows === null ? (
        <p className="mt-2 text-sm text-muted">Loading…</p>
      ) : !any ? (
        <p className="mt-2 text-sm text-muted">
          <Link to="/contacts" className="text-brand-light hover:underline">
            Import your LinkedIn connections
          </Link>{' '}
          to see who works here.
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-2 text-sm text-muted">None of your connections list this company.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {rows.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 font-medium">
                  {c.linkedin_url ? (
                    <a href={c.linkedin_url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 hover:text-brand-light">
                      <Icon name="linkedin" className="h-3.5 w-3.5" /> {c.full_name}
                    </a>
                  ) : (
                    c.full_name
                  )}
                </div>
                {c.position && <div className="truncate text-xs text-muted">{c.position}</div>}
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <TalkedStatus c={c} onChange={(u) => setRows((prev) => prev && prev.map((x) => (x.id === u.id ? u : x)))} />
                  <ContactStatusSelect c={c} onChange={(u) => setRows((prev) => prev && prev.map((x) => (x.id === u.id ? u : x)))} />
                </div>
              </div>
              {onUse &&
                (usedIds.includes(c.id) ? (
                  <span className="text-xs text-muted">Referrer</span>
                ) : (
                  <button className="btn-ghost shrink-0 px-2.5 py-1 text-xs" onClick={() => onUse(c)} disabled={usedIds.length >= MAX_REFERRERS}>
                    Use as referrer
                  </button>
                ))}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
