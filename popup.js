const urlListEl = document.getElementById('urlList');
const statusEl = document.getElementById('status');
const refreshBtn = document.getElementById('refreshBtn');
const clearBtn = document.getElementById('clearBtn');
const searchInput = document.getElementById('searchInput');
const countBadge = document.getElementById('countBadge');

let allEntries = [];

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
        return { url: item, title: '' };
      }

      if (item && typeof item === 'object') {
        return {
          url: String(item.url || '').trim(),
          title: String(item.title || '').trim()
        };
      }

      return null;
    })
    .filter((item) => item && item.url);
}

function filterEntries() {
  const query = searchInput.value.trim().toLowerCase();
  if (!query) {
    return allEntries;
  }

  return allEntries.filter((entry) => {
    return entry.url.toLowerCase().includes(query) || entry.title.toLowerCase().includes(query);
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

    const row = document.createElement('div');
    row.className = 'url-row';

    const link = document.createElement('a');
    link.href = entry.url;
    link.textContent = entry.url;
    link.target = '_blank';
    link.rel = 'noreferrer noopener';

    const copyButton = document.createElement('button');
    copyButton.textContent = 'Kopyala';
    copyButton.className = 'copy-btn';
    copyButton.addEventListener('click', () => {
      copyToClipboard(entry.url, copyButton);
    });

    row.appendChild(link);
    row.appendChild(copyButton);
    item.appendChild(row);

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
  allEntries = normalizeEntries(result?.urls);
  applyFilterAndRender();
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

  try {
    const tab = await chrome.tabs.get(tabId);
    if (!isInjectableUrl(tab.url)) {
      statusEl.textContent = 'Bu sekmede tarama yapılamaz (sadece http/https).';
    } else {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js']
      });
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  } catch (error) {
    statusEl.textContent =
      'Tarama tetiklenemedi. Sayfayı tam yenileyin veya izinleri kontrol edin.';
  } finally {
    await loadUrls();
    refreshBtn.disabled = false;
  }
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
