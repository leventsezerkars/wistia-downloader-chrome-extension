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

    return looksLikeWistia && looksLikeM3u8 ? href : null;
  } catch (error) {
    return null;
  }
}

function normalizeTitle(rawTitle) {
  if (!rawTitle || typeof rawTitle !== 'string') {
    return '';
  }

  return rawTitle.trim();
}

async function addEntryToTab(tabId, rawUrl, rawTitle = '') {
  if (typeof tabId !== 'number' || tabId < 0) {
    return;
  }

  const url = normalizeCandidate(rawUrl);
  if (!url) {
    return;
  }

  const title = normalizeTitle(rawTitle);
  const map = await getTabMap();
  const existing = Array.isArray(map[tabId]) ? map[tabId] : [];

  const index = existing.findIndex((item) => item?.url === url);
  if (index >= 0) {
    if (!existing[index].title && title) {
      existing[index].title = title;
      map[tabId] = existing;
      await saveTabMap(map);
    }
    return;
  }

  existing.push({ url, title });
  map[tabId] = existing;
  await saveTabMap(map);
}

chrome.webRequest.onCompleted.addListener(
  (details) => {
    addEntryToTab(details.tabId, details.url);
  },
  { urls: ['<all_urls>'] }
);

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== 'loading') {
    return;
  }
  if (typeof tabId !== 'number' || tabId < 0) {
    return;
  }

  getTabMap().then(async (map) => {
    if (!map[tabId]) {
      return;
    }
    delete map[tabId];
    await saveTabMap(map);
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) {
    return;
  }

  if (message.type === 'REPORT_FOUND_URLS') {
    const tabId = sender?.tab?.id;
    const entries = Array.isArray(message.entries)
      ? message.entries
      : Array.isArray(message.urls)
        ? message.urls.map((url) => ({ url, title: '' }))
        : [];

    Promise.all(entries.map((entry) => addEntryToTab(tabId, entry?.url, entry?.title || ''))).then(() => {
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
