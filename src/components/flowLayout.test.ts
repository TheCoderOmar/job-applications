import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutFlow, type FlowNode } from './flowLayout';
import type { SankeyData } from '../types';

// Real dashboard data (Oct 2026): one application went Screening → Technical interview, skipping HR interview.
const data: SankeyData = {
  nodes: [
    { name: 'Applications', color: '#3987e5', count: 33, kind: 'root' },
    { name: 'No reply yet', color: '#d9a441', count: 9, kind: 'none' },
    { name: 'Ghosted', color: '#d95926', count: 21, kind: 'lost' },
    { name: 'Screening', color: '#c98500', count: 3, kind: 'stage' },
    { name: 'HR interview', color: '#d55181', count: 2, kind: 'stage' },
    { name: 'Technical interview', color: '#b46fd8', count: 2, kind: 'stage' },
    { name: 'Shortlisted', color: '#4c9a2a', count: 2, kind: 'stage' },
    { name: 'Ghosted after Shortlisted', color: '#d95926', count: 1, kind: 'lost' },
    { name: 'In progress at HR interview', color: '#64748b', count: 1, kind: 'open' },
    { name: 'In progress at Shortlisted', color: '#64748b', count: 1, kind: 'open' },
  ],
  links: [
    { source: 0, target: 1, value: 9 },
    { source: 0, target: 2, value: 21 },
    { source: 0, target: 3, value: 3 },
    { source: 3, target: 4, value: 2 },
    { source: 4, target: 5, value: 1 },
    { source: 5, target: 6, value: 2 },
    { source: 6, target: 7, value: 1 },
    { source: 4, target: 8, value: 1 },
    { source: 3, target: 5, value: 1 },
    { source: 6, target: 9, value: 1 },
  ],
};

test('a band that skips a stage never runs through the bar it skips', () => {
  const g = layoutFlow(data, 1200, 440)!;
  for (const l of g.links) {
    const s = l.source as FlowNode;
    const t = l.target as FlowNode;
    assert.equal(t.depth, s.depth! + 1, `${s.name} → ${t.name} jumps a column`);
  }
  const real = g.nodes.filter((n) => n.kind !== 'pass');
  for (const p of g.nodes.filter((n) => n.kind === 'pass')) {
    for (const n of real.filter((n) => n.depth === p.depth)) {
      assert.ok(p.y0! >= n.y1! || p.y1! <= n.y0!, `pass-through overlaps ${n.name}`);
    }
  }
});

test('a skipped stage keeps its name and colour for hover', () => {
  const g = layoutFlow(data, 1200, 440)!;
  const skip = g.links.filter((l) => l.title === 'Screening → Technical interview');
  assert.equal(skip.length, 2); // Screening → (under HR interview) → Technical interview
  assert.ok(skip.every((l) => l.color === '#b46fd8' && l.value === 1));
});
