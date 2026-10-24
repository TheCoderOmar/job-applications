import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { QuizQuestion, QuizSet, QuizTopic, QuizTypes, QuizWhich } from '../types';
import Icon from '../components/Icon';
import { dmy } from '../dates';

/** Remembered in this browser: the set you last practised. */
const SET_KEY = 'quiz-set';
const remember = (id: number) => {
  try {
    localStorage.setItem(SET_KEY, String(id));
  } catch {
    /* storage unavailable */
  }
};
const remembered = () => {
  try {
    return Number(localStorage.getItem(SET_KEY)) || null;
  } catch {
    return null;
  }
};

type Options = { which: QuizWhich; types: QuizTypes; count: number | null };
type Session = { questions: QuizQuestion[]; index: number; results: Record<number, boolean> };

export default function Quiz() {
  const [sets, setSets] = useState<QuizSet[] | null>(null);
  const [setId, setSetId] = useState<number | null>(remembered);
  const [chosen, setChosen] = useState<Set<string> | null>(null);
  const [opts, setOpts] = useState<Options>({ which: 'all', types: 'all', count: 10 });
  const [session, setSession] = useState<Session | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => api.quizSets().then(setSets), []);
  useEffect(() => {
    load();
  }, [load]);

  const set = sets?.find((s) => s.id === setId) ?? sets?.[0] ?? null;
  // Every topic is picked until you change it, and again when you switch sets.
  const picked = chosen ?? new Set(set?.topics.map((t) => t.topic) ?? []);

  async function importFile(file: File) {
    setMessage(null);
    if (fileRef.current) fileRef.current.value = '';
    try {
      const r = await api.importQuiz(await file.text());
      const parts = [`${r.added} new`, r.updated && `${r.updated} updated`, r.removed && `${r.removed} removed`].filter(Boolean);
      setMessage({ text: `Imported ${r.role}: ${parts.join(', ')}.` });
      setSetId(r.set_id);
      remember(r.set_id);
      setChosen(null);
      load();
    } catch (e) {
      setMessage({ text: (e as Error).message, error: true });
    }
  }

  async function start(which: QuizWhich = opts.which, topics = [...picked], count = opts.count, types: QuizTypes = opts.types) {
    if (!set) return;
    setMessage(null);
    const questions = await api.startQuiz(set.id, { topics, which, types, count });
    if (!questions.length) {
      setMessage({
        text: which === 'missed' ? 'Nothing missed there. Nice.' : which === 'new' ? "You've tried every question there." : 'No questions match.',
      });
      return;
    }
    setSession({ questions, index: 0, results: {} });
  }

  if (session) {
    return (
      <QuizSession
        session={session}
        onChange={setSession}
        onDone={() => {
          setSession(null);
          load();
        }}
      />
    );
  }

  const totals = set?.topics.reduce(
    (a, t) => ({ total: a.total + t.total, answered: a.answered + t.answered, got_right: a.got_right + t.got_right, missed: a.missed + t.missed }),
    { total: 0, answered: 0, got_right: 0, missed: 0 },
  );
  const pickedCount = set?.topics.filter((t) => picked.has(t.topic)).reduce((n, t) => n + t.total, 0) ?? 0;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Quiz</h1>
          <p className="mt-1 text-sm text-muted">Interview questions by topic. Your answers are kept, so you can go back to the ones you missed.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sets && sets.length > 1 && (
            <select
              className="input w-auto"
              value={set?.id}
              onChange={(e) => {
                setSetId(Number(e.target.value));
                remember(Number(e.target.value));
                setChosen(null);
              }}
            >
              {sets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.role}
                </option>
              ))}
            </select>
          )}
          <button className={sets?.length ? 'btn-ghost' : 'btn-primary'} onClick={() => fileRef.current?.click()}>
            <Icon name="upload" /> Import questions
          </button>
          <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
        </div>
      </header>

      {message && (
        <p className={`rounded-lg border px-4 py-2.5 text-sm ${message.error ? 'border-red-500/40 text-red-300' : 'border-emerald-500/40 text-emerald-300'}`}>
          {message.text}
        </p>
      )}

      {sets === null ? (
        <p className="text-muted">Loading…</p>
      ) : !set ? (
        <div className="card space-y-3 p-8 text-sm text-muted">
          <p className="text-fg">No questions yet. Import a JSON file of interview questions:</p>
          <pre className="overflow-x-auto rounded-lg bg-ink/60 p-4 text-xs leading-relaxed">{`{
  "role": "Backend Developer (Node.js)",
  "topics": [
    { "topic": "Node.js", "questions": [
      { "id": "node-1", "type": "mcq", "question": "…", "options": ["…", "…"], "answer": "…" },
      { "id": "node-2", "type": "card", "question": "…", "answer": "…" }
    ] }
  ]
}`}</pre>
          <p>Importing a file with the same role again updates that set and keeps your answers.</p>
        </div>
      ) : (
        <>
          <section className="card flex flex-wrap items-center justify-between gap-4 p-5">
            <div>
              <h2 className="text-lg font-semibold">{set.role}</h2>
              <p className="mt-0.5 text-sm text-muted">
                {totals!.total} questions in {set.topics.length} topics · tried {totals!.answered} · imported {dmy(set.imported_at)}
              </p>
              <ProgressBar t={totals!} className="mt-3 w-72 max-w-full" />
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="btn-primary" disabled={!totals!.missed} onClick={() => start('missed', [], null, 'all')}>
                <Icon name="refresh" /> Practise the ones I missed ({totals!.missed})
              </button>
              <button
                className="btn-ghost"
                disabled={!totals!.answered}
                title="Forget your answers in this set"
                onClick={async () => {
                  if (!confirm(`Forget all your answers in ${set.role}? The questions stay.`)) return;
                  setSets(await api.resetQuizProgress(set.id));
                }}
              >
                Reset progress
              </button>
              <button
                className="btn-ghost text-red-300"
                title="Delete this question set"
                onClick={async () => {
                  if (!confirm(`Delete ${set.role} and your answers in it?`)) return;
                  await api.deleteQuizSet(set.id);
                  setChosen(null);
                  load();
                }}
              >
                <Icon name="trash" />
              </button>
            </div>
          </section>

          <section className="card flex flex-wrap items-end gap-x-6 gap-y-4 p-5">
            <Choice
              label="Questions"
              value={opts.count}
              onChange={(count) => setOpts({ ...opts, count })}
              items={[
                [10, '10'],
                [20, '20'],
                [null, 'All'],
              ]}
            />
            <Choice
              label="Which"
              value={opts.which}
              onChange={(which) => setOpts({ ...opts, which })}
              items={[
                ['all', 'All'],
                ['missed', 'Missed'],
                ['new', 'Not tried yet'],
              ]}
            />
            <Choice
              label="Type"
              value={opts.types}
              onChange={(types) => setOpts({ ...opts, types })}
              items={[
                ['all', 'Both'],
                ['mcq', 'Multiple choice'],
                ['card', 'Flashcards'],
              ]}
            />
            <button className="btn-primary ml-auto" disabled={!picked.size} onClick={() => start()}>
              <Icon name="quiz" /> Start quiz
              <span className="opacity-80">({picked.size ? `${picked.size} topic${picked.size === 1 ? '' : 's'}, ${pickedCount} questions` : 'pick a topic'})</span>
            </button>
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold">Topics</h2>
              <div className="flex gap-3 text-sm">
                <button className="text-brand-light hover:underline" onClick={() => setChosen(new Set(set.topics.map((t) => t.topic)))}>
                  Select all
                </button>
                <button className="text-brand-light hover:underline" onClick={() => setChosen(new Set())}>
                  Select none
                </button>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {set.topics.map((t) => (
                <TopicTile
                  key={t.topic}
                  t={t}
                  on={picked.has(t.topic)}
                  onToggle={() => {
                    const next = new Set(picked);
                    if (next.has(t.topic)) next.delete(t.topic);
                    else next.add(t.topic);
                    setChosen(next);
                  }}
                />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function TopicTile({ t, on, onToggle }: { t: QuizTopic; on: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      aria-pressed={on}
      className={`card p-4 text-left transition ${on ? 'border-brand/60 bg-brand/5' : 'opacity-60 hover:opacity-100'}`}
    >
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded border ${on ? 'border-brand bg-brand text-white' : 'border-line'}`}>
          {on && <Icon name="check" className="h-3.5 w-3.5" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-medium leading-snug">{t.topic}</div>
          <div className="mt-0.5 text-xs text-muted">
            {t.total} questions · {t.mcq} multiple choice · {t.card} flashcards
          </div>
          <ProgressBar t={t} className="mt-2.5" />
        </div>
      </div>
    </button>
  );
}

/** Green = latest answer right, red = latest answer wrong, the rest not tried yet. */
function ProgressBar({ t, className = '' }: { t: { total: number; answered: number; got_right: number; missed: number }; className?: string }) {
  const pct = (n: number) => `${(n / Math.max(1, t.total)) * 100}%`;
  return (
    <div className={className}>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-line">
        <div className="bg-emerald-400" style={{ width: pct(t.got_right) }} />
        <div className="bg-red-400" style={{ width: pct(t.missed) }} />
      </div>
      <div className="mt-1 text-xs tabular-nums text-muted">
        {t.answered ? (
          <>
            <span className="text-emerald-300">{t.got_right} right</span>
            {t.missed > 0 && <span className="text-red-300"> · {t.missed} missed</span>}
            {t.total - t.answered > 0 && <span> · {t.total - t.answered} not tried</span>}
          </>
        ) : (
          'Not tried yet'
        )}
      </div>
    </div>
  );
}

function Choice<T extends string | number | null>({
  label,
  value,
  onChange,
  items,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  items: [T, string][];
}) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="flex overflow-hidden rounded-lg border border-line text-sm">
        {items.map(([v, text]) => (
          <button
            key={text}
            onClick={() => onChange(v)}
            aria-pressed={v === value}
            className={`px-3 py-1.5 transition ${v === value ? 'bg-brand/20 text-brand-light' : 'text-muted hover:bg-raised hover:text-fg'}`}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------- Taking a quiz ----------

function QuizSession({ session, onChange, onDone }: { session: Session; onChange: (s: Session) => void; onDone: () => void }) {
  const { questions, index, results } = session;
  const finished = index >= questions.length;
  const q = questions[index];
  const [picked, setPicked] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const answered = q && q.id in results;

  useEffect(() => {
    setPicked(null);
    setRevealed(false);
  }, [index]);

  function record(correct: boolean) {
    if (answered) return;
    onChange({ ...session, results: { ...results, [q.id]: correct } });
    void api.answerQuiz(q.id, correct);
  }
  const next = () => onChange({ ...session, results: { ...results }, index: index + 1 });

  function choose(option: string) {
    if (answered) return;
    setPicked(option);
    record(option === q.answer);
  }

  function grade(knew: boolean) {
    record(knew);
    onChange({ ...session, results: { ...results, [q.id]: knew }, index: index + 1 });
  }

  // Keys: 1–4 pick an option, Space shows a flashcard's answer, Enter goes on.
  useEffect(() => {
    if (finished) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return;
      if (q.type === 'mcq' && !answered && /^[1-9]$/.test(e.key) && q.options![Number(e.key) - 1]) choose(q.options![Number(e.key) - 1]);
      else if (q.type === 'card' && !revealed && (e.key === ' ' || e.key === 'Enter')) (e.preventDefault(), setRevealed(true));
      else if (q.type === 'mcq' && answered && e.key === 'Enter') (e.preventDefault(), next());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (finished) {
    const right = questions.filter((x) => results[x.id]).length;
    const missed = questions.filter((x) => results[x.id] === false);
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <section className="card p-8 text-center">
          <p className="text-sm uppercase tracking-wide text-muted">Quiz done</p>
          <p className="mt-2 text-5xl font-semibold tabular-nums">
            {right} <span className="text-2xl text-muted">/ {questions.length}</span>
          </p>
          <p className="mt-1 text-muted">{Math.round((right / questions.length) * 100)}% right</p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {missed.length > 0 && (
              <button
                className="btn-primary"
                onClick={() =>
                  onChange({
                    questions: [...missed].sort(() => Math.random() - 0.5).map((m) => ({ ...m, options: m.options && [...m.options].sort(() => Math.random() - 0.5) })),
                    index: 0,
                    results: {},
                  })
                }
              >
                <Icon name="refresh" /> Practise these {missed.length} again
              </button>
            )}
            <button className="btn-ghost" onClick={onDone}>
              Back to topics
            </button>
          </div>
        </section>
        {missed.length > 0 && (
          <section className="space-y-3">
            <h2 className="font-semibold">Missed</h2>
            {missed.map((m) => (
              <div key={m.id} className="card p-5">
                <div className="text-xs text-muted">{m.topic}</div>
                <p className="mt-1 font-medium">{m.question}</p>
                <p className="mt-2 whitespace-pre-wrap text-sm text-emerald-300">{m.answer}</p>
              </div>
            ))}
          </section>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex items-center justify-between gap-4 text-sm">
        <span className="tabular-nums text-muted">
          Question {index + 1} of {questions.length}
        </span>
        <button
          className="text-muted hover:text-fg"
          onClick={() => (Object.keys(results).length ? onChange({ ...session, questions: questions.slice(0, index + (answered ? 1 : 0)), index: questions.length }) : onDone())}
        >
          End quiz
        </button>
      </div>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-line">
        {questions.map((x) => (
          <div
            key={x.id}
            className={`flex-1 border-r border-surface last:border-0 ${x.id in results ? (results[x.id] ? 'bg-emerald-400' : 'bg-red-400') : x.id === q.id ? 'bg-brand' : ''}`}
          />
        ))}
      </div>

      <section className="card p-6 md:p-8">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full bg-raised px-2.5 py-1 text-muted">{q.topic}</span>
          <span className="rounded-full bg-raised px-2.5 py-1 text-muted">{q.type === 'mcq' ? 'Multiple choice' : 'Flashcard'}</span>
          {q.last_correct === 0 && <span className="rounded-full bg-red-500/10 px-2.5 py-1 text-red-300">Missed last time</span>}
        </div>
        <h2 className="mt-4 text-xl font-semibold leading-snug">{q.question}</h2>

        {q.type === 'mcq' ? (
          <div className="mt-6 space-y-2.5">
            {q.options!.map((o, i) => {
              const isAnswer = o === q.answer;
              const tone = !answered
                ? 'border-line hover:border-brand/60 hover:bg-raised'
                : isAnswer
                  ? 'border-emerald-400/70 bg-emerald-500/10'
                  : o === picked
                    ? 'border-red-400/70 bg-red-500/10'
                    : 'border-line opacity-50';
              return (
                <button key={o} disabled={answered} onClick={() => choose(o)} className={`flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-left text-sm transition ${tone}`}>
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-raised text-xs tabular-nums text-muted">{i + 1}</span>
                  <span className="pt-0.5">{o}</span>
                  {answered && isAnswer && <Icon name="check" className="ml-auto mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />}
                  {answered && o === picked && !isAnswer && <Icon name="x" className="ml-auto mt-0.5 h-4 w-4 shrink-0 text-red-300" />}
                </button>
              );
            })}
            {answered && (
              <div className="flex items-center justify-between gap-4 pt-3">
                <span className={results[q.id] ? 'text-emerald-300' : 'text-red-300'}>{results[q.id] ? 'Right.' : 'Not quite.'}</span>
                <button className="btn-primary" autoFocus onClick={next}>
                  {index + 1 === questions.length ? 'See results' : 'Next'} <Icon name="chevronRight" />
                </button>
              </div>
            )}
          </div>
        ) : !revealed ? (
          <div className="mt-6">
            <p className="text-sm text-muted">Answer it in your head (or out loud), then check.</p>
            <button className="btn-primary mt-4" onClick={() => setRevealed(true)}>
              Show answer <span className="opacity-70">(Space)</span>
            </button>
          </div>
        ) : (
          <div className="mt-6">
            <div className="whitespace-pre-wrap rounded-lg border border-line bg-ink/40 p-4 text-sm leading-relaxed">{q.answer}</div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button className="btn border border-emerald-400/50 text-emerald-300 hover:bg-emerald-500/10" onClick={() => grade(true)}>
                <Icon name="check" /> Knew it
              </button>
              <button className="btn border border-red-400/50 text-red-300 hover:bg-red-500/10" onClick={() => grade(false)}>
                <Icon name="x" /> Didn't know
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
