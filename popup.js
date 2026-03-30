const urlListEl = document.getElementById('urlList');
const statusEl = document.getElementById('status');
const refreshBtn = document.getElementById('refreshBtn');
const clearBtn = document.getElementById('clearBtn');

async function getActiveTabId() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.id;
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

function renderUrls(urls) {
  urlListEl.innerHTML = '';

  if (!urls.length) {
    statusEl.textContent = 'Wistia m3u8 URL bulunamadı.';
    return;
  }

  statusEl.textContent = `${urls.length} adet URL bulundu.`;

  urls.forEach((url) => {
    const item = document.createElement('li');
    const row = document.createElement('div');
    row.className = 'url-row';

    const link = document.createElement('a');
    link.href = url;
    link.textContent = url;
    link.target = '_blank';
    link.rel = 'noreferrer noopener';

    const copyButton = document.createElement('button');
    copyButton.textContent = 'Kopyala';
    copyButton.className = 'copy-btn';
    copyButton.addEventListener('click', () => {
      copyToClipboard(url, copyButton);
    });

    row.appendChild(link);
    row.appendChild(copyButton);
    item.appendChild(row);
    urlListEl.appendChild(item);
  });
}

async function loadUrls() {
  const tabId = await getActiveTabId();
  if (!tabId) {
    statusEl.textContent = 'Aktif sekme bulunamadı.';
    return;
  }

  const result = await chrome.runtime.sendMessage({ type: 'GET_URLS', tabId });
  const urls = Array.isArray(result?.urls) ? result.urls : [];
  renderUrls(urls);
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
  renderUrls([]);
});

loadUrls();
