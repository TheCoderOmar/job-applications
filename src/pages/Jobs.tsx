import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { CHANNEL_LABELS, WORK_TYPE_LABELS, type ApplyChannel, type Company, type Job, type JobDetail, type Stage } from '../types';
import Icon from '../components/Icon';
import Modal from '../components/Modal';
import JobForm from '../components/JobForm';
import { StageBadge, StageSelect, closedAfter } from '../components/Stage';
import CompanyLogo from '../components/CompanyLogo';
import StarButton from '../components/Star';
import { dmy } from '../dates';

type View = 'table' | 'board';

const savedView = (): View => {
  try {
    return localStorage.getItem('jobs-view') === 'board' ? 'board' : 'table';
  } catch {
    return 'table';
  }
};

export default function Jobs() {
  const [params, setParams] = useSearchParams();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [view, setView] = useState<View>(savedView);
  const [q, setQ] = useState('');
  // ?import=<job link>&title=<page title>: sent by the browser extension.
  const importUrl = params.get('import') ?? '';
  const importTitle = params.get('title') ?? '';
  const [adding, setAdding] = useState(params.get('new') === '1' || !!importUrl);
  // Full application (with referrers) being edited from the list.
  const [editing, setEditing] = useState<JobDetail | null>(null);
  const edit = (j: Job) => api.job(j.id).then(setEditing);

  const applied = params.get('all') !== '1';
  const stageId = params.get('stage') ?? '';
  const companyId = params.get('company') ?? '';
  const channel = params.get('channel') ?? '';
  const referred = params.get('referred') ?? '';
  const referrer = params.get('referrer') ?? '';
  const starredOnly = params.get('starred') === '1';

  const load = useCallback(() => {
    api
      .jobs({ applied: applied ? 1 : undefined, stage_id: stageId, company_id: companyId, channel, referred, contact_id: referrer, starred: starredOnly ? 1 : undefined })
      .then(setJobs);
  }, [applied, stageId, companyId, channel, referred, referrer, starredOnly]);

  useEffect(load, [load]);
  useEffect(() => {
    api.stages().then(setStages);
    api.companies().then(setCompanies);
  }, []);

  /** A job saved as not applied yet would vanish from the "Applied" view: show all jobs instead. */
  const showSaved = (j: Job) => {
    if (applied && !j.applied_date) {
      const next = new URLSearchParams(params);
      next.set('all', '1');
      ['new', 'import', 'title'].forEach((k) => next.delete(k));
      setParams(next, { replace: true });
    } else load();
  };

  const clearImportParams = () => {
    const next = new URLSearchParams(params);
    ['new', 'import', 'title'].forEach((k) => next.delete(k));
    setParams(next, { replace: true });
  };

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    next.delete('new');
    setParams(next);
  };

  const changeView = (v: View) => {
    setView(v);
    try {
      localStorage.setItem('jobs-view', v);
    } catch {
      /* storage unavailable */
    }
  };

  const [sort, setSortState] = useState<Sort>(savedSort);
  const setSort = (key: SortKey) =>
    setSortState((prev) => {
      // Same column flips the direction; a new column starts newest / furthest first for dates and stages.
      const next: Sort = prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'title' || key === 'company' ? 'asc' : 'desc' };
      try {
        localStorage.setItem('jobs-sort', JSON.stringify(next));
      } catch {
        /* storage unavailable */
      }
      return next;
    });

  const shown = useMemo(() => {
    const needle = q.toLowerCase();
    const list = needle
      ? jobs.filter((j) => [j.title, j.company_name, j.description, j.notes].some((v) => v?.toLowerCase().includes(needle)))
      : [...jobs];
    if (sort.key === 'default') return list; // starred first, then recently updated (from the server)
    const val = (j: Job): string | number =>
      sort.key === 'applied'
        ? (j.applied_date ?? '')
        : sort.key === 'stage'
          ? // How far along: offers on top, open stages by progress, closed ones (rejected, ghosted…) at the bottom.
            (j.stage_kind === 'closed_won' ? 1000 : j.stage_kind === 'closed_lost' ? -1000 : 0) + j.stage_order
          : sort.key === 'company'
            ? j.company_name.toLowerCase()
            : j.title.toLowerCase();
    const dir = sort.dir === 'asc' ? 1 : -1;
    return list.sort((a, b) => {
      const [x, y] = [val(a), val(b)];
      // Empty dates always go last, whichever direction.
      if (x === '' || y === '') return x === y ? 0 : x === '' ? 1 : -1;
      return (x < y ? -1 : x > y ? 1 : 0) * dir || (b.applied_date ?? '').localeCompare(a.applied_date ?? '');
    });
  }, [jobs, q, sort]);

  async function toggleStar(job: Job) {
    const starred = !job.starred;
    setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, starred: starred ? 1 : 0 } : j)));
    await api.starJob(job.id, starred);
  }

  async function moveJob(jobId: number, toStage: number) {
    setJobs((prev) =>
      prev.map((j) => {
        const s = stages.find((x) => x.id === toStage);
        return j.id === jobId && s ? { ...j, stage_id: s.id, stage_name: s.name, stage_color: s.color } : j;
      }),
    );
    await api.setJobStage(jobId, toStage);
    load();
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Applications</h1>
          <p className="mt-1 text-sm text-muted">
            {shown.length} {applied ? 'applied' : 'tracked'} ·{' '}
            <Link to="/openings" className="text-brand-light hover:underline">
              find more openings
            </Link>
          </p>
        </div>
        <button className="btn-primary" onClick={() => setAdding(true)}>
          <Icon name="plus" /> Log application
        </button>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-line p-0.5">
          {[
            ['', 'Applied'],
            ['1', 'Include not applied yet'],
          ].map(([v, label]) => (
            <button
              key={label}
              onClick={() => setParam('all', v)}
              className={`rounded-md px-3 py-1.5 text-sm transition ${
                (applied ? '' : '1') === v ? 'bg-brand/20 text-brand-light' : 'text-muted hover:text-fg'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setParam('starred', starredOnly ? '' : '1')}
          aria-pressed={starredOnly}
          className={`btn-ghost py-1.5 ${starredOnly ? 'border-amber-300/60 text-amber-300' : ''}`}
        >
          <Icon name="star" /> Starred
        </button>
        <div className="relative min-w-[200px] flex-1">
          <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input className="input pl-9" placeholder="Search title, company, description…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="input w-auto" value={companyId} onChange={(e) => setParam('company', e.target.value)}>
          <option value="">All companies</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select className="input w-auto" value={channel} onChange={(e) => setParam('channel', e.target.value)}>
          <option value="">Any channel</option>
          {(Object.keys(CHANNEL_LABELS) as ApplyChannel[]).map((k) => (
            <option key={k} value={k}>
              {CHANNEL_LABELS[k]}
            </option>
          ))}
          <option value="none">Channel not set</option>
        </select>
        <select className="input w-auto" value={referred} onChange={(e) => setParam('referred', e.target.value)}>
          <option value="">Referred or not</option>
          <option value="1">Referred</option>
          <option value="0">Not referred</option>
        </select>
        {referrer && (
          <button className="chip border border-brand/40 bg-brand/10 text-brand-light" onClick={() => setParam('referrer', '')}>
            One referrer only <Icon name="x" className="h-3.5 w-3.5" />
          </button>
        )}
        {view === 'table' && (
          <select className="input w-auto" value={stageId} onChange={(e) => setParam('stage', e.target.value)}>
            <option value="">All stages</option>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        <div className="flex rounded-lg border border-line p-0.5">
          {(['table', 'board'] as const).map((v) => (
            <button
              key={v}
              onClick={() => changeView(v)}
              aria-label={v === 'table' ? 'Table view' : 'Board view'}
              className={`rounded-md px-2.5 py-1.5 transition ${view === v ? 'bg-brand/20 text-brand-light' : 'text-muted hover:text-fg'}`}
            >
              <Icon name={v === 'table' ? 'list' : 'board'} />
            </button>
          ))}
        </div>
      </div>

      {view === 'table' ? (
        <JobTable jobs={shown} stages={stages} onStage={moveJob} onStar={toggleStar} onEdit={edit} sort={sort} onSort={setSort} />
      ) : (
        <Board jobs={shown} stages={stages} onMove={moveJob} onStar={toggleStar} onEdit={edit} />
      )}

      {editing && (
        <Modal title="Edit application" wide onClose={() => setEditing(null)}>
          <JobForm
            initial={editing}
            onCancel={() => setEditing(null)}
            onDeleted={() => {
              setEditing(null);
              load();
            }}
            onSaved={(j) => {
              setEditing(null);
              showSaved(j);
            }}
          />
        </Modal>
      )}

      {adding && (
        <Modal
          title="Log application"
          wide
          onClose={() => {
            setAdding(false);
            clearImportParams();
          }}
        >
          <JobForm
            initial={importUrl ? { url: importUrl, title: importTitle || undefined } : undefined}
            autoImport={importUrl || undefined}
            onCancel={() => {
              setAdding(false);
              clearImportParams();
            }}
            onSaved={(j) => {
              setAdding(false);
              clearImportParams();
              showSaved(j);
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function JobTable({
  jobs,
  stages,
  onStage,
  onStar,
  onEdit,
  sort,
  onSort,
}: {
  jobs: Job[];
  stages: Stage[];
  onStage: (id: number, s: number) => void;
  onStar: (j: Job) => void;
  onEdit: (j: Job) => void;
  sort: Sort;
  onSort: (k: SortKey) => void;
}) {
  const Th = ({ k, children }: { k?: SortKey; children: string }) =>
    k ? (
      <th className="px-4 py-3 font-medium" aria-sort={sort.key === k ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
        <button
          onClick={() => onSort(k)}
          className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-fg ${sort.key === k ? 'text-brand-light' : ''}`}
          title={`Sort by ${children.toLowerCase()}`}
        >
          {children}
          <Icon name={sort.key === k && sort.dir === 'asc' ? 'up' : 'down'} className={`h-3 w-3 ${sort.key === k ? '' : 'opacity-30'}`} />
        </button>
      </th>
    ) : (
      <th className="px-4 py-3 font-medium">{children}</th>
    );
  if (jobs.length === 0) return <div className="card p-10 text-center text-muted">No jobs match.</div>;
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
            <th className="w-10 px-2 py-3" aria-label="Starred" />
            <Th k="title">Job</Th>
            <Th k="company">Company</Th>
            <Th>Type</Th>
            <Th k="applied">Applied</Th>
            <Th>Via</Th>
            <Th k="stage">Stage</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {jobs.map((j) => (
            <tr key={j.id} className="transition hover:bg-raised/60">
              <td className="px-2 py-3 text-center">
                <StarButton starred={!!j.starred} onToggle={() => onStar(j)} />
              </td>
              <td className="px-4 py-3">
                <Link to={`/jobs/${j.id}`} className="font-medium hover:text-brand-light">
                  {j.title}
                </Link>
                {j.salary && <div className="text-xs text-muted">{j.salary}</div>}
              </td>
              <td className="px-4 py-3">
                <Link to={`/companies/${j.company_id}`} className="flex items-center gap-2 text-muted hover:text-brand-light">
                  <CompanyLogo id={j.company_id} name={j.company_name} logoAt={j.logo_at} size="sm" />
                  {j.company_name}
                </Link>
              </td>
              <td className={`whitespace-nowrap px-4 py-3 ${j.location_type === 'unknown' ? 'text-muted/60' : 'text-muted'}`}>
                {WORK_TYPE_LABELS[j.location_type]}
              </td>
              <td className="whitespace-nowrap px-4 py-3 tabular-nums text-muted">{dmy(j.applied_date)}</td>
              <td className="whitespace-nowrap px-4 py-3 text-muted">
                {j.apply_channel ? CHANNEL_LABELS[j.apply_channel] : '—'}
                {j.referrer_count > 0 && <div className="text-xs text-emerald-300">Referred ×{j.referrer_count}</div>}
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-1">
                  <StageSelect stages={stages} value={j.stage_id} onChange={(s) => onStage(j.id, s)} />
                  <button className="rounded-md p-1.5 text-muted hover:bg-raised hover:text-fg" onClick={() => onEdit(j)} aria-label={`Edit ${j.title}`} title="Edit">
                    <Icon name="edit" />
                  </button>
                </div>
                {closedAfter(j, stages[0]?.name) && <div className="mt-1 text-xs text-muted">{closedAfter(j, stages[0]?.name)}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Board({
  jobs,
  stages,
  onMove,
  onStar,
  onEdit,
}: {
  jobs: Job[];
  stages: Stage[];
  onMove: (id: number, s: number) => void;
  onStar: (j: Job) => void;
  onEdit: (j: Job) => void;
}) {
  const [over, setOver] = useState<number | null>(null);
  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {stages.map((s) => {
        const col = jobs.filter((j) => j.stage_id === s.id);
        return (
          <div
            key={s.id}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(s.id);
            }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const id = Number(e.dataTransfer.getData('text/plain'));
              if (id) onMove(id, s.id);
            }}
            className={`card flex w-72 shrink-0 flex-col transition ${over === s.id ? 'border-brand shadow-glow' : ''}`}
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <StageBadge name={s.name} color={s.color} />
              <span className="text-xs tabular-nums text-muted">{col.length}</span>
            </div>
            <div className="flex min-h-[120px] flex-col gap-2 p-3">
              {col.map((j) => (
                <Link
                  key={j.id}
                  to={`/jobs/${j.id}`}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('text/plain', String(j.id))}
                  className="cursor-grab rounded-lg border border-line bg-ink/70 p-3 transition hover:border-brand/60 active:cursor-grabbing"
                  style={{ boxShadow: `inset 3px 0 0 ${s.color}` }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-sm font-medium">{j.title}</div>
                    <span className="-m-1 flex shrink-0">
                      <button
                        type="button"
                        className="rounded-md p-1 text-muted/60 hover:text-fg"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          onEdit(j);
                        }}
                        aria-label={`Edit ${j.title}`}
                        title="Edit"
                      >
                        <Icon name="edit" />
                      </button>
                      <StarButton starred={!!j.starred} onToggle={() => onStar(j)} />
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                    <CompanyLogo id={j.company_id} name={j.company_name} logoAt={j.logo_at} size="sm" />
                    {j.company_name}
                  </div>
                  {closedAfter(j, stages[0]?.name) && <div className="mt-1.5 text-[11px] text-muted">{closedAfter(j, stages[0]?.name)}</div>}
                  {j.applied_date && <div className="mt-1.5 text-[11px] text-muted">Applied {dmy(j.applied_date)}</div>}
                </Link>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

type SortKey = 'default' | 'title' | 'company' | 'applied' | 'stage';
type Sort = { key: SortKey; dir: 'asc' | 'desc' };

const savedSort = (): Sort => {
  try {
    const v = JSON.parse(localStorage.getItem('jobs-sort') ?? 'null');
    if (v && ['title', 'company', 'applied', 'stage'].includes(v.key) && ['asc', 'desc'].includes(v.dir)) return v;
  } catch {
    /* storage unavailable */
  }
  return { key: 'default', dir: 'desc' };
};
