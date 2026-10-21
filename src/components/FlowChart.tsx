import { useEffect, useMemo, useRef, useState } from 'react';
import { sankey, sankeyLeft, sankeyLinkHorizontal, type SankeyLink, type SankeyNode } from 'd3-sankey';
import type { SankeyData } from '../types';

type NodeIn = SankeyData['nodes'][number] & { index: number };
type N = SankeyNode<NodeIn, object>;
type L = SankeyLink<NodeIn, object>;

// Top to bottom within a column: progress, still waiting, no reply, closed.
const RANK: Record<NodeIn['kind'], number> = { root: 0, stage: 0, open: 1, none: 2, lost: 3 };

const LABEL_ROOM = 190; // px to the right of the last column for "Name: count"

/**
 * Applications flowing through the stages they reached to how they ended.
 * Each node sits in the column right after where it came from (not all endings on the far right),
 * so "Ghosted after Applied" stays next to Applications instead of stretching across the chart.
 */
export default function FlowChart({ data }: { data: SankeyData }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [hover, setHover] = useState<{ x: number; y: number; title: string; count: number; color: string } | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(480, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const height = Math.max(300, Math.min(620, data.nodes.length * 44));

  const layout = useMemo(() => {
    if (!data.nodes.length) return null;
    const gen = sankey<NodeIn, object>()
      .nodeId((n) => n.index)
      .nodeAlign(sankeyLeft)
      .nodeWidth(10)
      .nodePadding(22)
      .nodeSort((a, b) => RANK[a.kind] - RANK[b.kind] || (b.value ?? 0) - (a.value ?? 0))
      .extent([
        [2, 8],
        [width - LABEL_ROOM, height - 8],
      ]);
    return gen({
      nodes: data.nodes.map((n, index) => ({ ...n, index })),
      links: data.links.map((l) => ({ ...l })),
    });
  }, [data, width, height]);

  if (!layout) return null;
  const path = sankeyLinkHorizontal<NodeIn, object>();

  const show = (e: React.MouseEvent, title: string, count: number, color: string) => {
    const r = box.current!.getBoundingClientRect();
    setHover({ x: e.clientX - r.left, y: e.clientY - r.top, title, count, color });
  };

  return (
    // The tooltip lives outside the scrolling box, so showing it never adds a scrollbar.
    <div ref={box} className="relative" onMouseLeave={() => setHover(null)}>
      <div className="overflow-x-auto overflow-y-hidden">
      <svg width={width} height={height} role="img" aria-label="Where applications went">
        <g fill="none">
          {(layout.links as L[]).map((l, i) => {
            const s = l.source as N;
            const t = l.target as N;
            const active = hover?.title === `${s.name} → ${t.name}`;
            return (
              <path
                key={i}
                d={path(l) ?? undefined}
                stroke={t.color}
                strokeOpacity={active ? 0.6 : 0.3}
                strokeWidth={Math.max(1.5, l.width ?? 1)}
                onMouseMove={(e) => show(e, `${s.name} → ${t.name}`, l.value, t.color)}
                onMouseLeave={() => setHover(null)}
              />
            );
          })}
        </g>
        {(layout.nodes as N[]).map((n) => (
          <g key={n.index} onMouseMove={(e) => show(e, n.name, n.count, n.color)} onMouseLeave={() => setHover(null)}>
            <rect x={n.x0} y={n.y0} width={(n.x1 ?? 0) - (n.x0 ?? 0)} height={Math.max(2, (n.y1 ?? 0) - (n.y0 ?? 0))} rx={2} fill={n.color} />
            <text
              x={(n.x1 ?? 0) + 6}
              y={((n.y0 ?? 0) + (n.y1 ?? 0)) / 2}
              dy="0.35em"
              fill="#e5edff"
              fontSize={12}
              paintOrder="stroke"
              stroke="#0b1220"
              strokeWidth={3}
              strokeLinejoin="round"
            >
              {n.name}: {n.count}
            </text>
          </g>
        ))}
      </svg>
      </div>
      {hover && (
        <div
          className="pointer-events-none absolute z-10 rounded-lg border border-line bg-surface px-3 py-2 text-sm shadow-glow"
          // Right of the cursor, flipped left / above near the edges so it stays inside the card.
          style={{
            left: hover.x + 232 > width ? hover.x - 232 : hover.x + 12,
            top: hover.y + 70 > height ? hover.y - 70 : hover.y + 12,
          }}
        >
          <div className="flex items-center gap-2 text-muted">
            <span className="h-2 w-2 rounded-full" style={{ background: hover.color }} />
            {hover.title}
          </div>
          <div className="mt-0.5 font-semibold text-fg">
            {hover.count} {hover.count === 1 ? 'application' : 'applications'}
          </div>
        </div>
      )}
    </div>
  );
}
