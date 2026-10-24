// Interview question sets: { role, topics: [{ topic, questions: [{ id, type: 'mcq' | 'card', question, options?, answer }] }] }.

export interface QuizQuestionInput {
  ext_id: string;
  topic: string;
  topic_order: number;
  sort_order: number;
  type: 'mcq' | 'card';
  question: string;
  options: string[] | null;
  answer: string;
}

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/**
 * A question file → its role and questions, or an error message saying what's wrong.
 * Questions without an id get one from their topic and position, so re-importing the same file updates them.
 */
export function parseQuizFile(raw: unknown): { role: string; questions: QuizQuestionInput[] } | string {
  let data = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw.replace(/^﻿/, ''));
    } catch {
      return "That file isn't valid JSON.";
    }
  }
  const d = data as { role?: unknown; topics?: unknown };
  const role = text(d?.role);
  if (!role) return 'The file needs a "role", e.g. "Backend Developer (Node.js)".';
  if (!Array.isArray(d.topics) || !d.topics.length) return 'The file needs a "topics" list.';
  const questions: QuizQuestionInput[] = [];
  const seen = new Set<string>();
  for (const [ti, t] of (d.topics as { topic?: unknown; questions?: unknown }[]).entries()) {
    const topic = text(t?.topic) || `Topic ${ti + 1}`;
    if (!Array.isArray(t?.questions)) return `"${topic}" has no "questions" list.`;
    for (const [qi, q] of (t.questions as Record<string, unknown>[]).entries()) {
      const question = text(q?.question);
      const answer = text(q?.answer);
      const where = `${topic}, question ${qi + 1}`;
      if (!question || !answer) return `${where} needs a "question" and an "answer".`;
      let options: string[] | null = null;
      let type: 'mcq' | 'card' = q.type === 'mcq' ? 'mcq' : 'card';
      if (Array.isArray(q.options) && q.options.length) {
        options = q.options.map(text).filter(Boolean);
        type = 'mcq';
        if (!options.includes(answer)) return `${where}: the answer isn't one of its options.`;
      } else if (type === 'mcq') return `${where} is multiple choice but has no "options".`;
      const ext_id = text(q.id) || `${topic}#${qi + 1}`;
      if (seen.has(ext_id)) return `The id "${ext_id}" is used twice.`;
      seen.add(ext_id);
      questions.push({ ext_id, topic, topic_order: ti, sort_order: qi, type, question, options, answer });
    }
  }
  if (!questions.length) return 'The file has no questions.';
  return { role, questions };
}

/** Fisher–Yates; `random` is injectable for tests. */
export function shuffle<T>(items: T[], random = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
