import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from 'recharts';
import { api } from '../api';
import FlowChart from '../components/FlowChart';
import { CHANNEL_LABELS, type ApplyChannel, type ChannelTally, type Job, type SankeyData, type Stats } from '../types';
import { StageBadge } from '../components/Stage';
import { dm } from '../dates';

const AXIS = { fill: '#8aa0c8', fontSize: 12 };
const GRID = '#1e2a44';

function ChartTooltip({ active, payload, label, unit = 'jobs' }: TooltipProps<number, string> & { unit?: string }) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  const color = (p.payload as { color?: string }).color ?? '#3987e5';
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-sm shadow-glow">
      <div className="flex items-center gap-2 text-muted">
        <span className="h-2 w-2 rounded-full" style={{ background: color }} />
        {label}
      </div>
      <div className="mt-0.5 font-semibold text-fg">
        {p.value} {unit}
      </div>
    </div>
  );
}

function Tile({ label, value, hint, to }: { label: string; value: number; hint?: string; to?: string }) {
  const body = (
    <div className={`card h-full px-5 py-4 ${to ? 'card-hover' : ''}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-3xl font-semibold tabular-nums text-fg">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <h2 className="font-semibold">{title}</h2>
      {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '—');

const SANKEY_CHANNELS: [string, string][] = [
  ['', 'All'],
  ...(Object.keys(CHANNEL_LABELS) as ApplyChannel[]).map((k): [string, string] => [k, CHANNEL_LABELS[k]]),
];

function ApplicationFlow({ initial }: { initial: SankeyData }) {
  const [channel, setChannel] = useState('');
  const [referred, setReferred] = useState('');
  const [data, setData] = useState(initial);

  useEffect(() => {
    if (!channel && !referred) return setData(initial);
    api.stats({ channel, referred }).then((s) => setData(s.sankey));
  }, [channel, referred, initial]);

  return (
    <section className="card p-5 lg:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Where applications went</h2>
          <p className="mt-0.5 text-xs text-muted">Every application, the stages it reached, and how it ended</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="flex flex-wrap rounded-lg border border-line p-0.5">
            {SANKEY_CHANNELS.map(([v, label]) => (
              <button
                key={label}
                onClick={() => setChannel(v)}
                className={`rounded-md px-2.5 py-1 text-xs transition ${channel === v ? 'bg-brand/20 text-brand-light' : 'text-muted hover:text-fg'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <select className="input w-auto py-1 text-xs" value={referred} onChange={(e) => setReferred(e.target.value)}>
            <option value="">Referred or not</option>
            <option value="1">Referred</option>
            <option value="0">Not referred</option>
          </select>
        </div>
      </div>
      <div className="mt-4">
        {data.nodes.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted">No applications match.</p>
        ) : (
          <FlowChart data={data} />
        )}
      </div>
    </section>
  );
}

function TallyTable({ title, rows, label }: { title: string; rows: ChannelTally[]; label: (k: string) => string }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">{title}</h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted">
            <th className="py-1.5 font-medium" />
            <th className="py-1.5 text-right font-medium">Applied</th>
            <th className="py-1.5 text-right font-medium">Got a reply</th>
            <th className="py-1.5 text-right font-medium">Rate</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="py-1.5">{label(r.key)}</td>
              <td className="py-1.5 text-right tabular-nums">{r.applied}</td>
              <td className="py-1.5 text-right tabular-nums">{r.responded}</td>
              <td className="py-1.5 text-right tabular-nums text-muted">{pct(r.responded, r.applied)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const fmtWeek = (w: string) => dm(w);

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [recent, setRecent] = useState<Job[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api.stats().then(setStats).catch((e) => setError(e.message));
    api.jobs().then((j) => setRecent(j.slice(0, 6)));
  }, []);

  if (error) return <p className="text-red-400">Could not reach the API: {error}. Is the server running?</p>;
  if (!stats) return <p className="text-muted">Loading…</p>;

  const { totals } = stats;
  const byStage = stats.stages.map((s) => ({ name: s.name, count: s.job_count, color: s.color }));
  const stageHeight = Math.max(220, byStage.length * 38);
  const funnelHeight = Math.max(180, stats.funnel.length * 38);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="mt-1 text-sm text-muted">Where every application stands right now.</p>
        </div>
        <div className="flex gap-2">
          <Link to="/companies?new=1" className="btn-ghost">
            Add company
          </Link>
          <Link to="/openings" className="btn-ghost">
            Find openings
          </Link>
          <Link to="/jobs?new=1" className="btn-primary">
            Log application
          </Link>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Tile label="Companies" value={totals.companies} hint={`${totals.remote_companies} remote`} to="/companies" />
        <Tile label="Jobs tracked" value={totals.jobs} to="/jobs" />
        <Tile label="Applied" value={totals.applied} to="/jobs?applied=1" />
        <Tile label="In progress" value={totals.in_progress} hint="applied, still open" />
        <Tile label="Offers" value={totals.won} />
        <Tile label="Closed" value={totals.lost} hint="rejected / withdrawn / ghosted" />
      </div>

      {totals.jobs === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-lg font-medium">No jobs yet</p>
          <p className="mt-1 text-sm text-muted">Add a company, then add the jobs you're looking at or have applied to.</p>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <ApplicationFlow initial={stats.sankey} />

          <Panel title="How you applied" subtitle="'Got a reply' means it reached any stage after Applied">
            {stats.byChannel.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">No applications with a date yet.</p>
            ) : (
              <div className="space-y-5">
                <TallyTable
                  title="By channel"
                  rows={stats.byChannel}
                  label={(k) => (k === 'none' ? 'Not set' : (CHANNEL_LABELS[k as ApplyChannel] ?? k))}
                />
                <TallyTable title="By referral" rows={stats.byReferral} label={(k) => (k === 'referred' ? 'Referred' : 'Not referred')} />
              </div>
            )}
          </Panel>

          <Panel title="Jobs by stage" subtitle="How many jobs sit in each stage right now">
            <ResponsiveContainer width="100%" height={stageHeight}>
              <BarChart data={byStage} layout="vertical" margin={{ left: 8, right: 36 }} barCategoryGap={6}>
                <CartesianGrid horizontal={false} stroke={GRID} />
                <XAxis type="number" allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" width={90} tick={{ ...AXIS, fill: '#e5edff' }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(59,130,246,0.08)' }} />
                <Bar isAnimationActive={false} dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={24}>
                  {byStage.map((d) => (
                    <Cell key={d.name} fill={d.color} />
                  ))}
                  <LabelList dataKey="count" position="right" fill="#e5edff" fontSize={12} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Panel>

          <Panel title="Pipeline funnel" subtitle="Jobs that reached each stage or went further (closed-lost stages excluded)">
            <ResponsiveContainer width="100%" height={funnelHeight}>
              <BarChart data={stats.funnel} layout="vertical" margin={{ left: 8, right: 36 }} barCategoryGap={6}>
                <CartesianGrid horizontal={false} stroke={GRID} />
                <XAxis type="number" allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" width={90} tick={{ ...AXIS, fill: '#e5edff' }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(59,130,246,0.08)' }} />
                <Bar isAnimationActive={false} dataKey="count" fill="#3987e5" radius={[0, 4, 4, 0]} maxBarSize={24}>
                  <LabelList dataKey="count" position="right" fill="#e5edff" fontSize={12} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Panel>

          <Panel title="Applications per week" subtitle="By applied date, weeks starting Monday">
            {stats.perWeek.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted">No applications with a date yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={stats.perWeek.map((w) => ({ ...w, label: fmtWeek(w.week) }))} margin={{ top: 16 }}>
                  <CartesianGrid vertical={false} stroke={GRID} />
                  <XAxis dataKey="label" tick={AXIS} axisLine={{ stroke: GRID }} tickLine={false} />
                  <YAxis allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} width={30} />
                  <Tooltip content={<ChartTooltip unit="applications" />} cursor={{ fill: 'rgba(59,130,246,0.08)' }} />
                  <Bar isAnimationActive={false} dataKey="count" fill="#3987e5" radius={[4, 4, 0, 0]} maxBarSize={36} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Panel>

          <Panel title="Recently updated" subtitle="Your latest activity">
            <ul className="divide-y divide-line">
              {recent.map((j) => (
                <li key={j.id}>
                  <Link to={`/jobs/${j.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:text-brand-light">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{j.title}</div>
                      <div className="truncate text-xs text-muted">{j.company_name}</div>
                    </div>
                    <StageBadge name={j.stage_name} color={j.stage_color} />
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      )}
    </div>
  );
}

