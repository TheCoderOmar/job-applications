// Shared by the popup and the right-click menu.

const DEFAULT_APP = 'http://localhost:5173';

/** Where the Job Tracker runs (changeable in the popup). */
async function appAddress() {
  const { app } = await chrome.storage.sync.get('app');
  return (app || DEFAULT_APP).replace(/\/+$/, '');
}

/** What kind of page this is; the app can read the first three by itself. */
function pageKind(url) {
  if (/linkedin\.com\/(?:.*\/)?jobs\/view\/|linkedin\.com\/.*[?&]currentJobId=\d/i.test(url)) return 'LinkedIn job';
  if (/linkedin\.com\/(posts\/|feed\/update\/urn:li:(activity|share|ugcPost):)/i.test(url)) return 'LinkedIn post';
  if (/apply\.workable\.com\/(?:[a-z0-9-]+\/)?j\/[A-Z0-9]{6,}/i.test(url)) return 'Workable job';
  return null;
}

/** "GL Accountant | Sumerge | LinkedIn" → "GL Accountant". */
function cleanTitle(title) {
  return String(title || '').split(/\s+[|–—]\s+|\s+-\s+/)[0].trim();
}

/**
 * Opens a small window with the Job Tracker's "Log application" form, filled from this page,
 * at the right edge of the browser window so the job stays visible beside it.
 */
async function sendToTracker(url, title) {
  const base = await appAddress();
  const q = new URLSearchParams({ import: url });
  const t = cleanTitle(title);
  if (t) q.set('title', t);
  const width = 560;
  const height = 820;
  let left;
  let top;
  try {
    const win = await chrome.windows.getLastFocused();
    left = Math.max(0, (win.left ?? 0) + (win.width ?? width) - width - 16);
    top = Math.max(0, (win.top ?? 0) + 60);
  } catch {
    /* let the browser place it */
  }
  await chrome.windows.create({ url: `${base}/quick?${q}`, type: 'popup', width, height, left, top, focused: true });
}
