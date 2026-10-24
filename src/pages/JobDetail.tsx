import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { CHANNEL_LABELS, WORK_TYPE_LABELS, type Contact, type Cv, type JobDetail as JobDetailT, type Stage } from '../types';
import { ConnectionsPanel, ReferrerChip } from '../components/Contacts';
import StepsEditor from '../components/Steps';
import Icon from '../components/Icon';
import Modal from '../components/Modal';
import JobForm from '../components/JobForm';
import CvPreview from '../components/CvPreview';
import { StageSelect, closedAfter } from '../components/Stage';
import CompanyLogo from '../components/CompanyLogo';
import StarButton from '../components/Star';
import { dmy, dmyTime } from '../dates';

const fmt = (sqlDate: string) =>
  dmyTime(sqlDate);

export default function JobDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [job, setJob] = useState<JobDetailT | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [search] = useSearchParams();
  // ?edit=1: just logged from an opening, so ask for channel and referrers.
  const [editing, setEditing] = useState(search.get('edit') === '1');
  const [error, setError] = useState('');
  const [viewingCv, setViewingCv] = useState<Cv | null>(null);

  const load = useCallback(() => {
    api.job(id!).then(setJob).catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => {
    load();
    api.stages().then(setStages);
  }, [load]);

  async function remove() {
    if (!job || !confirm(`Delete "${job.title}"?`)) return;
    await api.deleteJob(job.id);
    navigate('/jobs');
  }

  async function changeStage(stageId: number) {
    await api.setJobStage(job!.id, stageId);
    load();
  }

  async function setReferrers(next: Contact[]) {
    const { history: _h, referrers: _r, ...fields } = job!;
    await api.updateJob(job!.id, { ...fields, referrer_ids: next.map((c) => c.id) });
    load();
  }

  if (error) return <p className="text-red-400">{error}</p>;
  if (!job) return <p className="text-muted">Loading…</p>;

  return (
    <div className="space-y-6">
      <Link to="/jobs" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-brand-light">
        <Icon name="arrowLeft" /> Applications
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <CompanyLogo id={job.company_id} name={job.company_name} logoAt={job.logo_at} size="lg" />
          <div>
          <h1 className="page-title flex items-center gap-2">
            {job.title}
            <StarButton
              starred={!!job.starred}
              onToggle={async () => {
                await api.starJob(job.id, !job.starred);
                load();
              }}
              className="[&_svg]:h-5 [&_svg]:w-5"
            />
          </h1>
          <p className="mt-1 text-sm text-muted">
            <Link to={`/companies/${job.company_id}`} className="text-brand-light hover:underline">
              {job.company_name}
            </Link>
            <span> · {WORK_TYPE_LABELS[job.location_type]}</span>
            {job.salary && ` · ${job.salary}`}
          </p>
          {closedAfter(job, stages[0]?.name) && (
            <p className="mt-1 text-sm">
              <span style={{ color: job.stage_color }}>{job.stage_name}</span> <span className="text-muted">{closedAfter(job, stages[0]?.name)}</span>
            </p>
          )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StageSelect stages={stages} value={job.stage_id} onChange={changeStage} />
          <button className="btn-ghost" onClick={() => setEditing(true)}>
            <Icon name="edit" /> Edit
          </button>
          <button className="btn-danger" onClick={remove}>
            <Icon name="trash" /> Delete
          </button>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="card p-5 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Job description</h2>
            {job.url && (
              <a href={job.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-sm text-brand-light hover:underline">
                <Icon name="external" /> Original posting
              </a>
            )}
          </div>
          {job.description ? (
            <div className="whitespace-pre-wrap text-sm leading-relaxed text-fg/90">{job.description}</div>
          ) : (
            <p className="text-sm text-muted">No description saved. Click Edit to paste it.</p>
          )}
        </section>

        <div className="space-y-6">
          <section className="card space-y-3 p-5 text-sm">
            <Row label="Applied on" value={dmy(job.applied_date, 'Not yet')} />
            <Row label="Applied via" value={job.apply_channel ? CHANNEL_LABELS[job.apply_channel] : 'Not set'} />
            {job.apply_contact && job.apply_contact !== job.url && (
              <div className="flex justify-between gap-4">
                <span className="text-muted">{job.apply_channel === 'email' ? 'Sent to' : 'Link'}</span>
                {/^https?:\/\//.test(job.apply_contact) ? (
                  <a href={job.apply_contact} target="_blank" rel="noreferrer" className="truncate text-brand-light hover:underline">
                    {job.apply_contact.replace(/^https?:\/\/(www\.)?/, '')}
                  </a>
                ) : (
                  <span className="truncate">{job.apply_contact}</span>
                )}
              </div>
            )}
            <div className="flex justify-between gap-4">
              <span className="shrink-0 text-muted">CV sent</span>
              {job.cv_id ? (
                <button
                  className="truncate text-brand-light hover:underline"
                  title="View this CV"
                  onClick={async () => setViewingCv((await api.cvs()).find((c) => c.id === job.cv_id) ?? null)}
                >
                  {job.cv_label}
                </button>
              ) : (
                <span>Not set</span>
              )}
            </div>
            <div className="flex justify-between gap-4">
              <span className="shrink-0 text-muted">Referred by</span>
              {job.referrers.length ? (
                <div className="flex flex-wrap justify-end gap-1.5">
                  {job.referrers.map((c) => (
                    <ReferrerChip key={c.id} c={c} onRemove={() => setReferrers(job.referrers.filter((x) => x.id !== c.id))} />
                  ))}
                </div>
              ) : (
                <span>No one</span>
              )}
            </div>
            <Row label="Added" value={fmt(job.created_at)} />
            <Row label="Last updated" value={fmt(job.updated_at)} />
          </section>

          <ConnectionsPanel
            companyId={job.company_id}
            companyName={job.company_name}
            usedIds={job.referrers.map((c) => c.id)}
            onUse={(c) => setReferrers([...job.referrers, c])}
          />

          {job.notes && (
            <section className="card p-5">
              <h2 className="mb-2 font-semibold">Notes</h2>
              <p className="whitespace-pre-wrap text-sm">{job.notes}</p>
            </section>
          )}

          <StepsEditor job={job} stages={stages} onChange={load} />
        </div>
      </div>

      {viewingCv && <CvPreview cv={viewingCv} onClose={() => setViewingCv(null)} />}
      {editing && (
        <Modal title="Edit job" wide onClose={() => setEditing(false)}>
          <JobForm
            initial={job}
            onCancel={() => setEditing(false)}
            onSaved={() => {
              setEditing(false);
              load();
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted">{label}</span>
      <span className="text-right tabular-nums">{value}</span>
    </div>
  );
}

