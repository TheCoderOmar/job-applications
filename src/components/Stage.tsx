import type { Job, Stage } from '../types';

/** "after HR interview" for a closed job, so "Ghosted after HR interview" differs from "Ghosted after Technical interview". */
export function closedAfter(j: Pick<Job, 'stage_kind' | 'reached_stage'>, firstStageName?: string) {
  if (j.stage_kind !== 'closed_lost' || !j.reached_stage || j.reached_stage === firstStageName) return null;
  return `after ${j.reached_stage}`;
}

export function StageBadge({ name, color }: { name: string; color: string }) {
  return (
    <span className="chip border" style={{ color, borderColor: color + '66', background: color + '1a' }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {name}
    </span>
  );
}

interface SelectProps {
  stages: Stage[];
  value: number;
  onChange: (id: number) => void;
  className?: string;
}

export function StageSelect({ stages, value, onChange, className = '' }: SelectProps) {
  const current = stages.find((s) => s.id === value);
  // As wide as the longest stage name, so every row's box is the same size. A styleable (base-select)
  // dropdown only fits the stage it shows, so invisible copies of every name size the grid cell instead.
  return (
    <span className={`inline-grid ${className}`}>
      {stages.map((s) => (
        <span key={s.id} aria-hidden className="input invisible col-start-1 row-start-1 h-0 whitespace-nowrap border-y-0 py-0 pr-10 font-medium">
          {s.name}
        </span>
      ))}
      <select
        className="input col-start-1 row-start-1 cursor-pointer whitespace-nowrap py-1.5 font-medium"
        style={current ? { color: current.color, borderColor: current.color + '66' } : undefined}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onClick={(e) => e.stopPropagation()}
      >
        {stages.map((s) => (
          <option key={s.id} value={s.id} style={{ color: '#e5edff', background: '#0b1220' }}>
            {s.name}
          </option>
        ))}
      </select>
    </span>
  );
}
