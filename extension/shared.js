// Shared by the popup and the right-click menu.

const DEFAULT_APP = 'http://localhost:5173';

/** Where the Job Tracker runs (changeable in the popup). */
async function appAddress() {
  const { app } = await chrome.storage.sync.get('app');
  return (app || DEFAULT_APP).replace(/\/+$/, '');
}

/** What kind of page this is. The app reads LinkedIn and apply.workable.com itself; the rest come from the open tab. */
function pageKind(url) {
  if (/linkedin\.com\/(?:.*\/)?jobs\/view\/|linkedin\.com\/.*[?&]currentJobId=\d/i.test(url)) return 'LinkedIn job';
  if (/linkedin\.com\/(posts\/|feed\/update\/urn:li:(activity|share|ugcPost):)/i.test(url)) return 'LinkedIn post';
  if (/apply\.workable\.com\/(?:[a-z0-9-]+\/)?j\/[A-Z0-9]{6,}/i.test(url)) return 'Workable job';
  return boardKind(url);
}

/** Job boards whose page is sent from the tab (Indeed and Wuzzuf block the app); same rules as server/jobpages.ts. */
function boardKind(url) {
  if (/^https?:\/\/(?:[a-z]+\.)?indeed\.com\//i.test(url) && /[?&]v?jk=[0-9a-f]{8,}/i.test(url)) return 'Indeed job';
  if (/^https?:\/\/(?:www\.)?wuzzuf\.net\/jobs\/p\//i.test(url)) return 'Wuzzuf job';
  if (/^https?:\/\/jobs\.workable\.com\/view\//i.test(url)) return 'Workable job';
  return null;
}

/**
 * Runs inside the tab: the job page's HTML as the browser sees it (past Indeed's and Wuzzuf's bot checks).
 * `target` is a right-clicked link, or empty for the page itself. Indeed's search page only shows a side panel,
 * so the job's own page (same site, same login) is fetched instead; the panel is the fallback.
 */
async function grabJobPage(target) {
  const hasJob = (html) => /"@type"\s*:\s*"JobPosting"/.test(html);
  const here = location.href;
  const onPage = !target || target === here;
  let url = target || here;
  const jk = /[?&]v?jk=([0-9a-f]{8,})/i.exec(url)?.[1];
  if (/(^|\.)indeed\.com$/i.test(location.hostname) && jk) url = `${location.origin}/viewjob?jk=${jk}`;
  if (onPage) {
    const html = document.documentElement.outerHTML;
    if (hasJob(html) || url === here) return { url: here, html };
  }
  if (new URL(url, here).origin === location.origin) {
    try {
      const res = await fetch(url, { credentials: 'include' });
      const html = await res.text();
      if (res.ok && hasJob(html)) return { url, html };
    } catch {
      /* fall back below */
    }
  }
  return onPage ? { url: here, html: document.documentElement.outerHTML } : null;
}

/** Sends the job page from the tab to the app; null when it can't (then only the link is imported). */
async function sendPage(base, tabId, target) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func: grabJobPage, args: [target || ''] });
    if (!result?.html) return null;
    const res = await fetch(`${base}/api/import/page`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** "GL Accountant | Sumerge | LinkedIn" → "GL Accountant". */
function cleanTitle(title) {
  return String(title || '').split(/\s+[|–—]\s+|\s+-\s+/)[0].trim();
}

/**
 * `tab` is the tab the click came from, `link` true when `url` is a right-clicked link in it.
 * Opens a small window with the Job Tracker's "Log application" form, filled from this page,
 * at the right edge of the browser window so the job stays visible beside it.
 */
async function sendToTracker(url, title, tab, link) {
  const base = await appAddress();
  // Indeed, Wuzzuf, jobs.workable.com: send the page from the tab (a right-clicked link is read from the tab too).
  const sent = boardKind(url) && tab?.id ? await sendPage(base, tab.id, link ? url : '') : null;
  const q = new URLSearchParams({ import: sent?.url || url });
  if (sent) q.set('page', sent.page);
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
