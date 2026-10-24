import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../api';
import type { Cv } from '../types';
import Icon from '../components/Icon';
import Modal from '../components/Modal';
import CvPreview, { fileSize } from '../components/CvPreview';
import { dmy, todayIso } from '../dates';

const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.readAsDataURL(file);
  });

/** "CV 24/10/2026", or "CV 24/10/2026 (2)" when that's taken (the server does the same when no label is given). */
function suggestLabel(cvs: Cv[]) {
  const base = `CV ${todayIso().split('-').reverse().join('/')}`;
  const used = new Set(cvs.map((c) => c.label.toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  let n = 2;
  while (used.has(`${base} (${n})`.toLowerCase())) n++;
  return `${base} (${n})`;
}

type Draft = { id?: number; file?: File; label: string; notes: string };

export default function Cvs() {
  const [cvs, setCvs] = useState<Cv[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [viewing, setViewing] = useState<Cv | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const replacing = useRef<Cv | null>(null);

  const load = useCallback(() => {
    api.cvs().then(setCvs);
  }, []);
  useEffect(load, [load]);

  async function run(fn: () => Promise<unknown>, done: string) {
    setMessage(null);
    try {
      await fn();
      setMessage({ text: done });
      load();
    } catch (e) {
      setMessage({ text: (e as Error).message, error: true });
    }
  }

  async function replaceFile(file: File) {
    const cv = replacing.current!;
    if (replaceRef.current) replaceRef.current.value = '';
    await run(async () => api.replaceCvFile(cv.id, { dataUrl: await readAsDataUrl(file), file_name: file.name }), `Replaced the file of ${cv.label}.`);
  }

  async function remove(cv: Cv) {
    if (cv.job_count) {
      setMessage({ text: `${cv.label} is used by ${cv.job_count} application(s). Pick another CV on them first.`, error: true });
      return;
    }
    if (!confirm(`Delete ${cv.label}?`)) return;
    await run(() => api.deleteCv(cv.id), `Deleted ${cv.label}.`);
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">CVs</h1>
          <p className="mt-1 text-sm text-muted">Every version you send, each with its own label. New applications use the default one.</p>
        </div>
        <button className="btn-primary" onClick={() => uploadRef.current?.click()}>
          <Icon name="upload" /> Upload CV
        </button>
        <input
          ref={uploadRef}
          type="file"
          accept=".pdf,.doc,.docx,application/pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) setDraft({ file, label: suggestLabel(cvs ?? []), notes: '' });
          }}
        />
        <input
          ref={replaceRef}
          type="file"
          accept=".pdf,.doc,.docx,application/pdf"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && replaceFile(e.target.files[0])}
        />
      </header>

      {message && (
        <p className={`rounded-lg border px-4 py-2.5 text-sm ${message.error ? 'border-red-500/40 text-red-300' : 'border-emerald-500/40 text-emerald-300'}`}>
          {message.text}
        </p>
      )}

      {cvs === null ? (
        <p className="text-muted">Loading…</p>
      ) : cvs.length === 0 ? (
        <div className="card p-10 text-center text-muted">No CVs yet. Upload the one you're sending now; the first one becomes the default.</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {cvs.map((cv) => (
            <div key={cv.id} className={`card flex flex-col p-4 ${cv.is_default ? 'border-brand/50' : ''}`}>
              <button className="flex flex-1 items-start gap-3 text-left" onClick={() => setViewing(cv)} title="View this CV">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-brand/15 text-brand-light">
                  <Icon name="file" className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold hover:text-brand-light">{cv.label}</span>
                    {!!cv.is_default && <span className="rounded-full bg-brand/15 px-2 py-0.5 text-[11px] font-medium text-brand-light">Default</span>}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted">{cv.file_name}</span>
                  <span className="mt-0.5 block text-xs tabular-nums text-muted">
                    Added {dmy(cv.created_at)} · {fileSize(cv.size)} · used in {cv.job_count} application{cv.job_count === 1 ? '' : 's'}
                  </span>
                  {cv.notes && <span className="mt-2 block whitespace-pre-wrap text-sm text-fg/80">{cv.notes}</span>}
                </span>
              </button>
              <div className="mt-4 flex flex-wrap gap-1.5 border-t border-line pt-3 text-sm">
                {!cv.is_default && (
                  <button className="btn-ghost py-1" onClick={() => run(() => api.setDefaultCv(cv.id), `${cv.label} is now the default.`)}>
                    <Icon name="check" /> Set as default
                  </button>
                )}
                <button className="btn-ghost py-1" onClick={() => setDraft({ id: cv.id, label: cv.label, notes: cv.notes ?? '' })} title="Edit label and notes">
                  <Icon name="edit" /> Edit
                </button>
                <button
                  className="btn-ghost py-1"
                  onClick={() => {
                    replacing.current = cv;
                    replaceRef.current?.click();
                  }}
                  title="Upload a corrected file; applications sent with this CV keep it"
                >
                  <Icon name="refresh" /> Replace file
                </button>
                <a className="btn-ghost py-1" href={api.cvFileUrl(cv.id, true)} title="Download">
                  <Icon name="download" />
                </a>
                <button className="btn-ghost py-1 text-red-300" onClick={() => remove(cv)} title="Delete">
                  <Icon name="trash" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {draft && (
        <CvForm
          draft={draft}
          onClose={() => setDraft(null)}
          onSave={async (d) => {
            if (d.id) await api.updateCv(d.id, { label: d.label, notes: d.notes || null });
            else await api.uploadCv({ dataUrl: await readAsDataUrl(d.file!), file_name: d.file!.name, label: d.label, notes: d.notes });
            setDraft(null);
            setMessage(d.id ? null : { text: `Added ${d.label}.` });
            load();
          }}
        />
      )}
      {viewing && <CvPreview cv={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function CvForm({ draft, onClose, onSave }: { draft: Draft; onClose: () => void; onSave: (d: Draft) => Promise<void> }) {
  const [d, setD] = useState(draft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await onSave(d);
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }
  return (
    <Modal title={d.id ? 'Edit CV' : 'Upload CV'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {d.file && (
          <p className="text-sm text-muted">
            {d.file.name} · {fileSize(d.file.size)}
          </p>
        )}
        <div>
          <label className="label">Label *</label>
          <input className="input" required autoFocus value={d.label} onChange={(e) => setD({ ...d, label: e.target.value })} />
          <p className="mt-1 text-xs text-muted">How you tell this version apart, e.g. "Backend, Oct 2026" or "Data analyst".</p>
        </div>
        <div>
          <label className="label">Notes</label>
          <textarea className="input min-h-[70px]" value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} placeholder="What changed in this version" />
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={saving}>
            {saving ? 'Saving…' : d.id ? 'Save changes' : 'Upload CV'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
