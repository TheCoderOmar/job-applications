importScripts('shared.js');

// Right-click a job link (or the page itself) → "Import to Job Tracker".
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'import-link', title: 'Import this job to Job Tracker', contexts: ['link'] });
  chrome.contextMenus.create({ id: 'import-page', title: 'Import this page to Job Tracker', contexts: ['page'] });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'import-link' && info.linkUrl) sendToTracker(info.linkUrl, info.selectionText || '', tab, true);
  if (info.menuItemId === 'import-page' && tab?.url) sendToTracker(tab.url, tab.title, tab);
});
