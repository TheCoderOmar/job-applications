(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url || '';
  const kind = pageKind(url);

  document.getElementById('kind').textContent = kind || 'Any page';
  document.getElementById('title').textContent = cleanTitle(tab?.title) || url;
  document.getElementById('hint').textContent = kind
    ? 'Opens "Log application" with the title, company and description filled in.'
    : "This site can't be read automatically: the link and page title are filled in, add the rest yourself.";
  if (!kind) document.getElementById('import').textContent = 'Log this page';

  document.getElementById('import').addEventListener('click', async () => {
    await sendToTracker(url, tab?.title);
    window.close();
  });

  // App address, saved for next time.
  const input = document.getElementById('app');
  input.value = await appAddress();
  input.addEventListener('change', async () => {
    await chrome.storage.sync.set({ app: input.value.trim() });
    checkApp();
  });

  // Green dot when the Job Tracker answers, red when it isn't running.
  async function checkApp() {
    const dot = document.getElementById('status');
    try {
      const res = await fetch(`${await appAddress()}/api/stages`, { signal: AbortSignal.timeout(2500) });
      dot.className = `status ${res.ok ? 'up' : 'down'}`;
      dot.title = res.ok ? 'Job Tracker is running' : 'Job Tracker answered with an error';
    } catch {
      dot.className = 'status down';
      dot.title = 'Job Tracker is not running: start it with npm run dev';
    }
  }
  checkApp();
})();
