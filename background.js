importScripts('meta-infer.js');

const TAB_DATA_KEY = 'tabUrls';

let storageWriteChain = Promise.resolve();

function runStorageExclusive(fn) {
  const next = storageWriteChain.then(() => fn());
  storageWriteChain = next.catch(() => {});
  return next;
}

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
  const inferred =
    typeof globalThis.inferWistiaM3U8Meta === 'function' ? globalThis.inferWistiaM3U8Meta(url) : {};

  return runStorageExclusive(async () => {
    const map = await getTabMap();
    const existing = Array.isArray(map[tabId]) ? [...map[tabId]] : [];
    const index = existing.findIndex((item) => item?.url === url);

    if (index >= 0) {
      const prev = existing[index];
      const mergedMeta = { ...inferred, ...(prev.meta && typeof prev.meta === 'object' ? prev.meta : {}) };
      let nextTitle = normalizeTitle(prev.title || '');
      if (!nextTitle && title) {
        nextTitle = title;
      }
      const next = { ...prev, title: nextTitle, meta: mergedMeta };
      const metaChanged = JSON.stringify(prev.meta || {}) !== JSON.stringify(mergedMeta);
      const titleChanged = normalizeTitle(prev.title || '') !== nextTitle;
      if (metaChanged || titleChanged) {
        existing[index] = next;
        map[tabId] = existing;
        await saveTabMap(map);
      }
      return;
    }

    existing.push({ url, title, meta: { ...inferred } });
    map[tabId] = existing;
    await saveTabMap(map);
  });
}

async function mergeEntriesForTab(tabId, entries) {
  if (typeof tabId !== 'number' || tabId < 0) {
    return;
  }
  if (!Array.isArray(entries) || !entries.length) {
    return;
  }

  return runStorageExclusive(async () => {
    const map = await getTabMap();
    const existing = Array.isArray(map[tabId]) ? [...map[tabId]] : [];

    for (const entry of entries) {
      const url = normalizeCandidate(entry?.url);
      if (!url) {
        continue;
      }
      const title = normalizeTitle(entry?.title || '');
      const reportedMeta = entry?.meta && typeof entry.meta === 'object' ? entry.meta : {};
      const inferred =
        typeof globalThis.inferWistiaM3U8Meta === 'function' ? globalThis.inferWistiaM3U8Meta(url) : {};
      const index = existing.findIndex((item) => item?.url === url);
      if (index >= 0) {
        const prevTitle = normalizeTitle(existing[index].title || '');
        const next = { ...existing[index] };
        if (!prevTitle && title) {
          next.title = title;
        } else if (title && title.length > prevTitle.length) {
          next.title = title;
        }
        next.meta = { ...inferred, ...(next.meta || {}), ...reportedMeta };
        existing[index] = next;
      } else {
        existing.push({ url, title, meta: { ...inferred, ...reportedMeta } });
      }
    }

    map[tabId] = existing;
    await saveTabMap(map);
  });
}

async function patchEntryMetasForTab(tabId, patches) {
  if (typeof tabId !== 'number' || tabId < 0 || !Array.isArray(patches) || !patches.length) {
    return;
  }

  return runStorageExclusive(async () => {
    const map = await getTabMap();
    const existing = Array.isArray(map[tabId]) ? [...map[tabId]] : [];

    for (const p of patches) {
      const url = normalizeCandidate(p?.url);
      if (!url) {
        continue;
      }
      const patchMeta = p?.meta && typeof p.meta === 'object' ? p.meta : {};
      if (!Object.keys(patchMeta).length) {
        continue;
      }
      const index = existing.findIndex((item) => item?.url === url);
      if (index < 0) {
        continue;
      }
      const next = { ...existing[index] };
      next.meta = { ...(next.meta || {}), ...patchMeta };
      if (!normalizeTitle(next.title || '') && patchMeta.name) {
        next.title = normalizeTitle(String(patchMeta.name));
      }
      existing[index] = next;
    }

    map[tabId] = existing;
    await saveTabMap(map);
  });
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

  runStorageExclusive(async () => {
    const map = await getTabMap();
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

    if (typeof tabId !== 'number' || tabId < 0) {
      sendResponse({ ok: false, reason: 'no-tab' });
      return true;
    }

    mergeEntriesForTab(tabId, entries).then(() => sendResponse({ ok: true }));

    return true;
  }

  if (message.type === 'GET_URLS') {
    const tabId = message.tabId;
    getTabMap().then((map) => {
      sendResponse({ urls: map[tabId] || [] });
    });
    return true;
  }

  if (message.type === 'PATCH_ENTRY_METAS') {
    const tabId = message.tabId;
    const patches = Array.isArray(message.patches) ? message.patches : [];
    patchEntryMetasForTab(tabId, patches).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === 'CLEAR_URLS') {
    const tabId = message.tabId;
    runStorageExclusive(async () => {
      const map = await getTabMap();
      delete map[tabId];
      await saveTabMap(map);
    }).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === 'DOWNLOAD_M3U8') {
    const url = typeof message.url === 'string' ? message.url.trim() : '';
    const filename =
      typeof message.filename === 'string' && message.filename.trim()
        ? message.filename.trim()
        : 'WistiaM3U8/playlist.m3u8';

    if (!url || !url.startsWith('http')) {
      sendResponse({ ok: false, error: 'Geçersiz indirme adresi.' });
      return true;
    }

    if (!chrome.downloads || typeof chrome.downloads.download !== 'function') {
      sendResponse({ ok: false, error: 'İndirmeler API kullanılamıyor; manifest yeniden yükleyin.' });
      return true;
    }

    chrome.downloads.download(
      {
        url,
        filename,
        conflictAction: 'uniquify',
        saveAs: false
      },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          sendResponse({
            ok: false,
            error: chrome.runtime.lastError.message || 'İndirme reddedildi.'
          });
          return;
        }
        sendResponse({ ok: true, downloadId: downloadId ?? -1 });
      }
    );
    return true;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  runStorageExclusive(async () => {
    const map = await getTabMap();
    if (map[tabId]) {
      delete map[tabId];
      await saveTabMap(map);
    }
  });
});
