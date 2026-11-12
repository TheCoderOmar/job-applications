import { useEffect, useState, type FormEvent, useRef } from 'react';
import { api } from '../api';
import { CHANNEL_LABELS, type ApplyChannel, type Company, type CompanyInput, type Contact, type Cv, type HiringPerson, type Job, type JobDetail, type Stage } from '../types';
import { Link } from 'react-router-dom';
import { ReferrerChip, ReferrerPicker } from './Contacts';
import StepsEditor from './Steps';
import Icon from './Icon';
import DateInput from './DateInput';
import { todayIso } from '../dates';

interface Props {
  initial?: Partial<Job> & { referrers?: Contact[] };
  onSaved: (j: Job) => void;
  onCancel: () => void;
  /** Editing only: shows "Delete application" (asks first, then calls this once it's gone). */
  onDeleted?: () => void;
  /** A job link to import as soon as the form is ready (from the browser extension). */
  autoImport?: string;
  /** The job page the extension sent with it (Indeed and Wuzzuf can only be read that way). */
  autoImportPage?: string;
}

const CONTACT_LABEL: Record<string, string> = {
  email: 'Sent to (email)',
  website: 'Application portal link',
  // Picked by hand: usually a recruiter's LinkedIn post. (Imported jobs hide this field.)
  linkedin: 'LinkedIn post link',
  wuzzuf: 'Wuzzuf job link',
  other: 'Where you applied',
};

export default function JobForm({ initial, onSaved, onCancel, onDeleted, autoImport, autoImportPage }: Props) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [cvs, setCvs] = useState<Cv[]>([]);
  const [d, setD] = useState<Partial<Job>>({ location_type: 'unknown', ...initial });
  const [referrers, setReferrers] = useState<Contact[]>(initial?.referrers ?? []);
  // The recruiter: one of your contacts, or someone from the posting's hiring team who becomes a contact on save.
  const [recruiter, setRecruiter] = useState<Contact | null>(() =>
    initial?.recruiter_id
      ? ({ id: initial.recruiter_id, full_name: initial.recruiter_name ?? '', linkedin_url: initial.recruiter_linkedin ?? null, position: initial.recruiter_position ?? null } as Contact)
      : null,
  );
  const [newRecruiter, setNewRecruiter] = useState<HiringPerson | null>(null);

  /** The posting's hiring team → the recruiter: a contact you have (same LinkedIn page or name), or a new one made on save. */
  async function takeRecruiter(team: HiringPerson[] | undefined, replace: boolean): Promise<string | null> {
    const p = team?.[0];
    if (!p || (!replace && (recruiter || newRecruiter))) return null;
    const slug = (u: string | null | undefined) => /\/in\/([^/?#]+)/i.exec(u ?? '')?.[1]?.toLowerCase() ?? null;
    const all = await api.contacts().catch(() => [] as Contact[]);
    const known =
      (slug(p.linkedin_url) && all.find((c) => slug(c.linkedin_url) === slug(p.linkedin_url))) ||
      all.find((c) => c.full_name.trim().toLowerCase() === p.name.trim().toLowerCase());
    if (known) {
      setRecruiter(known);
      setNewRecruiter(null);
      return `recruiter (${known.full_name})`;
    }
    setRecruiter(null);
    setNewRecruiter(p);
    return `recruiter (${p.name}, added to your contacts when you save)`;
  }
  const [error, setError] = useState('');
  const [liStatus, setLiStatus] = useState<{ text: string; error?: boolean } | null>(null);

  const [importing, setImporting] = useState(false);
  /**
   * Company named on an imported posting but not in your list yet. It's picked in the form as
   * "<name> (new)" (company_id NEW_COMPANY) and created only when you save, from its LinkedIn page when known.
   */
  const [newCompany, setNewCompany] = useState<{ name: string; linkedin: string | null; wuzzuf?: string | null } | null>(null);
  // The company's Wuzzuf page from an imported Wuzzuf job: saved with a new company, or on one that has none yet.
  const [companyWuzzuf, setCompanyWuzzuf] = useState<string | null>(null);
  async function createNewCompany(): Promise<number> {
    const nc = newCompany!;
    const name = nc.name.trim();
    if (!name) throw new Error('Type the company name, or pick one from the list.');
    // Typed a company you already have: use it rather than making a copy.
    const known = companies.find((c) => sameName(c.name, name));
    if (known) return known.id;
    let details: CompanyInput = {};
    if (nc.linkedin) {
      try {
        const li = await api.linkedInCompany(nc.linkedin);
        const { existing, logo_url: _l, name: _n, ...rest } = li;
        if (existing) return existing.id; // already there under its LinkedIn name
        details = rest;
      } catch {
        details = { linkedin: nc.linkedin };
      }
    }
    const c = await api.createCompany({ ...details, name, wuzzuf: nc.wuzzuf ?? companyWuzzuf ?? null });
    setCompanies((prev) => [...prev, c].sort((a, b) => a.name.localeCompare(b.name)));
    setNewCompany(null);
    return c.id;
  }

  /**
   * A recruiter's LinkedIn post → the job description (who posted it, then the post), and the company it's
   * probably for: the company page that posted it, one of yours it names, or the employer in the author's headline.
   */
  async function fillFromLinkedInPost(link: string, replace = false, page?: string) {
    setImporting(true);
    setLiStatus({ text: 'Reading the post from LinkedIn…' });
    try {
      const p = await api.linkedInPost(link, page);
      // What will change, judged on the form now; applied to the latest state so nothing typed meanwhile is lost.
      const filled: string[] = [];
      if (replace || !d.description?.trim()) filled.push('description');
      if (d.apply_channel !== 'linkedin') filled.push('applied via LinkedIn');
      const guess = !isEdit && !(initial?.company_id) && (replace || !d.company_id) ? p.company_guess : null;
      if (guess) filled.push(guess.id ? 'company' : 'company (new)');
      setD((prev) => {
        const next = { ...prev };
        if (replace || !prev.description?.trim()) next.description = p.description;
        next.apply_channel = 'linkedin';
        // Keep the post in the "LinkedIn post link" field, not as the job posting link.
        if (!next.apply_contact?.trim() || next.apply_contact === link) next.apply_contact = link;
        if (next.url === link) next.url = '';
        if (guess) next.company_id = guess.id ?? NEW_COMPANY;
        return next;
      });
      if (guess && !guess.id) setNewCompany({ name: guess.name, linkedin: guess.linkedin });
      const why = guess
        ? guess.why === 'author'
          ? ` ${guess.name} posted it.`
          : guess.why === 'mentioned'
            ? ` The post mentions ${guess.name}; change the company if that's wrong.`
            : ` ${guess.name} is from the author's headline; change it if that's wrong.`
        : !isEdit && !d.company_id
          ? ' Pick or type the company.'
          : '';
      setLiStatus({
        text: (filled.length ? `Imported the post into the ${filled.join(', ')}.` : 'Already filled in; nothing changed.') + why,
      });
    } catch (e) {
      setLiStatus({ text: (e as Error).message, error: true });
    } finally {
      setImporting(false);
    }
  }

  /**
   * A LinkedIn, Workable, Indeed or Wuzzuf job link → fill the form from the posting.
   * Pasting fills only empty fields; the Import button (`replace`) takes LinkedIn's title and description.
   * A posting that's "no longer accepting applications" moves an applied job to Ghosted.
   */
  async function fillFromLinkedInJob(link: string | null | undefined, replace = false, page?: string) {
    if (link && isLinkedInPost(link)) return fillFromLinkedInPost(link, replace, page ?? (link === autoImport ? autoImportPage : undefined));
    if (!link || !isImportableJob(link)) return;
    const site = siteName(link);
    setImporting(true);
    setLiStatus({ text: `Reading the job from ${site}…` });
    try {
      // Importing again in the extension's window reuses the page it sent (Indeed and Wuzzuf can't be fetched).
      const li = await api.importJob(link, page ?? (link === autoImport ? autoImportPage : undefined));
      // LinkedIn jobs are applied to on LinkedIn; Workable is the company's own careers page.
      const channel: ApplyChannel =
        li.source === 'linkedin' ? 'linkedin' : li.source === 'workable' ? 'website' : li.source === 'wuzzuf' ? 'wuzzuf' : 'other';
      setCompanyWuzzuf(li.company_wuzzuf ?? null);
      const filled: string[] = [];
      const rec = await takeRecruiter(li.hiring_team, replace);
      const company = li.company ? companies.find((c) => sameName(c.name, li.company!)) : undefined;
      const ghosted = stages.find((s) => s.name.toLowerCase() === 'ghosted');
      // Work out the changes from the form as it is now, so the message below matches them.
      const prev = d;
      {
        const next = { ...prev, url: prev.url?.trim() ? prev.url : link };
        if (next.apply_channel !== channel)
          (next.apply_channel = channel), filled.push(`applied via ${CHANNEL_LABELS[channel]}`);
        // The job link now lives in "Job posting link"; a copy in the applied-via field isn't needed.
        if (next.apply_contact && isImportableJob(next.apply_contact)) next.apply_contact = null;
        const take = (empty: boolean) => replace || empty;
        if (li.title && take(!prev.title?.trim())) (next.title = li.title), filled.push('title');
        if (li.description && take(!prev.description?.trim())) (next.description = li.description), filled.push('description');
        if (li.workplace && (replace || !prev.location_type || prev.location_type === 'unknown'))
          (next.location_type = li.workplace), filled.push('work type');
        if (company && !isEdit && company.id !== prev.company_id) (next.company_id = company.id), filled.push('company');
        if (li.company && !company && !isEdit) (next.company_id = NEW_COMPANY), filled.push('company (new)');
        const current = stages.find((s) => s.id === prev.stage_id);
        if (li.closed && ghosted && current?.kind === 'active' && current.sort_order > 0) (next.stage_id = ghosted.id), filled.push('stage (Ghosted)');
        if (rec) filled.push(rec);
        setD(next);
      }
      const notes: string[] = [];
      if (li.closed) notes.push(`${site} says this job is no longer accepting applications.`);
      if (li.company && !company && !isEdit) {
        notes.push(`${li.company} isn't in your companies yet; it's added when you save.`);
        setNewCompany({ name: li.company, linkedin: li.company_linkedin ?? null, wuzzuf: li.company_wuzzuf ?? null });
      } else setNewCompany(null);
      setLiStatus({
        text: [filled.length ? `Imported the ${filled.join(', ')} from ${site}.` : 'Already up to date.', ...notes].join(' '),
        error: !!notes.length && !filled.length,
      });
    } catch (e) {
      setLiStatus({ text: (e as Error).message, error: true });
    } finally {
      setImporting(false);
    }
  }
  // Editing: the saved application with its steps, reloaded when a step changes.
  const [saved, setSaved] = useState<JobDetail | null>(null);
  const reloadSteps = () =>
    initial?.id &&
    api.job(initial.id).then((j) => {
      setSaved(j);
      // Steps decide the stage and applied date; keep the form in step with them.
      setD((prev) => ({ ...prev, stage_id: j.stage_id, applied_date: j.applied_date }));
    });
  useEffect(() => {
    if (initial?.id) api.job(initial.id).then(setSaved);
  }, [initial?.id]);
  const [saving, setSaving] = useState(false);

  // From the browser extension: once companies and stages are loaded (so the company can be matched), import once.
  const autoImported = useRef(false);
  useEffect(() => {
    // Companies arrive with the stages, so an empty company list (a fresh install) still imports.
    if (!autoImport || autoImported.current || !stages.length) return;
    autoImported.current = true;
    if (isImportableJob(autoImport) || isLinkedInPost(autoImport)) fillFromLinkedInJob(autoImport, true, autoImportPage);
  }, [autoImport, companies, stages]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    Promise.all([api.companies(), api.stages(), api.cvs()]).then(([c, s, cv]) => {
      setCompanies(c);
      setStages(s);
      setCvs(cv);
      setD((prev) => ({
        ...prev,
        // No silent default: an imported company is matched below, otherwise you pick or type one.
        company_id: prev.company_id,
        stage_id: prev.stage_id ?? s[0]?.id,
        // New applications start on the default CV; a saved one keeps what it has, even none.
        cv_id: initial?.id ? prev.cv_id : (prev.cv_id ?? cv.find((x) => x.is_default)?.id ?? null),
      }));
    });
  }, []);

  // The posting link, or the "applied via" link when that's the LinkedIn job.
  // A LinkedIn job link wins; otherwise a LinkedIn post link from either field.
  const linkedInLink =
    [d.url, d.apply_contact].find((u) => u && isImportableJob(u)) ?? [d.url, d.apply_contact].find((u) => u && isLinkedInPost(u)) ?? '';
  const canImport = isImportableJob(linkedInLink) || isLinkedInPost(linkedInLink);
  // Applied through a LinkedIn job posting: the posting link above says it all, no second link.
  const viaLinkedInJob =
    (d.apply_channel === 'linkedin' && isLinkedInJob(d.url ?? '')) ||
    (d.apply_channel === 'website' && isWorkableJob(d.url ?? '')) ||
    (d.apply_channel === 'wuzzuf' && boardOf(d.url ?? '') === 'Wuzzuf') ||
    (d.apply_channel === 'other' && isBoardJob(d.url ?? ''));
  const set = <K extends keyof Job>(k: K, v: Job[K] | null) => setD((prev) => ({ ...prev, [k]: v }));
  const isEdit = !!initial?.id;
  const notApplied = !!stages.length && d.stage_id === stages[0].id;

  async function remove() {
    if (!confirm(`Delete "${initial?.title ?? 'this application'}"? Its steps go with it. This cannot be undone.`)) return;
    try {
      await api.deleteJob(initial!.id!);
      onDeleted!();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const { referrers: _r, history: _h, ...fields } = d as Partial<Job> & { referrers?: unknown; history?: unknown };
      // A company found on the posting but not in your list is created now, at save time.
      const company_id = fields.company_id === NEW_COMPANY ? await createNewCompany() : fields.company_id;
      const body = {
        ...fields,
        company_id,
        referrer_ids: referrers.map((c) => c.id),
        recruiter_id: recruiter?.id ?? null,
        ...(newRecruiter ? { recruiter: { full_name: newRecruiter.name, linkedin_url: newRecruiter.linkedin_url, position: newRecruiter.headline } } : {}),
      };
      const saved = isEdit ? await api.updateJob(initial!.id!, body) : await api.createJob(body);
      // An existing company without a Wuzzuf page gets the one from this Wuzzuf job (never replaces one it has).
      if (companyWuzzuf && company_id && fields.company_id !== NEW_COMPANY) await api.setCompanyWuzzuf(Number(company_id), companyWuzzuf).catch(() => {});
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
          <label className="label">Job posting link</label>
          <div className="flex gap-2">
            <input
              className="input"
              placeholder="https:// (a LinkedIn or Workable job link fills in the rest)"
              value={d.url ?? ''}
              onChange={(e) => set('url', e.target.value)}
              onPaste={(e) => fillFromLinkedInJob(e.clipboardData.getData('text').trim())}
            />
            <button
              type="button"
              className="btn-ghost shrink-0"
              disabled={importing || !canImport}
              onClick={() => fillFromLinkedInJob(linkedInLink, true)}
              title={canImport ? `Fill this form from ${siteName(linkedInLink)} now` : 'Paste a LinkedIn job/post or Workable job link first'}
            >
              <Icon name={siteName(linkedInLink) === 'LinkedIn' ? 'linkedin' : 'download'} />{' '}
              {importing ? 'Importing…' : linkedInLink ? `Import from ${siteName(linkedInLink)}` : 'Import job'}
            </button>
          </div>
          {liStatus && <p className={`mt-1.5 text-xs ${liStatus.error ? 'text-red-400' : 'text-muted'}`}>{liStatus.text}</p>}
        </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label">Job title *</label>
          <input className="input" required autoFocus value={d.title ?? ''} onChange={(e) => set('title', e.target.value)} />
        </div>
        <div>
          <label className="label">Company *</label>
          <select
            className="input"
            required
            value={d.company_id ?? ''}
            onChange={(e) => {
              const id = Number(e.target.value);
              if (id === NEW_COMPANY && !newCompany) setNewCompany({ name: '', linkedin: null });
              set('company_id', e.target.value ? id : null);
            }}
            disabled={!!initial?.company_id && !isEdit}
          >
            <option value="" disabled>
              Pick a company…
            </option>
            {!isEdit && <option value={NEW_COMPANY}>{newCompany?.name.trim() ? `${newCompany.name.trim()} (new)` : '+ New company…'}</option>}
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {d.company_id === NEW_COMPANY && newCompany && (
            <input
              className="input mt-2"
              required
              placeholder="Company name"
              aria-label="New company name"
              value={newCompany.name}
              onChange={(e) => setNewCompany({ ...newCompany, name: e.target.value })}
            />
          )}
        </div>
        <div>
          <label className="label">Stage</label>
          <select
            className="input"
            value={d.stage_id ?? ''}
            onChange={(e) => {
              const id = Number(e.target.value);
              // Back to the first stage (Saved): not applied, so no applied date.
              setD((prev) => ({ ...prev, stage_id: id, applied_date: id === stages[0]?.id ? null : prev.applied_date }));
            }}
          >
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Work type</label>
          <select
            className="input"
            value={d.location_type}
            onChange={(e) => set('location_type', e.target.value as Job['location_type'])}
          >
            <option value="onsite">On-site</option>
            <option value="hybrid">Hybrid</option>
            <option value="remote">Remote</option>
            <option value="unknown">Unknown</option>
          </select>
        </div>
        <div>
          <label className="label">Applied on</label>
          <DateInput
            value={d.applied_date ?? ''}
            max={todayIso()}
            placeholder={notApplied ? 'Not applied yet' : undefined}
            onChange={(v) =>
              // A date on a job still in the first stage (Saved) means you applied: move it to the next stage.
              setD((prev) => ({
                ...prev,
                applied_date: v || null,
                stage_id: v && prev.stage_id === stages[0]?.id && stages[1] ? stages[1].id : prev.stage_id,
              }))
            }
            aria-label="Applied on"
          />
        </div>
        <div>
          <label className="label">Salary</label>
          <input className="input" value={d.salary ?? ''} onChange={(e) => set('salary', e.target.value)} />
        </div>
        <div>
          <label className="label">Applied via</label>
          <select
            className="input"
            value={d.apply_channel ?? ''}
            onChange={(e) => set('apply_channel', (e.target.value || null) as ApplyChannel | null)}
          >
            <option value="">Not set</option>
            {(Object.keys(CHANNEL_LABELS) as ApplyChannel[]).map((k) => (
              <option key={k} value={k}>
                {CHANNEL_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
        {viaLinkedInJob ? (
          <div className="flex items-end pb-2.5 text-sm text-muted">Applied through the job link above.</div>
        ) : (
        <div>
          <label className="label">{CONTACT_LABEL[d.apply_channel ?? ''] ?? 'Where you applied'}</label>
          <input
            className="input"
            type={d.apply_channel === 'email' ? 'email' : 'text'}
            placeholder={
              d.apply_channel === 'email' ? 'jobs@company.com' : d.apply_channel === 'linkedin' ? 'https://www.linkedin.com/posts/…' : 'https://'
            }
            value={d.apply_contact ?? ''}
            onChange={(e) => set('apply_contact', e.target.value)}
            onPaste={(e) => fillFromLinkedInJob(e.clipboardData.getData('text').trim())}
          />
        </div>
        )}
        <div>
          <label className="label">CV sent</label>
          {cvs.length ? (
            <select className="input" value={d.cv_id ?? ''} onChange={(e) => set('cv_id', e.target.value ? Number(e.target.value) : null)}>
              <option value="">Not set</option>
              {cvs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                  {c.is_default ? ' (default)' : ''}
                </option>
              ))}
            </select>
          ) : (
            <p className="pt-2 text-sm text-muted">
              No CVs yet.{' '}
              <Link to="/cvs" target="_blank" className="text-brand-light hover:underline">
                Upload one in CVs
              </Link>
            </p>
          )}
        </div>
        <div className="sm:col-span-2">
          <label className="label">Recruiter (optional)</label>
          {newRecruiter ? (
            <div className="flex flex-wrap items-center gap-2">
              <ReferrerChip
                c={{ id: 0, full_name: newRecruiter.name, linkedin_url: newRecruiter.linkedin_url, position: newRecruiter.headline } as Contact}
                onRemove={() => setNewRecruiter(null)}
              />
              <span className="text-xs text-muted">From the hiring team; added to your contacts when you save.</span>
            </div>
          ) : (
            <ReferrerPicker max={1} value={recruiter ? [recruiter] : []} onChange={(v) => setRecruiter(v[0] ?? null)} companyId={d.company_id} />
          )}
        </div>
        <div className="sm:col-span-2">
          <label className="label">Referred by (optional, up to 3)</label>
          <ReferrerPicker value={referrers} onChange={setReferrers} companyId={d.company_id} />
        </div>
      </div>
      {isEdit && saved && <StepsEditor job={saved} stages={stages} onChange={reloadSteps} bare />}

      <div>
        <label className="label">Job description</label>
        <textarea
          className="input min-h-[200px] font-mono text-[13px] leading-relaxed"
          placeholder="Paste the full job description here…"
          value={d.description ?? ''}
          onChange={(e) => set('description', e.target.value)}
        />
      </div>
      <div>
        <label className="label">Notes</label>
        <textarea className="input min-h-[70px]" value={d.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
      </div>
      <p className="text-xs text-muted">
        Not applied yet? Leave the stage on {stages[0]?.name ?? 'the first stage'} and "Applied on" empty. If you applied, an empty "Applied on" means
        today.
      </p>

      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex justify-end gap-2">
        {isEdit && onDeleted && (
          <button type="button" className="btn-danger mr-auto" onClick={remove} disabled={saving}>
            <Icon name="trash" /> Delete application
          </button>
        )}
        <button type="button" className="btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn-primary" disabled={saving || importing} title={importing ? "Wait for the import to finish" : undefined}>
          {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add job'}
        </button>
      </div>
    </form>
  );
}

/** linkedin.com/jobs/view/…, or a LinkedIn link with ?currentJobId=… */
const isLinkedInJob = (u: string) => /linkedin\.com\/(?:.*\/)?jobs\/view\/|linkedin\.com\/.*[?&]currentJobId=\d/i.test(u);

/** Company names match ignoring case, punctuation and "Inc", "Egypt"… ("Sumerge" = "Sumerge Egypt"). */
const norm = (n: string) =>
  n
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ]+/g, ' ')
    .split(' ')
    .filter((w) => w && !['inc', 'llc', 'ltd', 'co', 'the', 'group', 'egypt', 'ksa', 'uae', 'company', 'corp'].includes(w))
    .join(' ');
const sameName = (a: string, b: string) => !!norm(a) && norm(a) === norm(b);

/** linkedin.com/posts/…, or /feed/update/urn:li:activity:… (a recruiter's post). */
const isLinkedInPost = (u: string) => /linkedin\.com\/(posts\/|feed\/update\/urn:li:(activity|share|ugcPost):)/i.test(u);

/** apply.workable.com/<company>/j/<CODE>… or the short apply.workable.com/j/<CODE> */
const isWorkableJob = (u: string) => /apply\.workable\.com\/(?:[a-z0-9-]+\/)?j\/[A-Z0-9]{6,}/i.test(u);
/** Indeed (?jk= / ?vjk=), Wuzzuf (/jobs/p/…) and jobs.workable.com (/view/…) job links; same rules as server/jobpages.ts. */
const boardOf = (u: string) =>
  /^https?:\/\/(?:[a-z]+\.)?indeed\.com\//i.test(u) && /[?&]v?jk=[0-9a-f]{8,}/i.test(u)
    ? 'Indeed'
    : /^https?:\/\/(?:www\.)?wuzzuf\.net\/jobs\/p\//i.test(u)
      ? 'Wuzzuf'
      : /^https?:\/\/jobs\.workable\.com\/view\//i.test(u)
        ? 'Workable'
        : null;
const isBoardJob = (u: string) => !!boardOf(u);
const isImportableJob = (u: string) => isLinkedInJob(u) || isWorkableJob(u) || isBoardJob(u);
const siteName = (u: string) => boardOf(u) ?? (isWorkableJob(u) ? 'Workable' : 'LinkedIn');

/** Placeholder company id: "a new company from the imported posting, created on save". */
const NEW_COMPANY = -1;
