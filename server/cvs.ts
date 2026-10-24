// CVs: every version keeps its original file name (often the same one), so each gets its own label.

export const MAX_CV_BYTES = 10_000_000;

const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/** A picked file as a data: URL → its bytes and type, or an error message. The type comes from the extension when the browser gives none. */
export function parseCvFile(dataUrl: unknown, fileName: unknown): { data: Buffer; mime: string; file_name: string } | string {
  const name = String(fileName ?? '').trim().replace(/^.*[\\/]/, '');
  const m = /^data:([\w.+-]+\/[\w.+-]+)?;base64,(.*)$/s.exec(String(dataUrl ?? ''));
  if (!m || !name) return 'Pick a CV file.';
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1].toLowerCase() ?? '';
  const mime = MIME_BY_EXT[ext];
  if (!mime) return 'Pick a PDF or Word file.';
  const data = Buffer.from(m[2], 'base64');
  if (!data.length) return 'That file is empty.';
  if (data.length > MAX_CV_BYTES) return 'The file is over 10 MB.';
  return { data, mime, file_name: name };
}

/** "CV 24/10/2026", or "CV 24/10/2026 (2)" when that label is taken. `day` is YYYY-MM-DD. */
export function defaultCvLabel(day: string, taken: string[]): string {
  const base = `CV ${day.split('-').reverse().join('/')}`;
  const used = new Set(taken.map((t) => t.toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  let n = 2;
  while (used.has(`${base} (${n})`.toLowerCase())) n++;
  return `${base} (${n})`;
}

/** Content-Disposition that keeps the original name, including non-ASCII ones. */
export function contentDisposition(kind: 'inline' | 'attachment', fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
