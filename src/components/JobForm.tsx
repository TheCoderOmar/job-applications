import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { CHANNEL_LABELS, type ApplyChannel, type Company, type Contact, type Job, type JobDetail, type Stage } from '../types';
import { ReferrerPicker } from './Contacts';
import StepsEditor from './Steps';
import Icon from './Icon';
import DateInput from './DateInput';
import { todayIso } from '../dates';

interface Props {
  initial?: Partial<Job> & { referrers?: Contact[] };
  onSaved: (j: Job) => void;
  onCancel: () => void;
}

const CONTACT_LABEL: Record<string, string> = {
  email: 'Sent to (email)',
  website: 'Application portal link',
  // Picked by hand: usually a recruiter's LinkedIn post. (Imported jobs hide this field.)
  linkedin: 'LinkedIn post link',
  other: 'Where you applied',
};

export default function JobForm({ initial, onSaved, onCancel }: Props) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [d, setD] = useState<Partial<Job>>({ location_type: 'unknown', ...initial });
  const [referrers, setReferrers] = useState<Contact[]>(initial?.referrers ?? []);
  const [error, setError] = useState('');
  const [liStatus, setLiStatus] = useState<{ text: string; error?: boolean } | null>(null);

  const [importing, setImporting] = useState(false);

  /** A recruiter's LinkedIn post → the job description (who posted it, then the post). */
  async function fillFromLinkedInPost(link: string, replace = false) {
    setImporting(true);
    setLiStatus({ text: 'Reading the post from LinkedIn…' });
    try {
      const p = await api.linkedInPost(link);
      // What will change, judged on the form now; applied to the latest state so nothing typed meanwhile is lost.
      const filled: string[] = [];
      if (replace || !d.description?.trim()) filled.push('description');
      if (d.apply_channel !== 'linkedin') filled.push('applied via LinkedIn');
      setD((prev) => {
        const next = { ...prev };
        if (replace || !prev.description?.trim()) next.description = p.description;
        next.apply_channel = 'linkedin';
        // Keep the post in the "LinkedIn post link" field, not as the job posting link.
        if (!next.apply_contact?.trim() || next.apply_contact === link) next.apply_contact = link;
        if (next.url === link) next.url = '';
        return next;
      });
      setLiStatus({ text: filled.length ? `Imported the post into the ${filled.join(' and ')}.` : 'Already filled in; nothing changed.' });
    } catch (e) {
      setLiStatus({ text: (e as Error).message, error: true });
    } finally {
      setImporting(false);
    }
  }

  /**
   * A LinkedIn or Workable job link → fill the form from the posting.
   * Pasting fills only empty fields; the Import button (`replace`) takes LinkedIn's title and description.
   * A posting that's "no longer accepting applications" moves an applied job to Ghosted.
   */
  async function fillFromLinkedInJob(link: string | null | undefined, replace = false) {
    if (link && isLinkedInPost(link)) return fillFromLinkedInPost(link, replace);
    if (!link || !isImportableJob(link)) return;
    const site = isWorkableJob(link) ? 'Workable' : 'LinkedIn';
    setImporting(true);
    setLiStatus({ text: `Reading the job from ${site}…` });
    try {
      const li = await api.importJob(link);
      // LinkedIn jobs are applied to on LinkedIn; Workable is the company's own careers page.
      const channel = li.source === 'workable' ? 'website' : 'linkedin';
      const filled: string[] = [];
      const company = li.company ? companies.find((c) => sameName(c.name, li.company!)) : undefined;
      const ghosted = stages.find((s) => s.name.toLowerCase() === 'ghosted');
      // Work out the changes from the form as it is now, so the message below matches them.
      const prev = d;
      {
        const next = { ...prev, url: prev.url?.trim() ? prev.url : link };
        if (next.apply_channel !== channel)
          (next.apply_channel = channel), filled.push(channel === 'linkedin' ? 'applied via LinkedIn' : 'applied via company website');
        // The job link now lives in "Job posting link"; a copy in the applied-via field isn't needed.
        if (next.apply_contact && isImportableJob(next.apply_contact)) next.apply_contact = null;
        const take = (empty: boolean) => replace || empty;
        if (li.title && take(!prev.title?.trim())) (next.title = li.title), filled.push('title');
        if (li.description && take(!prev.description?.trim())) (next.description = li.description), filled.push('description');
        if (li.workplace && (replace || !prev.location_type || prev.location_type === 'unknown'))
          (next.location_type = li.workplace), filled.push('work type');
        if (company && !isEdit && company.id !== prev.company_id) (next.company_id = company.id), filled.push('company');
        const current = stages.find((s) => s.id === prev.stage_id);
        if (li.closed && ghosted && current?.kind === 'active' && current.sort_order > 0) (next.stage_id = ghosted.id), filled.push('stage (Ghosted)');
        setD(next);
      }
      const notes: string[] = [];
      if (li.closed) notes.push(`${site} says this job is no longer accepting applications.`);
      if (li.company && !company && !isEdit) notes.push(`"${li.company}" isn't in your companies yet; add it first to pick it here.`);
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

  useEffect(() => {
    Promise.all([api.companies(), api.stages()]).then(([c, s]) => {
      setCompanies(c);
      setStages(s);
      setD((prev) => ({
        ...prev,
        company_id: prev.company_id ?? c[0]?.id,
        stage_id: prev.stage_id ?? s[0]?.id,
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
    (d.apply_channel === 'linkedin' && isLinkedInJob(d.url ?? '')) || (d.apply_channel === 'website' && isWorkableJob(d.url ?? ''));
  const set = <K extends keyof Job>(k: K, v: Job[K] | null) => setD((prev) => ({ ...prev, [k]: v }));
  const isEdit = !!initial?.id;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const { referrers: _r, history: _h, ...fields } = d as Partial<Job> & { referrers?: unknown; history?: unknown };
      const body = { ...fields, referrer_ids: referrers.map((c) => c.id) };
      const saved = isEdit ? await api.updateJob(initial!.id!, body) : await api.createJob(body);
      onSaved(saved);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (companies.length === 0 && stages.length > 0) {
    return (
      <div className="space-y-4 text-sm text-muted">
        <p>Add a company first, then you can add jobs to it.</p>
        <button className="btn-ghost" onClick={onCancel}>
          Close
        </button>
      </div>
    );
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
              title={canImport ? 'Fill this form from LinkedIn now' : 'Paste a LinkedIn job/post or Workable job link first'}
            >
              <Icon name={isWorkableJob(linkedInLink) || !linkedInLink ? 'download' : 'linkedin'} />{' '}
              {importing
                ? 'Importing…'
                : isWorkableJob(linkedInLink)
                  ? 'Import from Workable'
                  : linkedInLink
                    ? 'Import from LinkedIn'
                    : 'Import job'}
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
            value={d.company_id ?? ''}
            onChange={(e) => set('company_id', Number(e.target.value))}
            disabled={!!initial?.company_id && !isEdit}
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Stage</label>
          <select className="input" value={d.stage_id ?? ''} onChange={(e) => set('stage_id', Number(e.target.value))}>
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
          <DateInput value={d.applied_date ?? ''} max={todayIso()} onChange={(v) => set('applied_date', v || null)} aria-label="Applied on" />
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
      <p className="text-xs text-muted">Leave "Applied on" empty: it fills in today's date when you move the job past the first stage.</p>

      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn-primary" disabled={saving}>
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
const isImportableJob = (u: string) => isLinkedInJob(u) || isWorkableJob(u);
