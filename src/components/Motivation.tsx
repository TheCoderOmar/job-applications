import { useState } from 'react';
import type { Stats } from '../types';
import Icon from './Icon';

/** A new one each day. */
const QUOTES = [
  'You only need one yes.',
  'Every rejection is one step closer to the right yes.',
  'Consistency beats intensity: a few good applications a day add up.',
  'Progress, not perfection. Send it.',
  'The right job is looking for you too.',
  'Small steps every day beat big plans someday.',
  'Your next interview could be one message away.',
  'Reach out to one person at a company you like. Referrals open doors.',
  'Tailor one CV today and you are ahead of most applicants.',
  'Rest is part of the search. Come back stronger tomorrow.',
  'Every application is practice for the one that lands.',
  'You have done hard things before. This is one more.',
];

const DISMISS_KEY = 'motivation-hidden-on';
const todayKey = () => new Date().toLocaleDateString('en-CA'); // yyyy-mm-dd, your own day

/** Monday of this week as yyyy-mm-dd, the way the server groups applications per week. */
function thisWeek(): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Where you are this week, said encouragingly. */
function progressLine(stats: Stats): string {
  const week = stats.perWeek.find((w) => w.week === thisWeek())?.count ?? 0;
  const { applied, in_progress, won } = stats.totals;
  if (week >= 5) return `${week} applications this week. That's real momentum, keep it going.`;
  if (week > 0) return `${week} application${week === 1 ? '' : 's'} this week. One more today keeps the streak alive.`;
  if (in_progress > 0) return `${in_progress} application${in_progress === 1 ? ' is' : 's are'} still in play, and each one is a real chance. Add one more this week.`;
  if (won > 0) return "You've landed an offer before. You can do it again.";
  if (applied > 0) return 'No applications yet this week. One today is a great start.';
  return 'Log your first application today. The search starts with one.';
}

/** The Dashboard's encouragement: a quote of the day and how your week is going. Hidden for the day with ✕. */
export default function Motivation({ stats }: { stats: Stats }) {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === todayKey();
    } catch {
      return false;
    }
  });
  if (hidden) return null;
  const day = Math.floor(new Date(todayKey()).getTime() / 86400000);
  const quote = QUOTES[day % QUOTES.length];

  return (
    <div className="card flex items-start gap-3 border-brand/30 bg-brand/5 px-4 py-3" role="status">
      <Icon name="star" className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-fg">{quote}</p>
        <p className="mt-0.5 text-sm text-muted">{progressLine(stats)}</p>
      </div>
      <button
        className="shrink-0 rounded p-1 text-muted hover:bg-raised hover:text-fg"
        aria-label="Hide for today"
        title="Hide for today"
        onClick={() => {
          try {
            localStorage.setItem(DISMISS_KEY, todayKey());
          } catch {
            /* storage unavailable */
          }
          setHidden(true);
        }}
      >
        <Icon name="x" className="h-4 w-4" />
      </button>
    </div>
  );
}
