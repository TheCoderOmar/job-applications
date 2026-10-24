import { api } from '../api';
import type { Cv } from '../types';
import Icon from './Icon';
import Modal from './Modal';
import { dmy } from '../dates';

/** "312 KB", "1.4 MB" */
export const fileSize = (bytes: number) => (bytes < 1_000_000 ? `${Math.max(1, Math.round(bytes / 1000))} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`);

/** The CV in a large popup: PDFs show in place, Word files can only be downloaded. */
export default function CvPreview({ cv, onClose }: { cv: Pick<Cv, 'id' | 'label' | 'file_name' | 'mime' | 'size' | 'created_at'>; onClose: () => void }) {
  const isPdf = cv.mime === 'application/pdf';
  return (
    <Modal title={cv.label} wide="xl" onClose={onClose}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-sm">
        <span className="text-muted">
          {cv.file_name} · {fileSize(cv.size)} · added {dmy(cv.created_at)}
        </span>
        <div className="flex gap-2">
          {isPdf && (
            <a className="btn-ghost" href={api.cvFileUrl(cv.id)} target="_blank" rel="noreferrer">
              <Icon name="external" /> Open in new tab
            </a>
          )}
          <a className="btn-ghost" href={api.cvFileUrl(cv.id, true)}>
            <Icon name="download" /> Download
          </a>
        </div>
      </div>
      {isPdf ? (
        <iframe title={cv.label} src={api.cvFileUrl(cv.id)} className="h-[78vh] w-full rounded-lg border border-line bg-white" />
      ) : (
        <div className="rounded-lg border border-line p-10 text-center text-sm text-muted">
          Word files can't be shown in the browser. Download it to open it.
        </div>
      )}
    </Modal>
  );
}
