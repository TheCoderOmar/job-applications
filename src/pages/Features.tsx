import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../components/Icon';
import { AREAS } from '../features';

export default function Features() {
  const [q, setQ] = useState('');
  const areas = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return AREAS;
    return AREAS.map((a) => ({
      ...a,
      items: a.title.toLowerCase().includes(needle) ? a.items : a.items.filter(([t, d]) => `${t} ${d}`.toLowerCase().includes(needle)),
    })).filter((a) => a.items.length);
  }, [q]);
  const total = AREAS.reduce((n, a) => n + a.items.length, 0);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Features</h1>
          <p className="mt-1 text-sm text-muted">Everything the app can do: {total} features in {AREAS.length} areas.</p>
        </div>
        <div className="relative w-full sm:w-72">
          <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input className="input pl-9" placeholder="Search features" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </header>

      {areas.length === 0 && <p className="text-sm text-muted">No feature matches "{q}".</p>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {areas.map((a) => (
          <section key={a.title} className="card p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 font-semibold">
                <Icon name={a.icon} className="h-4 w-4 text-brand-light" /> {a.title}
              </h2>
              {a.to && (
                <Link to={a.to} className="shrink-0 text-xs font-medium text-brand-light hover:underline">
                  Open →
                </Link>
              )}
            </div>
            <ul className="mt-3 space-y-2.5">
              {a.items.map(([title, desc]) => (
                <li key={title} className="text-sm">
                  <span className="font-medium text-fg">{title}</span>
                  <span className="text-muted"> · {desc}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
