import { sankey, sankeyLeft, type SankeyGraph, type SankeyLink, type SankeyNode } from 'd3-sankey';
import type { SankeyData } from '../types';

type Kind = SankeyData['nodes'][number]['kind'] | 'pass';
/** `pass` = invisible stop for a band that skips a column (e.g. Screening → Technical interview, no HR interview). */
export type FlowNodeIn = Omit<SankeyData['nodes'][number], 'kind'> & { kind: Kind; index: number };
/** `title` and `color` belong to the whole band, so both halves of a split band hover and colour as one. */
export type FlowLinkIn = { source: number; target: number; value: number; title: string; color: string };
export type FlowNode = SankeyNode<FlowNodeIn, FlowLinkIn>;
export type FlowLink = SankeyLink<FlowNodeIn, FlowLinkIn>;

// Top to bottom within a column: progress, bands passing through, still waiting, no reply, closed.
const RANK: Record<Kind, number> = { root: 0, stage: 0, pass: 1, open: 2, none: 3, lost: 4 };
const PAD = 22;
const TOP = 8;
export const LABEL_ROOM = 190; // px to the right of the last column for "Name: count"

const byRank = (a: FlowNode, b: FlowNode) => RANK[a.kind] - RANK[b.kind] || (b.value ?? 0) - (a.value ?? 0);

function generator(width: number, height: number) {
  return (
    sankey<FlowNodeIn, FlowLinkIn>()
      .nodeId((n) => n.index)
      .nodeAlign(sankeyLeft)
      .nodeWidth(10)
      .nodePadding(PAD)
      // No relaxation passes: every column stacks from the top in RANK order, so columns line up
      // instead of drifting to different heights.
      .iterations(0)
      .nodeSort(byRank)
      .extent([
        [2, TOP],
        [width - LABEL_ROOM, height - TOP],
      ])
  );
}

/**
 * Applications flowing through the stages they reached to how they ended.
 * Each node sits in the column right after where it came from (not all endings on the far right),
 * so "Ghosted after Applied" stays next to Applications instead of stretching across the chart.
 */
export function layoutFlow(data: SankeyData, width: number, height: number): SankeyGraph<FlowNodeIn, FlowLinkIn> | null {
  if (!data.nodes.length) return null;
  const nodes: FlowNodeIn[] = data.nodes.map((n, index) => ({ ...n, index }));
  const direct: FlowLinkIn[] = data.links.map((l) => ({
    ...l,
    title: `${nodes[l.source].name} → ${nodes[l.target].name}`,
    color: nodes[l.target].color,
  }));

  // A band that jumps a column would run straight through that column's bars and labels. Find the
  // columns first, then route such bands through a stop in every column they cross; the stops stack
  // below the column's stages, so the band visibly passes underneath them.
  const first = generator(width, height)({ nodes: nodes.map((n) => ({ ...n })), links: direct.map((l) => ({ ...l })) });
  const depth = first.nodes.map((n) => n.depth ?? 0);
  const links: FlowLinkIn[] = [];
  for (const l of direct) {
    let from = l.source;
    for (let d = depth[l.source] + 1; d < depth[l.target]; d++) {
      const index = nodes.length;
      nodes.push({ name: l.title, color: l.color, count: l.value, kind: 'pass', index });
      links.push({ ...l, source: from, target: index });
      from = index;
    }
    links.push({ ...l, source: from });
  }

  const gen = generator(width, height);
  const graph = gen({ nodes, links });
  // Stack every column from the top in RANK order so all columns start at the same height,
  // then let d3 re-route the bands to the new positions.
  const columns = new Map<number, FlowNode[]>();
  for (const n of graph.nodes) columns.set(n.depth ?? 0, [...(columns.get(n.depth ?? 0) ?? []), n]);
  for (const col of columns.values()) {
    col.sort(byRank);
    let y = TOP;
    for (const n of col) {
      const h = (n.y1 ?? 0) - (n.y0 ?? 0);
      n.y0 = y;
      n.y1 = y + h;
      y += h + PAD;
    }
  }
  // Bands leave and arrive in the same order as the bars they connect, so none cross.
  const y0 = (n: FlowNode | string | number) => (n as FlowNode).y0 ?? 0;
  for (const n of graph.nodes) {
    n.sourceLinks?.sort((a, b) => y0(a.target) - y0(b.target));
    n.targetLinks?.sort((a, b) => y0(a.source) - y0(b.source));
  }
  gen.update(graph);
  return graph;
}
