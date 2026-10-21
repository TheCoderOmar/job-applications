// Helpers with no database access: LinkedIn CSV parsing, company-name matching, Sankey building.

/** RFC 4180-style CSV parser: quoted fields, "" escapes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') (field += '"'), i++;
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === '') quoted = true; // a quote only opens at the start of a field
    else if (ch === ',') row.push(field), (field = '');
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field), rows.push(row), (row = []), (field = '');
    } else field += ch;
  }
  if (field || row.length) row.push(field), rows.push(row);
  return rows.filter((r) => r.some((v) => v.trim()));
}

export interface ImportedContact {
  full_name: string;
  company: string | null;
  position: string | null;
  linkedin_url: string | null;
  email: string | null;
  connected_on: string | null;
}

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/** "15 Oct 2026" → "2026-10-15"; anything else is kept as typed. */
function isoDate(v: string): string | null {
  const t = v.trim();
  if (!t) return null;
  const m = /^(\d{1,2})[ -]([A-Za-z]{3})[A-Za-z]*[ -](\d{4})$/.exec(t);
  if (m && MONTHS[m[2].toLowerCase()]) return `${m[3]}-${MONTHS[m[2].toLowerCase()]}-${m[1].padStart(2, '0')}`;
  return t;
}

/**
 * Reads LinkedIn's Connections.csv (Settings → Data privacy → Get a copy of your data → Connections).
 * The file starts with a few "Notes:" lines before the real header, so we look for the header row.
 */
export function parseLinkedInConnections(text: string): ImportedContact[] {
  const rows = parseCsv(text);
  const headerAt = rows.findIndex((r) => r.some((c) => /^first name$/i.test(c.trim())));
  if (headerAt < 0) throw new Error('This does not look like LinkedIn Connections.csv (no "First Name" column).');
  const header = rows[headerAt].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const idx = {
    first: col('first name'),
    last: col('last name'),
    url: col('url'),
    email: col('email address'),
    company: col('company'),
    position: col('position'),
    connected: col('connected on'),
  };
  const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
  const out: ImportedContact[] = [];
  for (const r of rows.slice(headerAt + 1)) {
    const full_name = `${get(r, idx.first)} ${get(r, idx.last)}`.trim();
    if (!full_name) continue;
    out.push({
      full_name,
      company: get(r, idx.company) || null,
      position: get(r, idx.position) || null,
      linkedin_url: get(r, idx.url).replace(/\/+$/, '') || null,
      email: get(r, idx.email) || null,
      connected_on: isoDate(get(r, idx.connected)),
    });
  }
  return out;
}

const SUFFIXES = new Set([
  'the', 'inc', 'llc', 'ltd', 'limited', 'co', 'corp', 'corporation', 'company', 'group', 'plc', 'gmbh',
  'sa', 'sae', 'ag', 'bv', 'holding', 'holdings', 'egypt', 'ksa', 'uae', 'mena', 'international',
]);

/** "Vodafone Egypt, Inc." → "vodafone". */
export function normalizeCompany(name: string | null | undefined): string {
  return String(name ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9؀-ۿ]+/g, ' ')
    .split(' ')
    .filter((w) => w && !SUFFIXES.has(w))
    .join(' ');
}

/** True when a connection's company names the same employer as the company being applied to. */
export function sameCompany(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normalizeCompany(a);
  const y = normalizeCompany(b);
  if (!x || !y) return false;
  if (x === y || x.replace(/ /g, '') === y.replace(/ /g, '')) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  // "microsoft" matches "microsoft research", but "ai" doesn't match "openai labs".
  return short.length >= 4 && ` ${long} `.includes(` ${short} `);
}

// ---------- Sankey ----------

export interface SankeyStage {
  id: number;
  name: string;
  color: string;
  sort_order: number;
  kind: 'active' | 'closed_won' | 'closed_lost';
}

export interface SankeyJob {
  stage_id: number;
  /** Stage ids the job has been in, oldest first. */
  visited: number[];
}

export interface SankeyData {
  /** kind orders the chart top to bottom: progress first, then waiting, no reply, closed. */
  nodes: { name: string; color: string; count: number; kind: 'root' | 'stage' | 'open' | 'none' | 'lost' }[];
  links: { source: number; target: number; value: number }[];
}

const NO_REPLY = '#d9a441';
const IN_PROGRESS = '#64748b';

/**
 * Applications → each later stage reached (in pipeline order) → where the job ended up.
 * Only applied jobs count (moved past the first stage). The second stage ("Applied") is the root.
 */
export function buildSankey(stages: SankeyStage[], jobs: SankeyJob[]): SankeyData {
  const ordered = [...stages].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  const byId = new Map(ordered.map((s) => [s.id, s]));
  const first = ordered[0];
  const appliedStage = ordered.find((s) => s !== first && s.kind === 'active');
  const rootOrder = appliedStage?.sort_order ?? first?.sort_order ?? 0;

  const nodes: SankeyData['nodes'] = [];
  const nodeIdx = new Map<string, number>();
  const node = (key: string, name: string, color: string, kind: SankeyData['nodes'][number]['kind']) => {
    if (!nodeIdx.has(key)) nodeIdx.set(key, nodes.push({ name, color, count: 0, kind }) - 1);
    return nodeIdx.get(key)!;
  };
  const linkMap = new Map<string, number>();
  const link = (a: number, b: number) => {
    const k = `${a}>${b}`;
    linkMap.set(k, (linkMap.get(k) ?? 0) + 1);
  };

  const root = node('root', 'Applications', '#3987e5', 'root');
  for (const job of jobs) {
    const current = byId.get(job.stage_id);
    const everApplied = job.visited.some((id) => id !== first?.id) || (current && current !== first);
    if (!everApplied || !current) continue;
    nodes[root].count++;

    // Progress stages reached after "Applied", deduped, in pipeline order.
    const path = [...new Set(job.visited)]
      .map((id) => byId.get(id))
      .filter((s): s is SankeyStage => !!s && s.kind !== 'closed_lost' && s.sort_order > rootOrder)
      .sort((a, b) => a.sort_order - b.sort_order);

    let at = root;
    let atName = 'Applications';
    for (const s of path) {
      const n = node(`s${s.id}`, s.name, s.color, 'stage');
      nodes[n].count++;
      link(at, n);
      at = n;
      atName = s.name;
    }

    let outcome: number | null = null;
    if (current.kind === 'closed_lost') {
      const name = at === root ? current.name : `${current.name} after ${atName}`;
      outcome = node(`${at}:${current.id}`, name, current.color, 'lost');
    } else if (current.kind === 'active' && at === root) {
      outcome = node('no-reply', 'No reply yet', NO_REPLY, 'none');
    } else if (current.kind === 'active') {
      outcome = node(`${at}:open`, `In progress at ${atName}`, IN_PROGRESS, 'open');
    }
    // A won stage (Offer, Accepted) is the end of its own path.
    if (outcome !== null) {
      nodes[outcome].count++;
      link(at, outcome);
    }
  }

  const links = [...linkMap].map(([k, value]) => {
    const [source, target] = k.split('>').map(Number);
    return { source, target, value };
  });
  return nodes[root].count ? { nodes, links } : { nodes: [], links: [] };
}

// ---------- Conversations (LinkedIn messages.csv) ----------

/** "https://www.linkedin.com/in/Some-One/?x" → "linkedin.com/in/some-one" so connection and message links compare equal. */
export function profileKey(url: string | null | undefined): string | null {
  const m = /linkedin\.com\/in\/([^/?#\s]+)/i.exec(String(url ?? ''));
  return m ? `linkedin.com/in/${decodeURIComponent(m[1]).toLowerCase()}` : null;
}

export interface ConversationStats {
  conversations: number;
  messages: number;
  messages_from_them: number;
  last_message_at: string | null;
}

/**
 * Per person: how many conversations and messages you had with them, and how many they sent.
 * Only the counts are kept; message text is never read past this function. Spam is skipped.
 * You are the profile that appears in the most conversations, and are left out.
 */
export function conversationStats(text: string): Map<string, ConversationStats> {
  const rows = parseCsv(text);
  const header = rows[0]?.map((h) => h.trim().toUpperCase()) ?? [];
  const col = (n: string) => header.indexOf(n);
  const idx = {
    conv: col('CONVERSATION ID'),
    sender: col('SENDER PROFILE URL'),
    to: col('RECIPIENT PROFILE URLS'),
    date: col('DATE'),
    folder: col('FOLDER'),
  };
  if (idx.conv < 0 || idx.sender < 0) throw new Error('This does not look like LinkedIn messages.csv.');

  type Msg = { conv: string; sender: string | null; people: string[]; date: string | null };
  const msgs: Msg[] = [];
  for (const r of rows.slice(1)) {
    if (/spam/i.test(r[idx.folder] ?? '')) continue;
    const sender = profileKey(r[idx.sender]);
    const to = String(r[idx.to] ?? '')
      .split(/[,\s]+/)
      .map(profileKey)
      .filter((k): k is string => !!k);
    const people = [...new Set([sender, ...to].filter((k): k is string => !!k))];
    const date = (r[idx.date] ?? '').trim().replace(' UTC', 'Z').replace(' ', 'T') || null;
    msgs.push({ conv: r[idx.conv], sender, people, date });
  }

  // Find "me": in the most conversations.
  const convsBy = new Map<string, Set<string>>();
  for (const m of msgs) for (const p of m.people) (convsBy.get(p) ?? convsBy.set(p, new Set()).get(p)!).add(m.conv);
  let me: string | null = null;
  for (const [p, s] of convsBy) if (!me || s.size > convsBy.get(me)!.size) me = p;

  const out = new Map<string, ConversationStats & { convs: Set<string> }>();
  for (const m of msgs) {
    for (const p of m.people) {
      if (p === me) continue;
      const s = out.get(p) ?? { conversations: 0, messages: 0, messages_from_them: 0, last_message_at: null, convs: new Set<string>() };
      s.convs.add(m.conv);
      s.messages++;
      if (m.sender === p) s.messages_from_them++;
      if (m.date && (!s.last_message_at || m.date > s.last_message_at)) s.last_message_at = m.date;
      out.set(p, s);
    }
  }
  const result = new Map<string, ConversationStats>();
  for (const [p, { convs, ...s }] of out) result.set(p, { ...s, conversations: convs.size });
  return result;
}
