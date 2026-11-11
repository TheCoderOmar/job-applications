// Shared by the popup and the right-click menu.

const DEFAULT_APP = 'http://localhost:5173';

/** Where the Job Tracker runs (changeable in the popup). */
async function appAddress() {
  const { app } = await chrome.storage.sync.get('app');
  return (app || DEFAULT_APP).replace(/\/+$/, '');
}

/** LinkedIn company page, profile or post (same rules as server/linkedinTab.ts); null for anything else, jobs included. */
function linkedInKind(url) {
  if (!/^https?:\/\/([a-z]+\.)?linkedin\.com\//i.test(url)) return null;
  if (/linkedin\.com\/(posts\/|feed\/update\/urn:li:(activity|share|ugcPost):)/i.test(url)) return 'post';
  if (/linkedin\.com\/(company|school|showcase)\/[^/?#]+/i.test(url) && !/[?&]currentJobId=/i.test(url)) return 'company';
  if (/linkedin\.com\/in\/[^/?#]+/i.test(url)) return 'profile';
  return null;
}

/** What kind of page this is. The app reads LinkedIn and apply.workable.com itself; the rest come from the open tab. */
function pageKind(url) {
  if (/linkedin\.com\/(?:.*\/)?jobs\/view\/|linkedin\.com\/.*[?&]currentJobId=\d/i.test(url)) return 'LinkedIn job';
  const li = linkedInKind(url);
  if (li === 'post') return 'LinkedIn post';
  if (li === 'company') return 'LinkedIn company';
  if (li === 'profile') return 'LinkedIn person';
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

/** What the popup button does on each kind of page. */
function actionLabel(kind) {
  if (kind === 'LinkedIn company') return 'Import company';
  if (kind === 'LinkedIn person') return 'Import contact';
  if (kind === 'LinkedIn post') return 'Import job from post';
  return kind ? 'Import job' : 'Log this page';
}

/**
 * Runs inside a LinkedIn tab you're logged in on (must not use anything outside itself):
 * - company: its name and every "Locations" card (country, tags like Primary/Headquarters, address);
 *   when this tab doesn't show them, the company's About page is read from inside the tab instead;
 * - profile: name, headline, current company (and its page), location;
 * - post: who posted it (their page and headline) and the text.
 */
async function grabLinkedIn(kind) {
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim() || null;
  const linesOf = (el) => (el ? String(el.innerText || el.textContent || '').split('\n').map((l) => l.trim()).filter(Boolean) : []);
  const cap = (s) => (s.length > 4000000 ? s.slice(0, 4000000) : s);
  const html = document.documentElement.outerHTML;
  const noQuery = (href) => (href ? href.split('?')[0] : null);

  if (kind === 'company') {
    const cardsIn = (doc) => {
      const heading = [...doc.querySelectorAll('h2, h3')].find((h) => /^locations\b/i.test(clean(h.textContent) || ''));
      const cards = [];
      if (heading) {
        // The section holding the heading; each card has its own country heading (h3/h4/strong).
        const section = heading.closest('section') || heading.parentElement?.parentElement || doc.body;
        const subs = [...section.querySelectorAll('h3, h4, p.t-bold, strong')].filter((h) => h !== heading && !/^locations\b/i.test(clean(h.textContent) || ''));
        for (const h of subs) {
          let card = h;
          while (card.parentElement && card.parentElement !== section && [...card.parentElement.querySelectorAll('h3, h4, p.t-bold, strong')].filter((x) => subs.includes(x)).length === 1)
            card = card.parentElement;
          const lines = linesOf(card);
          if (lines.length > 1 && !cards.some((c) => c.lines.join('|') === lines.join('|'))) cards.push({ lines });
        }
      }
      if (!cards.length) {
        // Public page style: one "Get directions" map link per card.
        const isDir = (a) => /get directions/i.test(a.textContent || '') || /(bing\.com|google\.[a-z.]+)\/maps/i.test(a.href || '');
        for (const a of [...doc.querySelectorAll('a')].filter(isDir)) {
          let card = a;
          while (card.parentElement && card.parentElement !== doc.body && [...card.parentElement.querySelectorAll('a')].filter(isDir).length === 1)
            card = card.parentElement;
          cards.push({ lines: linesOf(card) });
        }
      }
      return cards;
    };
    const cards = cardsIn(document);
    let page = html;
    if (!cards.length) {
      const m = /\/(company|school|showcase)\/([^/?#]+)/i.exec(location.pathname);
      if (m) {
        try {
          const res = await fetch(`${location.origin}/${m[1]}/${m[2]}/about/`, { credentials: 'include' });
          if (res.ok) page = await res.text();
        } catch {
          /* the server reads the public page instead */
        }
      }
    }
    return { url: location.href, html: cap(page), data: { name: clean(document.querySelector('h1')?.textContent), cards } };
  }

  if (kind === 'profile') {
    const top = document.querySelector('main section') || document.body;
    const current = document.querySelector('[aria-label^="Current company"]');
    const fromLabel = current ? clean(current.getAttribute('aria-label').replace(/^Current company:\s*/i, '').replace(/\.\s*Click.*$/i, '')) : null;
    const exp = document.getElementById('experience')?.closest('section');
    const companyLink = top.querySelector('a[href*="/company/"]') || exp?.querySelector('a[href*="/company/"]');
    return {
      url: location.href,
      html: cap(html),
      data: {
        name: clean(top.querySelector('h1')?.textContent),
        headline: clean(top.querySelector('.text-body-medium')?.textContent),
        company: fromLabel || clean(current?.textContent),
        company_url: noQuery(companyLink?.href),
        location: clean(top.querySelector('.text-body-small.inline')?.textContent),
      },
    };
  }

  // A post: the first update on the page is the one the link points to.
  const root = document.querySelector('.feed-shared-update-v2, [data-urn*="activity"], main') || document.body;
  const actor = root.querySelector('.update-components-actor__container, .update-components-actor') || root;
  const actorLink = actor.querySelector('a[href*="/company/"], a[href*="/in/"]');
  const pick = (sel) => clean(actor.querySelector(sel)?.textContent);
  return {
    url: location.href,
    html: cap(html),
    data: {
      author: pick('.update-components-actor__title span[aria-hidden="true"]') || pick('.update-components-actor__title') || pick('.update-components-actor__name'),
      author_url: noQuery(actorLink?.href),
      headline: pick('.update-components-actor__description span[aria-hidden="true"]') || pick('.update-components-actor__description'),
      text: linesOf(root.querySelector('.update-components-text, .feed-shared-update-v2__description, .feed-shared-text')).join('\n') || null,
    },
  };
}

/** Sends what the LinkedIn tab shows to the app; null when it can't (then the app reads the public page). */
async function sendLinkedIn(base, tabId, kind) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func: grabLinkedIn, args: [kind] });
    if (!result) return null;
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
  // A LinkedIn company page, profile or post: read it from this tab (you're logged in there), unless it's a right-clicked link.
  const li = linkedInKind(url);
  const sent =
    li && tab?.id && !link
      ? await sendLinkedIn(base, tab.id, li)
      : // Indeed, Wuzzuf, jobs.workable.com: send the page from the tab (a right-clicked link is read from the tab too).
        boardKind(url) && tab?.id
        ? await sendPage(base, tab.id, link ? url : '')
        : null;
  const q = new URLSearchParams({ import: sent?.url || url });
  if (li === 'company') q.set('kind', 'company');
  if (li === 'profile') q.set('kind', 'contact');
  if (sent) q.set('page', sent.page);
  const t = li === 'company' || li === 'profile' ? '' : cleanTitle(title);
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
