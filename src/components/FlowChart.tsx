import { useEffect, useMemo, useRef, useState } from 'react';
import { sankeyLinkHorizontal } from 'd3-sankey';
import type { SankeyData } from '../types';
import { layoutFlow, type FlowLinkIn, type FlowNode, type FlowNodeIn } from './flowLayout';

/** Applications flowing through the stages they reached to how they ended (layout in flowLayout.ts). */
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

  const layout = useMemo(() => layoutFlow(data, width, height), [data, width, height]);

  if (!layout) return null;
  const path = sankeyLinkHorizontal<FlowNodeIn, FlowLinkIn>();

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
          {layout.links.map((l, i) => (
            <path
              key={i}
              d={path(l) ?? undefined}
              stroke={l.color}
              strokeOpacity={hover?.title === l.title ? 0.6 : 0.3}
              strokeWidth={Math.max(1.5, l.width ?? 1)}
              onMouseMove={(e) => show(e, l.title, l.value, l.color)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
        </g>
        {layout.nodes.map((n: FlowNode) =>
          n.kind === 'pass' ? (
            // Bridges the two halves of a band that passes under a stage, drawn like the band itself.
            <rect
              key={n.index}
              x={n.x0}
              y={n.y0}
              width={(n.x1 ?? 0) - (n.x0 ?? 0)}
              height={Math.max(1.5, (n.y1 ?? 0) - (n.y0 ?? 0))}
              fill={n.color}
              fillOpacity={hover?.title === n.name ? 0.6 : 0.3}
              onMouseMove={(e) => show(e, n.name, n.count, n.color)}
              onMouseLeave={() => setHover(null)}
            />
          ) : (
            <rect
              key={n.index}
              x={n.x0}
              y={n.y0}
              width={(n.x1 ?? 0) - (n.x0 ?? 0)}
              height={Math.max(2, (n.y1 ?? 0) - (n.y0 ?? 0))}
              rx={2}
              fill={n.color}
              onMouseMove={(e) => show(e, n.name, n.count, n.color)}
              onMouseLeave={() => setHover(null)}
            />
          ),
        )}
        {/* Labels last, on a solid backing, so bands never run through the text. */}
        {layout.nodes.filter((n) => n.kind !== 'pass').map((n: FlowNode) => {
          const label = `${n.name}: ${n.count}`;
          const x = (n.x1 ?? 0) + 6;
          const y = ((n.y0 ?? 0) + (n.y1 ?? 0)) / 2;
          return (
            <g key={`l${n.index}`} pointerEvents="none">
              <rect x={x - 3} y={y - 9} width={label.length * 6.6 + 6} height={18} rx={4} fill="#0b1220" fillOpacity={0.85} />
              <text x={x} y={y} dy="0.35em" fill="#e5edff" fontSize={12}>
                {label}
              </text>
            </g>
          );
        })}
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
