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

function updateCountBadge(count) {
  countBadge.textContent = `${count} URL`;
}

function createEmptyRow(message) {
  const item = document.createElement('li');
  item.className = 'empty-state';
  item.textContent = message;
  return item;
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
    }, 1200);
  } catch (error) {
    statusEl.textContent = 'Kopyalama başarısız oldu.';
  }
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

  statusEl.textContent = `${entries.length}/${totalCount} URL gösteriliyor.`;

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
    copyButton.addEventListener('click', () => copyToClipboard(entry.url, copyButton));

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

refreshBtn.addEventListener('click', () => {
  loadUrls();
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

loadUrls();
