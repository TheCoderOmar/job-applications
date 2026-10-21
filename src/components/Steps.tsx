import { useState } from 'react';
import { api } from '../api';
import type { JobDetail, Stage } from '../types';
import Icon from './Icon';
import DateInput from './DateInput';
import { todayIso } from '../dates';

const dayOf = (sql: string) => {
  // Steps added by hand are stored at noon (date only); automatic ones carry a UTC time.
  if (sql.endsWith('12:00:00')) return sql.slice(0, 10);
  const d = new Date(sql.replace(' ', 'T') + 'Z');
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** The application's steps (Applied, HR interview, …) with dates; add past ones, fix dates, remove mistakes. */
export default function StepsEditor({
  job,
  stages,
  onChange,
  bare = false,
}: {
  job: JobDetail;
  stages: Stage[];
  onChange: () => void;
  /** Inside another form: no card around it. */
  bare?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [stageId, setStageId] = useState<number | ''>('');
  const [date, setDate] = useState(todayIso());
  const [error, setError] = useState('');

  // Suggest the next stage after the furthest one reached.
  const nextStage = () => {
    const reached = new Set(job.history.map((h) => h.stage_id));
    return stages.find((s) => !reached.has(s.id) && s.kind === 'active' && s.sort_order > 0)?.id ?? stages[0]?.id ?? '';
  };

  async function run(fn: () => Promise<unknown>) {
    setError('');
    try {
      await fn();
      onChange();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <section className={bare ? 'rounded-lg border border-line p-4' : 'card p-5'}>
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className={bare ? 'label mb-0' : 'font-semibold'}>Steps</h2>
        {!adding && (
          <button
            type="button"
            className="btn-ghost px-2.5 py-1 text-xs"
            onClick={() => {
              setStageId(nextStage());
              setDate(todayIso());
              setAdding(true);
            }}
          >
            <Icon name="plus" /> Add step
          </button>
        )}
      </div>

      {adding && (
        <div className="mb-4 space-y-2 rounded-lg border border-line bg-ink/50 p-3">
          <select className="input" value={stageId} onChange={(e) => setStageId(Number(e.target.value))} autoFocus>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <DateInput value={date} max={todayIso()} onChange={setDate} required aria-label="Step date" />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost px-2.5 py-1 text-xs" onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary px-2.5 py-1 text-xs"
              onClick={() => stageId !== '' && run(() => api.addStep(job.id, { stage_id: stageId, date })).then(() => setAdding(false))}
            >
              Add step
            </button>
          </div>
        </div>
      )}

      <ol className="relative space-y-3 border-l border-line pl-5">
        {job.history.map((h) => (
          <li key={h.id} className="group relative">
            <span className="absolute -left-[26px] top-2 h-3 w-3 rounded-full border-2 border-ink" style={{ background: h.stage_color }} />
            <div className="flex items-center gap-2">
              <select
                className="min-w-0 flex-1 cursor-pointer rounded bg-transparent text-sm font-medium outline-none hover:bg-raised"
                value={h.stage_id}
                onChange={(e) => run(() => api.updateStep(job.id, h.id, { stage_id: Number(e.target.value) }))}
                aria-label="Stage"
              >
                {stages.map((s) => (
                  <option key={s.id} value={s.id} style={{ background: '#0b1220' }}>
                    {s.name}
                  </option>
                ))}
              </select>
              {job.history.length > 1 && (
                <button
                  type="button"
                  className="rounded p-1 text-muted opacity-60 hover:text-red-300 group-hover:opacity-100"
                  onClick={() => run(() => api.deleteStep(job.id, h.id))}
                  aria-label={`Remove ${h.stage_name} step`}
                  title="Remove this step"
                >
                  <Icon name="x" className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <DateInput
              compact
              value={dayOf(h.changed_at)}
              max={todayIso()}
              onChange={(v) => v && run(() => api.updateStep(job.id, h.id, { date: v }))}
              aria-label={`${h.stage_name} date`}
            />
          </li>
        ))}
      </ol>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      <p className="mt-3 text-xs text-muted">The latest step is the application's current stage.</p>
    </section>
  );
}
