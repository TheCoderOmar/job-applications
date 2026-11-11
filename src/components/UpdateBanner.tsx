import { useEffect, useState } from 'react';
import { api, type UpdateInfo } from '../api';
import Icon from './Icon';

const DISMISS_KEY = 'update-dismissed';

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
    return () => clearInterval(t);
  }, []);

  /** Waits for the restarted server, then reloads so the new code runs. */
  async function waitForRestart() {
    setState('restarting');
    await new Promise((r) => setTimeout(r, 2500));
    for (let i = 0; i < 90; i++) {
      try {
        await api.stages();
        location.reload();
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    setState('error');
    setMessage('The app did not come back. Close it and open it again from its desktop icon.');
  }

  async function update() {
    setState('updating');
    setMessage('');
    try {
      const r = await api.applyUpdate();
      if (r.needs_restart) {
        setInfo((i) => i && { ...i, behind: 0, needs_restart: true });
        setState('idle');
        return;
      }
      await waitForRestart();
    } catch (e) {
      // The server restarting mid-answer looks like a network error: the update went through.
      if (e instanceof TypeError) return waitForRestart();
      setState('error');
      setMessage((e as Error).message);
    }
  }

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
                {info.commits.map((c, i) => (
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
