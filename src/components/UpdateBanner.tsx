import { useEffect, useState } from 'react';
import { api, type UpdateInfo } from '../api';
import Icon from './Icon';

const DISMISS_KEY = 'update-dismissed';
/** What the last update brought, kept across the reload so it can be shown once the app is back. */
const WHATS_NEW_KEY = 'whats-new';

const readWhatsNew = (): string[] | null => {
  try {
    const v = JSON.parse(localStorage.getItem(WHATS_NEW_KEY) ?? 'null');
    return Array.isArray(v) && v.length ? v.map(String) : null;
  } catch {
    return null;
  }
};
const saveWhatsNew = (notes: string[]) => {
  try {
    localStorage.setItem(WHATS_NEW_KEY, JSON.stringify(notes));
  } catch {
    /* storage unavailable */
  }
};
/** What's new: the changelog lines, else the commit subjects without merge commits. */
const notesOf = (i: { notes?: string[]; commits: string[] }) =>
  i.notes?.length ? i.notes : i.commits.filter((c) => !/^Merge (branch|pull request)/i.test(c));
/** Sent by "Check for updates" in Settings, so this card shows the new result right away. */
export const UPDATE_EVENT = 'update-status';

/**
 * "Update available" card, bottom right, when GitHub has a newer version. "Update now" pulls it; the app then
 * restarts by itself and the page reloads once it's back. After an update that changed packages, it asks you to
 * restart the app from its desktop icon instead.
 */
export default function UpdateBanner() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [state, setState] = useState<'idle' | 'updating' | 'restarting' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [open, setOpen] = useState(false);
  // Shown once after an update: what it added.
  const [whatsNew, setWhatsNew] = useState<string[] | null>(readWhatsNew);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(DISMISS_KEY);
    } catch {
      return null;
    }
  });

  useEffect(() => {
    const load = () => api.updateStatus().then(setInfo, () => {});
    load();
    const t = setInterval(load, 30 * 60 * 1000);
    // A check you asked for shows its result even if you pressed "Later" before.
    const onCheck = (e: Event) => {
      setInfo((e as CustomEvent<UpdateInfo>).detail);
      setDismissed(null);
      try {
        sessionStorage.removeItem(DISMISS_KEY);
      } catch {
        /* storage unavailable */
      }
    };
    window.addEventListener(UPDATE_EVENT, onCheck);
    return () => {
      clearInterval(t);
      window.removeEventListener(UPDATE_EVENT, onCheck);
    };
  }, []);

  /**
   * Waits for the restarted server, then reloads so the new code runs. The server can restart more than once
   * while an update's files land, so it must answer twice in a row, 2 seconds apart (reloading during the
   * second restart gave a "500" error until you refreshed).
   */
  async function waitForRestart() {
    setState('restarting');
    await new Promise((r) => setTimeout(r, 3000));
    const up = () =>
      fetch('/api/stages', { cache: 'no-store' })
        .then((r) => r.ok)
        .catch(() => false);
    let inRow = 0;
    for (let i = 0; i < 120; i++) {
      inRow = (await up()) ? inRow + 1 : 0;
      if (inRow >= 2) {
        location.reload();
        return;
      }
      await new Promise((r) => setTimeout(r, inRow ? 2000 : 1000));
    }
    setState('error');
    setMessage('The app did not come back. Close it and open it again from its desktop icon.');
  }

  async function update() {
    setState('updating');
    setMessage('');
    try {
      const r = await api.applyUpdate();
      saveWhatsNew(r.notes.length ? r.notes : notesOf(info!));
      if (r.needs_restart) {
        setInfo((i) => i && { ...i, behind: 0, needs_restart: true });
        setState('idle');
        return;
      }
      await waitForRestart();
    } catch (e) {
      // The server restarting mid-answer looks like a network error: the update went through.
      if (e instanceof TypeError) {
        saveWhatsNew(notesOf(info!));
        return waitForRestart();
      }
      setState('error');
      setMessage((e as Error).message);
    }
  }

  if (whatsNew)
    return (
      <div className="fixed bottom-4 right-4 z-[1000] w-[min(26rem,calc(100vw-2rem))]" role="status">
        <div className="card bg-surface/95 p-4 shadow-glow backdrop-blur">
          <p className="flex items-center gap-2 font-semibold">
            <Icon name="check" className="h-4 w-4 text-emerald-300" /> Updated: here's what's new
          </p>
          <ul className="mt-2 max-h-64 list-disc space-y-1 overflow-y-auto pl-5 text-sm text-muted">
            {whatsNew.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
          <div className="mt-3 flex justify-end">
            <button
              className="btn-primary px-3 py-1.5 text-sm"
              onClick={() => {
                try {
                  localStorage.removeItem(WHATS_NEW_KEY);
                } catch {
                  /* storage unavailable */
                }
                setWhatsNew(null);
              }}
            >
              Got it
            </button>
          </div>
        </div>
      </div>
    );
  if (!info) return null;
  const key = `${info.behind}:${info.commits[0] ?? ''}`;
  const show = info.needs_restart || (info.behind > 0 && dismissed !== key);
  if (!show) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[1000] w-[min(24rem,calc(100vw-2rem))]" role="status">
      <div className="card bg-surface/95 p-4 shadow-glow backdrop-blur">
        {info.needs_restart ? (
          <>
            <p className="flex items-center gap-2 font-semibold">
              <Icon name="refresh" className="h-4 w-4 text-brand-light" /> Restart to finish the update
            </p>
            <p className="mt-1 text-sm text-muted">
              The update added new packages. Close the app's server window (or press Ctrl+C in its terminal), then open the app again from its
              desktop icon; it installs them first.
            </p>
          </>
        ) : (
          <>
            <p className="flex items-center gap-2 font-semibold">
              <Icon name="download" className="h-4 w-4 text-brand-light" /> Update available
            </p>
            <p className="mt-1 text-sm text-muted">
              {info.behind} new change{info.behind === 1 ? '' : 's'} on GitHub.{' '}
              <button className="text-brand-light hover:underline" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
                {open ? 'Hide' : "What's new"}
              </button>
            </p>
            {open && (
              <ul className="mt-2 max-h-40 list-disc space-y-0.5 overflow-y-auto pl-5 text-xs text-muted">
                {notesOf(info).map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            )}
            {info.blocked && <p className="mt-2 text-xs text-amber-300">{info.blocked}</p>}
            {message && <p className={`mt-2 text-xs ${state === 'error' ? 'text-red-300' : 'text-muted'}`}>{message}</p>}
            <div className="mt-3 flex justify-end gap-2">
              <button
                className="btn-ghost px-3 py-1.5 text-sm"
                disabled={state === 'updating' || state === 'restarting'}
                onClick={() => {
                  setDismissed(key);
                  try {
                    sessionStorage.setItem(DISMISS_KEY, key);
                  } catch {
                    /* storage unavailable */
                  }
                }}
              >
                Later
              </button>
              <button
                className="btn-primary px-3 py-1.5 text-sm"
                onClick={update}
                disabled={!!info.blocked || state === 'updating' || state === 'restarting'}
              >
                {state === 'updating' ? 'Updating…' : state === 'restarting' ? 'Restarting…' : 'Update now'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
