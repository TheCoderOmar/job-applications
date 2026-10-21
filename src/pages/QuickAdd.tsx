import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import JobForm from '../components/JobForm';
import Icon from '../components/Icon';

/**
 * The browser extension's small window: just the "Log application" form, filled from the page you
 * were on (?import=<link>&title=<page title>). Saving closes the window.
 */
export default function QuickAdd() {
  const [params] = useSearchParams();
  const url = params.get('import') ?? '';
  const title = params.get('title') ?? '';
  const [saved, setSaved] = useState<{ id: number; title: string } | null>(null);

  if (saved)
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <div>
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-emerald-500/15 text-emerald-300">
            <Icon name="check" className="h-6 w-6" />
          </div>
          <p className="font-semibold">Saved "{saved.title}"</p>
          <p className="mt-1 text-sm text-muted">You can close this window.</p>
          <a href={`/jobs/${saved.id}`} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm text-brand-light hover:underline">
            Open it in the app
          </a>
        </div>
      </div>
    );

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl p-4">
        <h1 className="mb-4 flex items-center gap-2 text-lg font-semibold">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-brand/15 text-brand-light">
            <Icon name="briefcase" className="h-4 w-4" />
          </span>
          Log application
        </h1>
        <JobForm
          initial={url ? { url, title: title || undefined } : undefined}
          autoImport={url || undefined}
          onCancel={() => window.close()}
          onSaved={(j) => {
            setSaved({ id: j.id, title: j.title });
            // Windows the extension opened can close themselves; if the browser refuses, the message stays.
            setTimeout(() => window.close(), 1200);
          }}
        />
      </div>
    </div>
  );
}
