import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSankey, normalizeCompany, parseCsv, parseLinkedInConnections, sameCompany, type SankeyStage } from './contacts.js';

const LINKEDIN_CSV = `Notes:
"When exporting your connection data, you may notice that some of the email addresses are missing."

First Name,Last Name,URL,Email Address,Company,Position,Connected On
Sara,Hassan,https://www.linkedin.com/in/sara-hassan/,,"Vodafone Egypt, Inc.",Senior Engineer,15 Oct 2026
Ahmed,"El ""Ace"" Sayed",https://www.linkedin.com/in/ahmed,ahmed@example.com,Microsoft,"Program Manager, Azure",03 Jan 2024
,,,,,,
`;

test('parseCsv handles quotes, escaped quotes and CRLF', () => {
  assert.deepEqual(parseCsv('a,"b,c","d ""e"""\r\n1,2,3\r\n'), [
    ['a', 'b,c', 'd "e"'],
    ['1', '2', '3'],
  ]);
});

test('parseCsv keeps a quote inside an unquoted field as text', () => {
  assert.deepEqual(parseCsv('a,He said "hi" twice,c\nd,e,f\n'), [
    ['a', 'He said "hi" twice', 'c'],
    ['d', 'e', 'f'],
  ]);
});

test('parseLinkedInConnections skips the notes preamble and empty rows', () => {
  const rows = parseLinkedInConnections(LINKEDIN_CSV);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    full_name: 'Sara Hassan',
    company: 'Vodafone Egypt, Inc.',
    position: 'Senior Engineer',
    linkedin_url: 'https://www.linkedin.com/in/sara-hassan',
    email: null,
    connected_on: '2026-10-15',
  });
  assert.equal(rows[1].full_name, 'Ahmed El "Ace" Sayed');
  assert.equal(rows[1].position, 'Program Manager, Azure');
});

test('parseLinkedInConnections rejects other files', () => {
  assert.throws(() => parseLinkedInConnections('name,company\nx,y'), /First Name/);
});

test('company names match across suffixes, case and spacing', () => {
  assert.equal(normalizeCompany('Vodafone Egypt, Inc.'), 'vodafone');
  assert.ok(sameCompany('Vodafone Egypt', 'vodafone'));
  assert.ok(sameCompany('Microsoft Research', 'Microsoft'));
  assert.ok(sameCompany('Pay Mob', 'Paymob'));
  assert.ok(!sameCompany('OpenAI Labs', 'AI'));
  assert.ok(!sameCompany('Valeo', 'Vodafone'));
  assert.ok(!sameCompany(null, 'Vodafone'));
});

const STAGES: SankeyStage[] = [
  { id: 1, name: 'Saved', color: '#1', sort_order: 0, kind: 'active' },
  { id: 2, name: 'Applied', color: '#2', sort_order: 1, kind: 'active' },
  { id: 3, name: 'Interview', color: '#3', sort_order: 2, kind: 'active' },
  { id: 4, name: 'Offer', color: '#4', sort_order: 3, kind: 'closed_won' },
  { id: 5, name: 'Rejected', color: '#5', sort_order: 4, kind: 'closed_lost' },
];

test('buildSankey flows applications to outcomes and ignores saved-only jobs', () => {
  const { nodes, links } = buildSankey(STAGES, [
    { stage_id: 1, visited: [1] }, // saved only: not an application
    { stage_id: 2, visited: [1, 2] }, // no reply
    { stage_id: 5, visited: [2, 5] }, // rejected straight away
    { stage_id: 5, visited: [2, 3, 5] }, // rejected after interview
    { stage_id: 4, visited: [2, 3, 4] }, // offer
    { stage_id: 3, visited: [2, 3] }, // still interviewing
  ]);
  const count = (name: string) => nodes.find((n) => n.name === name)?.count;
  assert.equal(count('Applications'), 5);
  assert.equal(count('No reply yet'), 1);
  assert.equal(count('Rejected'), 1);
  assert.equal(count('Interview'), 3);
  assert.equal(count('Rejected after Interview'), 1);
  assert.equal(count('Offer'), 1);
  assert.equal(count('In progress at Interview'), 1);
  // Every node except the root receives exactly its count.
  nodes.forEach((n, i) => {
    if (i === 0) return;
    const inflow = links.filter((l) => l.target === i).reduce((a, l) => a + l.value, 0);
    assert.equal(inflow, n.count, n.name);
  });
});

test('buildSankey is empty with no applications', () => {
  assert.deepEqual(buildSankey(STAGES, [{ stage_id: 1, visited: [1] }]), { nodes: [], links: [] });
});
