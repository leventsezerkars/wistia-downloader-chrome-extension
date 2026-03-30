function extractUrlsFromText(text) {
  if (!text) {
    return [];
  }

  const regex = /https?:\/\/[^\s"'<>]+/g;
  const candidates = text.match(regex) || [];

  return candidates.filter((candidate) => {
    const lower = candidate.toLowerCase();
    return (lower.includes('wistia') || lower.includes('wi.st')) && lower.includes('m3u8');
  });
}

function getDocumentTitleFallback() {
  const ogTitle = document.querySelector('meta[property="og:title"]')?.content;
  const twitterTitle = document.querySelector('meta[name="twitter:title"]')?.content;
  return (ogTitle || twitterTitle || document.title || '').trim();
}

function parseJsonLdEntries() {
  const entries = [];
  const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));

  scripts.forEach((scriptEl) => {
    const content = scriptEl.textContent?.trim();
    if (!content) {
      return;
    }

    try {
      const parsed = JSON.parse(content);
      const list = Array.isArray(parsed) ? parsed : [parsed];

      list.forEach((item) => {
        if (!item || typeof item !== 'object') {
          return;
        }

        const url = item.contentUrl || item.url || '';
        const title = item.name || item.headline || item.description || '';
        if (url) {
          entries.push({ url, title: String(title || '').trim() });
        }
      });
    } catch (error) {
      // ignore parse failures
    }
  });

  return entries;
}

function inferTitleNearUrl(text, url, fallbackTitle) {
  const idx = text.indexOf(url);
  if (idx === -1) {
    return fallbackTitle;
  }

  const chunk = text.slice(Math.max(0, idx - 260), Math.min(text.length, idx + url.length + 260));
  const patterns = [
    /"title"\s*:\s*"([^"]{2,160})"/i,
    /"name"\s*:\s*"([^"]{2,160})"/i,
    /data-title\s*=\s*"([^"]{2,160})"/i,
    /aria-label\s*=\s*"([^"]{2,160})"/i
  ];

  for (const pattern of patterns) {
    const match = chunk.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return fallbackTitle;
}

function collectEntriesFromSourceText(fullText, fallbackTitle) {
  const urls = extractUrlsFromText(fullText);
  return urls.map((url) => ({
    url,
    title: inferTitleNearUrl(fullText, url, fallbackTitle)
  }));
}

function collectPotentialSources() {
  const sourceParts = [document.documentElement?.innerHTML || ''];

  const scripts = Array.from(document.scripts || []);
  scripts.forEach((scriptEl) => {
    if (scriptEl.src) {
      sourceParts.push(scriptEl.src);
    }
    if (scriptEl.textContent) {
      sourceParts.push(scriptEl.textContent);
    }
  });

  const mediaEls = Array.from(document.querySelectorAll('video, source'));
  mediaEls.forEach((mediaEl) => {
    const src = mediaEl.getAttribute('src') || mediaEl.currentSrc;
    if (src) {
      sourceParts.push(src);
    }
  });

  return sourceParts.join('\n');
}

function dedupeEntries(entries) {
  const map = new Map();

  entries.forEach((entry) => {
    const url = entry?.url;
    if (!url) {
      return;
    }

    const title = (entry?.title || '').trim();
    if (!map.has(url)) {
      map.set(url, { url, title });
      return;
    }

    const existing = map.get(url);
    if (!existing.title && title) {
      existing.title = title;
      map.set(url, existing);
    }
  });

  return Array.from(map.values());
}

const fallbackTitle = getDocumentTitleFallback();
const sourceText = collectPotentialSources();
const byText = collectEntriesFromSourceText(sourceText, fallbackTitle);
const byJsonLd = parseJsonLdEntries();
const foundEntries = dedupeEntries([...byText, ...byJsonLd]);

if (foundEntries.length) {
  chrome.runtime.sendMessage({
    type: 'REPORT_FOUND_URLS',
    entries: foundEntries
  });
}
