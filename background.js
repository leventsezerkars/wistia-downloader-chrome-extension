const TAB_DATA_KEY = 'tabUrls';

async function getTabMap() {
  const result = await chrome.storage.local.get(TAB_DATA_KEY);
  return result[TAB_DATA_KEY] || {};
}

async function saveTabMap(map) {
  await chrome.storage.local.set({ [TAB_DATA_KEY]: map });
}

function normalizeCandidate(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return null;
  }

  const cleaned = rawUrl.trim();
  if (!cleaned) {
    return null;
  }

  try {
    const url = new URL(cleaned);
    const href = url.href;
    const lowerHref = href.toLowerCase();

    const looksLikeWistia = lowerHref.includes('wistia') || lowerHref.includes('wi.st');
    const looksLikeM3u8 = lowerHref.includes('.m3u8') || lowerHref.includes('m3u8');

    if (looksLikeWistia && looksLikeM3u8) {
      return href;
    }
    return null;
  } catch (error) {
    return null;
  }
}

async function addUrlToTab(tabId, rawUrl) {
  if (typeof tabId !== 'number' || tabId < 0) {
    return;
  }

  const normalized = normalizeCandidate(rawUrl);
  if (!normalized) {
    return;
  }

  const map = await getTabMap();
  const existing = new Set(map[tabId] || []);
  existing.add(normalized);
  map[tabId] = [...existing];
  await saveTabMap(map);
}

chrome.webRequest.onCompleted.addListener(
  (details) => {
    addUrlToTab(details.tabId, details.url);
  },
  { urls: ['<all_urls>'] }
);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) {
    return;
  }

  if (message.type === 'REPORT_FOUND_URLS') {
    const tabId = sender?.tab?.id;
    const urls = Array.isArray(message.urls) ? message.urls : [];
    Promise.all(urls.map((url) => addUrlToTab(tabId, url))).then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message.type === 'GET_URLS') {
    const tabId = message.tabId;
    getTabMap().then((map) => {
      sendResponse({ urls: map[tabId] || [] });
    });
    return true;
  }

  if (message.type === 'CLEAR_URLS') {
    const tabId = message.tabId;
    getTabMap().then(async (map) => {
      delete map[tabId];
      await saveTabMap(map);
      sendResponse({ ok: true });
    });
    return true;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  getTabMap().then(async (map) => {
    if (map[tabId]) {
      delete map[tabId];
      await saveTabMap(map);
    }
  });
});
