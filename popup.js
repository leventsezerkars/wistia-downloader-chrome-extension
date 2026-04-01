const urlListEl = document.getElementById('urlList');
const statusEl = document.getElementById('status');
const refreshBtn = document.getElementById('refreshBtn');
const clearBtn = document.getElementById('clearBtn');
const searchInput = document.getElementById('searchInput');
const countBadge = document.getElementById('countBadge');

let allEntries = [];

function pickMetaString(v) {
  if (v == null || v === '') {
    return '';
  }
  if (typeof v === 'string') {
    return v.trim();
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    return String(v);
  }
  if (typeof v === 'boolean') {
    return v ? 'evet' : 'hayır';
  }
  return '';
}

function truncateMetaText(s, max) {
  const t = String(s || '').trim();
  if (t.length <= max) {
    return t;
  }
  return `${t.slice(0, Math.max(0, max - 1))}…`;
}

/** Meta.duration: çoğunlukla saniye; ~100 saat üstü değerler çoğunlukla ms. */
function formatMetaDuration(raw) {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
    return null;
  }
  let sec = raw;
  if (raw > 3600 * 24 * 30) {
    return null;
  }
  if (raw > 3600 * 100) {
    sec = raw / 1000;
  }
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

const META_LINE_PRIORITY_KEYS = [
  'hashedId',
  'hashed_id',
  'deliveryId',
  'pathId',
  'file',
  'id',
  'customId',
  'custom_id',
  'slug',
  'media_id',
  'mediaId',
  'name',
  'displayName',
  'mediaName',
  'title',
  'headline',
  'duration',
  'width',
  'height',
  'aspectRatio',
  'quality',
  'bitrate',
  'type',
  'projectId',
  'host'
];

/**
 * Gömülü JSON / URL türetimi meta’dan birkaç alan; URL satırının hemen altında küçük tek satır.
 */
function buildEntryMetaSmall(entry) {
  const meta = getEntryDisplayMeta(entry);
  if (!Object.keys(meta).length) {
    return null;
  }

  const entryTitle = String(entry.title || '').trim();
  const parts = [];
  const usedKeys = new Set();

  const tryPushDuration = () => {
    const d = meta.duration;
    if (d == null || d === '') {
      return;
    }
    const formatted = formatMetaDuration(typeof d === 'number' ? d : Number(d));
    if (formatted) {
      parts.push(formatted);
      usedKeys.add('duration');
      return;
    }
    const s = pickMetaString(d);
    if (s) {
      parts.push(truncateMetaText(s, 28));
      usedKeys.add('duration');
    }
  };

  const tryPushWh = () => {
    if (usedKeys.has('__wh')) {
      return;
    }
    if (
      typeof meta.width === 'number' &&
      typeof meta.height === 'number' &&
      meta.width > 0 &&
      meta.height > 0
    ) {
      parts.push(`${meta.width}×${meta.height}`);
      usedKeys.add('__wh');
      usedKeys.add('width');
      usedKeys.add('height');
    }
  };

  for (const k of META_LINE_PRIORITY_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(meta, k)) {
      continue;
    }
    if (usedKeys.has(k)) {
      continue;
    }
    const v = meta[k];
    if (v === undefined || v === null || v === '') {
      continue;
    }
    if (k === 'duration') {
      tryPushDuration();
      continue;
    }
    if (k === 'width' || k === 'height') {
      tryPushWh();
      continue;
    }
    const s = pickMetaString(v);
    if (!s) {
      continue;
    }
    if ((k === 'name' || k === 'title' || k === 'headline') && s === entryTitle) {
      continue;
    }
    let chunk = truncateMetaText(s, k === 'deliveryId' || k === 'projectId' ? 36 : 44);
    if (k === 'id' || k === 'customId' || k === 'custom_id') {
      chunk = `${k}: ${truncateMetaText(s, 28)}`;
    }
    parts.push(chunk);
    usedKeys.add(k);
    if (parts.length >= 5) {
      break;
    }
  }

  tryPushWh();

  if (parts.length < 5 && !usedKeys.has('duration')) {
    tryPushDuration();
  }

  if (parts.length < 5) {
    for (const k of Object.keys(meta)) {
      if (parts.length >= 5) {
        break;
      }
      if (usedKeys.has(k)) {
        continue;
      }
      const v = meta[k];
      if (v === undefined || v === null || v === '') {
        continue;
      }
      if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') {
        continue;
      }
      const s = truncateMetaText(String(v), 32);
      parts.push(`${k}: ${s}`);
      usedKeys.add(k);
    }
  }

  if (!parts.length) {
    return null;
  }

  const line = document.createElement('small');
  line.className = 'entry-meta-small';
  line.textContent = parts.slice(0, 5).join(' · ');
  return line;
}

async function getActiveTabId() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.id;
}

function normalizeEntries(rawUrls) {
  if (!Array.isArray(rawUrls)) {
    return [];
  }

  return rawUrls
    .map((item) => {
      if (typeof item === 'string') {
        return { url: item, title: '', meta: {} };
      }

      if (item && typeof item === 'object') {
        const meta =
          item.meta && typeof item.meta === 'object' && !Array.isArray(item.meta)
            ? { ...item.meta }
            : {};
        return {
          url: String(item.url || '').trim(),
          title: String(item.title || '').trim(),
          meta
        };
      }

      return null;
    })
    .filter((item) => item && item.url);
}

function metaSearchText(meta) {
  if (!meta || typeof meta !== 'object') {
    return '';
  }
  try {
    return JSON.stringify(meta).toLowerCase();
  } catch (e) {
    return '';
  }
}

function getEntryDisplayMeta(entry) {
  const stored =
    entry.meta && typeof entry.meta === 'object' && !Array.isArray(entry.meta) ? { ...entry.meta } : {};
  const inferred =
    entry.url && typeof globalThis.inferWistiaM3U8Meta === 'function'
      ? globalThis.inferWistiaM3U8Meta(entry.url)
      : {};
  return { ...inferred, ...stored };
}

/**
 * Popup’ta fast.wistia embed için .json (kısıt yoksa); aktif sekme Referer.
 * Dönen meta storage’a PATCH edilir.
 */
async function enrichPopupFastWistiaEmbedJson(entries, tabId) {
  if (
    !Array.isArray(entries) ||
    !entries.length ||
    typeof globalThis.buildFastWistiaEmbedJsonUrl !== 'function' ||
    typeof globalThis.parseWistiaEmbedJsonResponse !== 'function' ||
    typeof globalThis.wistiaEmbedJsonToMeta !== 'function'
  ) {
    return entries;
  }

  let referer = 'https://fast.wistia.com/';
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url && /^https?:/i.test(tab.url)) {
      referer = tab.url;
    }
  } catch (e) {
    // ignore
  }

  const patchPromises = entries.map(async (entry) => {
    const url = entry.url;
    if (
      !url ||
      (typeof globalThis.isFastWistiaEmbedM3u8Url === 'function'
        ? !globalThis.isFastWistiaEmbedM3u8Url(url)
        : !/\/\/fast\.wistia\.com\/embed\/medias\/.+\.m3u8/i.test(url))
    ) {
      return null;
    }

    const cur = entry.meta && typeof entry.meta === 'object' ? entry.meta : {};
    const hasDuration = typeof cur.duration === 'number' && Number.isFinite(cur.duration);
    if (cur.name && hasDuration) {
      return null;
    }

    const hid =
      cur.hashedId ||
      (typeof globalThis.extractFastWistiaEmbedHashedId === 'function'
        ? globalThis.extractFastWistiaEmbedHashedId(url)
        : '');
    if (!hid) {
      return null;
    }

    const jsonUrl = globalThis.buildFastWistiaEmbedJsonUrl(hid);
    if (!jsonUrl) {
      return null;
    }

    try {
      const res = await fetch(jsonUrl, {
        credentials: 'omit',
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          Referer: referer
        }
      });
      if (!res.ok) {
        return null;
      }
      const data = globalThis.parseWistiaEmbedJsonResponse(await res.text());
      if (!data) {
        return null;
      }
      const extra = globalThis.wistiaEmbedJsonToMeta(data);
      if (!Object.keys(extra).length) {
        return null;
      }
      entry.meta = { ...(entry.meta || {}), ...extra };
      if (extra.name && !String(entry.title || '').trim()) {
        entry.title = String(extra.name).trim();
      }
      return { url: entry.url, meta: extra };
    } catch (e) {
      return null;
    }
  });

  const patches = (await Promise.all(patchPromises)).filter(Boolean);
  if (patches.length) {
    try {
      await chrome.runtime.sendMessage({ type: 'PATCH_ENTRY_METAS', tabId, patches });
    } catch (e) {
      // ignore
    }
  }

  return entries;
}

function formatUrlCompact(url, maxLen = 78) {
  if (!url) {
    return '';
  }
  if (url.length <= maxLen) {
    return url;
  }
  try {
    const u = new URL(url);
    const host = u.host;
    const rest = (u.pathname || '') + (u.search || '') + (u.hash || '');
    const budget = maxLen - host.length - 3;
    if (budget < 12) {
      return url.slice(0, maxLen - 1) + '…';
    }
    const tail = rest.length <= budget ? rest : '…' + rest.slice(-(budget - 1));
    return `${host}${tail}`;
  } catch (e) {
    return url.slice(0, maxLen - 1) + '…';
  }
}

function filterEntries() {
  const query = searchInput.value.trim().toLowerCase();
  if (!query) {
    return allEntries;
  }

  return allEntries.filter((entry) => {
    const inUrl = entry.url.toLowerCase().includes(query);
    const inTitle = entry.title.toLowerCase().includes(query);
    const inMeta = metaSearchText(getEntryDisplayMeta(entry)).includes(query);
    return inUrl || inTitle || inMeta;
  });
}

function updateCountBadge(count) {
  countBadge.textContent = `${count} URL`;
}

function createEmptyRow(text) {
  const row = document.createElement('li');
  row.className = 'empty-state';
  row.textContent = text;
  return row;
}

function safeDownloadBasename(title, url) {
  const raw = String(title || '').trim();
  let base = raw.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim();
  if (base.length > 96) {
    base = base.slice(0, 96).trim();
  }
  if (base) {
    return base;
  }
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop() || 'playlist';
    const stem = last.replace(/\.m3u8$/i, '').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 64);
    return stem || 'wistia-playlist';
  } catch (e) {
    return 'wistia-playlist';
  }
}

/** PowerShell / bash: tek tırnaklı URL; cmd.exe kullanıyorsanız `yt-dlp "URL"` yeterlidir. */
function buildYtDlpCommand(url) {
  const safe = url.replace(/'/g, "''");
  return `yt-dlp -o 'wistia-%(title)s.%(ext)s' '${safe}'`;
}

function flashButton(button, label, durationMs = 900) {
  const original = button.textContent;
  button.textContent = label;
  button.disabled = true;
  setTimeout(() => {
    button.textContent = original;
    button.disabled = false;
  }, durationMs);
}

async function buildMergeFetchInit() {
  const headers = {};
  const tabId = await getActiveTabId();
  if (tabId) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.url && /^https?:/i.test(tab.url)) {
        headers.Referer = tab.url;
      }
    } catch (e) {
      // ignore
    }
  }
  return { credentials: 'omit', headers };
}

function triggerBlobDownload(blob, filename) {
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objectUrl);
}

async function copyToClipboard(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    const original = button.textContent;
    button.textContent = 'Kopyalandı';
    button.disabled = true;
    setTimeout(() => {
      button.textContent = original;
      button.disabled = false;
    }, 900);
  } catch (error) {
    statusEl.textContent = 'Kopyalama başarısız oldu. URL\'yi manuel kopyalayın.';
  }
}

function renderEntries(entries, totalCount = entries.length) {
  urlListEl.innerHTML = '';
  updateCountBadge(totalCount);

  if (!totalCount) {
    statusEl.textContent = 'Wistia m3u8 URL bulunamadı.';
    urlListEl.appendChild(createEmptyRow('Henüz bağlantı bulunamadı. Sayfayı yenileyip tekrar deneyin.'));
    return;
  }

  if (!entries.length) {
    statusEl.textContent = 'Arama kriterine uygun sonuç bulunamadı.';
    urlListEl.appendChild(createEmptyRow('Filtreye uyan kayıt yok. Aramayı temizleyin.'));
    return;
  }

  statusEl.textContent = `${entries.length} sonuç gösteriliyor.`;

  entries.forEach((entry) => {
    const item = document.createElement('li');
    item.className = 'entry-compact';

    const row = document.createElement('div');
    row.className = 'url-row';

    const link = document.createElement('a');
    link.href = entry.url;
    link.textContent = formatUrlCompact(entry.url);
    link.title = entry.url;
    link.target = '_blank';
    link.rel = 'noreferrer noopener';

    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.textContent = 'Kopyala';
    copyButton.className = 'copy-btn';
    copyButton.addEventListener('click', () => {
      copyToClipboard(entry.url, copyButton);
    });

    row.appendChild(link);
    row.appendChild(copyButton);
    item.appendChild(row);

    const metaSmall = buildEntryMetaSmall(entry);
    if (metaSmall) {
      item.appendChild(metaSmall);
    }

    const actions = document.createElement('div');
    actions.className = 'url-actions';

    const downloadBtn = document.createElement('button');
    downloadBtn.type = 'button';
    downloadBtn.textContent = 'İndir (.m3u8)';
    downloadBtn.className = 'action-btn download-btn';
    downloadBtn.title = 'Oynatma listesi dosyasını varsayılan İndirilenler klasörüne kaydeder.';
    downloadBtn.addEventListener('click', async () => {
      const base = safeDownloadBasename(entry.title, entry.url);
      try {
        const res = await chrome.runtime.sendMessage({
          type: 'DOWNLOAD_M3U8',
          url: entry.url,
          filename: `WistiaM3U8/${base}.m3u8`
        });
        if (!res?.ok) {
          statusEl.textContent =
            res?.error ||
            'İndirme başlamadı (erişim engeli olabilir). yt-dlp komutunu kullanın.';
          return;
        }
        flashButton(downloadBtn, 'İndiriliyor…', 1200);
      } catch (err) {
        statusEl.textContent =
          'İndirme başlamadı. Eklentiyi yeniden yükleyip tekrar deneyin veya yt-dlp kullanın.';
      }
    });

    const ytdlpBtn = document.createElement('button');
    ytdlpBtn.type = 'button';
    ytdlpBtn.textContent = 'yt-dlp kopyala';
    ytdlpBtn.className = 'action-btn';
    ytdlpBtn.title = 'Tam video için terminalde çalıştırın: pip install yt-dlp';
    ytdlpBtn.addEventListener('click', () => {
      copyToClipboard(buildYtDlpCommand(entry.url), ytdlpBtn);
    });

    const mergeBtn = document.createElement('button');
    mergeBtn.type = 'button';
    mergeBtn.textContent = 'Birleşik (MP4)';
    mergeBtn.className = 'action-btn merge-btn';
    mergeBtn.title =
      'Şifresiz MPEG-TS HLS: parçaları paralel indirir, mux.js ile remux. Ses hâlâ bozuksa yt-dlp FFmpeg ile daha güvenilir birleştirir.';
    mergeBtn.addEventListener('click', async () => {
      if (typeof mergeM3U8PlaylistToMp4Blob !== 'function') {
        statusEl.textContent = 'Birleştirme modülü yüklenemedi; eklentiyi yeniden yükleyin.';
        return;
      }
      if (typeof muxjs === 'undefined' || !muxjs.mp4) {
        statusEl.textContent = 'mux.js yüklenemedi (vendor/mux.min.js eksik olabilir).';
        return;
      }
      mergeBtn.disabled = true;
      downloadBtn.disabled = true;
      ytdlpBtn.disabled = true;
      const base = safeDownloadBasename(entry.title, entry.url);
      try {
        const fetchInit = await buildMergeFetchInit();
        statusEl.textContent = 'Liste ve parçalar alınıyor (paralel indirme)…';
        const blob = await mergeM3U8PlaylistToMp4Blob(entry.url, fetchInit, {
          onProgress: (done, total) => {
            statusEl.textContent = `Parçalar: ${done} / ${total} (paralel + remux)`;
          }
        });
        triggerBlobDownload(blob, `${base}.mp4`);
        statusEl.textContent = 'MP4 dosyası kaydedildi.';
      } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        statusEl.textContent = `Birleştirme: ${msg}`;
      } finally {
        mergeBtn.disabled = false;
        downloadBtn.disabled = false;
        ytdlpBtn.disabled = false;
      }
    });

    actions.appendChild(downloadBtn);
    actions.appendChild(mergeBtn);
    actions.appendChild(ytdlpBtn);
    item.appendChild(actions);

    if (entry.title) {
      const title = document.createElement('small');
      title.className = 'url-title';
      title.textContent = entry.title;
      item.appendChild(title);
    }

    urlListEl.appendChild(item);
  });
}

function applyFilterAndRender() {
  const filtered = filterEntries();
  renderEntries(filtered, allEntries.length);
}

async function loadUrls() {
  const tabId = await getActiveTabId();
  if (!tabId) {
    statusEl.textContent = 'Aktif sekme bulunamadı.';
    allEntries = [];
    renderEntries([]);
    return;
  }

  const result = await chrome.runtime.sendMessage({ type: 'GET_URLS', tabId });
  let list = normalizeEntries(result?.urls);
  if (list.length) {
    statusEl.textContent = 'Wistia embed bilgisi alınıyor…';
  }
  list = await enrichPopupFastWistiaEmbedJson(list, tabId);
  allEntries = list;
  applyFilterAndRender();
}

async function pollUrlsUntilFound(tabId, { maxTries = 18, intervalMs = 125 } = {}) {
  for (let i = 0; i < maxTries; i++) {
    const result = await chrome.runtime.sendMessage({ type: 'GET_URLS', tabId });
    const list = normalizeEntries(result?.urls);
    if (list.length > 0) {
      return true;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

function isInjectableUrl(tabUrl) {
  if (!tabUrl) {
    return false;
  }
  try {
    const u = new URL(tabUrl);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

async function rescanActiveTabAndReload() {
  const tabId = await getActiveTabId();
  if (!tabId) {
    statusEl.textContent = 'Aktif sekme bulunamadı.';
    allEntries = [];
    renderEntries([]);
    return;
  }

  refreshBtn.disabled = true;
  statusEl.textContent = 'Sayfa yeniden taranıyor...';

  let injectFailed = false;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!isInjectableUrl(tab.url)) {
      statusEl.textContent = 'Bu sekmede tarama yapılamaz (sadece http/https).';
    } else {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ['content.js']
      });
      await pollUrlsUntilFound(tabId);
    }
  } catch (error) {
    injectFailed = true;
    statusEl.textContent =
      'Tarama tetiklenemedi. Sayfayı tam yenileyin veya izinleri kontrol edin.';
  }

  await loadUrls();
  if (injectFailed) {
    statusEl.textContent =
      'Tarama tetiklenemedi. Sayfayı tam yenileyin veya izinleri kontrol edin.';
  }
  refreshBtn.disabled = false;
}

refreshBtn.addEventListener('click', () => {
  rescanActiveTabAndReload();
});

clearBtn.addEventListener('click', async () => {
  const tabId = await getActiveTabId();
  if (!tabId) {
    statusEl.textContent = 'Aktif sekme bulunamadı.';
    return;
  }

  await chrome.runtime.sendMessage({ type: 'CLEAR_URLS', tabId });
  allEntries = [];
  searchInput.value = '';
  renderEntries([]);
});

searchInput.addEventListener('input', () => {
  applyFilterAndRender();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes.tabUrls) {
    return;
  }
  loadUrls();
});

loadUrls();
