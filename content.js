function extractUrlsFromText(text) {
  if (!text) {
    return [];
  }

  const regex = /https?:\/\/[^\s"'<>]+/g;
  const candidates = text.match(regex) || [];

  return candidates.filter((candidate) => {
    const lower = candidate.toLowerCase();
    const hasWistia = lower.includes('wistia') || lower.includes('wi.st');
    const hasM3u8 = lower.includes('.m3u8') || lower.includes('m3u8');
    return hasWistia && hasM3u8;
  });
}

function sanitizeTitle(rawTitle) {
  if (!rawTitle || typeof rawTitle !== 'string') {
    return '';
  }

  const title = rawTitle
    .replace(/\s+/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();

  if (!title || title.length < 2) {
    return '';
  }

  const lower = title.toLowerCase();
  const ignored = [
    'wistia',
    'video',
    'watch',
    'player',
    'homepage',
    'home page',
    'untitled',
    'no title',
    'default',
    'index'
  ];

  if (ignored.includes(lower)) {
    return '';
  }

  return title;
}

function getDocumentTitleFallback() {
  const candidates = [
    document.querySelector('meta[property="og:title"]')?.content,
    document.querySelector('meta[name="twitter:title"]')?.content,
    document.querySelector('meta[name="title"]')?.content,
    document.querySelector('h1')?.textContent,
    document.title
  ];

  for (const candidate of candidates) {
    const title = sanitizeTitle(candidate || '');
    if (title) {
      return title;
    }
  }

  return '';
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

        const directUrl = item.contentUrl || item.embedUrl || item.url || '';
        const title = sanitizeTitle(item.name || item.headline || item.description || '');

        if (directUrl) {
          entries.push({ url: String(directUrl), title });
        }

        const parts = [item.encoding, item.subjectOf, item.video, item.hasPart].flat().filter(Boolean);
        parts.forEach((part) => {
          if (!part || typeof part !== 'object') {
            return;
          }

          const nestedUrl = part.contentUrl || part.embedUrl || part.url || '';
          const nestedTitle = sanitizeTitle(part.name || part.headline || title || '');
          if (nestedUrl) {
            entries.push({ url: String(nestedUrl), title: nestedTitle });
          }
        });
      });
    } catch (error) {
      // ignore JSON-LD parse failures
    }
  });

  return entries;
}

function collectCandidateTitles() {
  const selectors = [
    '.track__title',
    '[class="track__title"]',
    '[class*="track__title"]',
    'meta[property="og:title"]',
    'meta[name="twitter:title"]',
    'meta[name="title"]',
    'h1',
    '[data-testid*="title" i]',
    '[class*="title" i]',
    '[id*="title" i]',
    '[class*="headline" i]',
    '[id*="headline" i]',
    '[aria-label*="title" i]'
  ];

  const titles = [];
  const seen = new Set();

  selectors.forEach((selector) => {
    const nodes = Array.from(document.querySelectorAll(selector));
    nodes.forEach((node) => {
      const value = node.content || node.getAttribute('aria-label') || node.textContent || '';
      const clean = sanitizeTitle(value);
      if (!clean || seen.has(clean)) {
        return;
      }
      seen.add(clean);
      titles.push(clean);
    });
  });

  return titles;
}

function inferTitleNearUrl(text, url, fallbackTitle) {
  const idx = text.indexOf(url);
  if (idx === -1) {
    return fallbackTitle;
  }

  const chunk = text.slice(Math.max(0, idx - 600), Math.min(text.length, idx + url.length + 600));
  const patterns = [
    /"title"\s*:\s*"([^"]{2,220})"/i,
    /"name"\s*:\s*"([^"]{2,220})"/i,
    /"headline"\s*:\s*"([^"]{2,220})"/i,
    /"videoTitle"\s*:\s*"([^"]{2,220})"/i,
    /data-title\s*=\s*"([^"]{2,220})"/i,
    /aria-label\s*=\s*"([^"]{2,220})"/i,
    /title\s*=\s*"([^"]{2,220})"/i
  ];

  for (const pattern of patterns) {
    const match = chunk.match(pattern);
    const clean = sanitizeTitle(match?.[1] || '');
    if (clean) {
      return clean;
    }
  }

  return fallbackTitle;
}

function inferTitleFromDomForUrl(url, fallbackTitle) {
  try {
    const parsed = new URL(url);
    const rawTokens = [
      parsed.pathname.split('/').filter(Boolean).pop(),
      parsed.searchParams.get('videoFoamId'),
      parsed.searchParams.get('media_id')
    ]
      .map((token) => String(token || '').trim())
      .filter(Boolean);

    const urlTokens = [];
    const tokenSeen = new Set();
    for (const token of rawTokens) {
      if (token && !tokenSeen.has(token)) {
        tokenSeen.add(token);
        urlTokens.push(token);
      }
      const withoutM3u8 = token.replace(/\.m3u8$/i, '');
      if (withoutM3u8 && withoutM3u8 !== token && !tokenSeen.has(withoutM3u8)) {
        tokenSeen.add(withoutM3u8);
        urlTokens.push(withoutM3u8);
      }
    }

    for (const token of urlTokens) {
      const escapedToken = CSS.escape(token);
      const tokenNode =
        document.querySelector(`[data-wistia-id="${escapedToken}"]`) ||
        document.querySelector(`[data-video-id="${escapedToken}"]`) ||
        document.querySelector(`[id*="${escapedToken}"]`) ||
        document.querySelector(`[class*="${escapedToken}"]`);

      if (!tokenNode) {
        continue;
      }

      const candidates = [
        tokenNode.getAttribute('data-title'),
        tokenNode.getAttribute('aria-label'),
        tokenNode.getAttribute('title'),
        tokenNode.closest('.track, .track__item, li, article, section, div')?.querySelector('.track__title')?.textContent,
        tokenNode.closest('article, section, div')?.querySelector('h1, h2, h3, [class*="title" i], [id*="title" i]')?.textContent,
        tokenNode.textContent
      ];

      for (const candidate of candidates) {
        const clean = sanitizeTitle(candidate || '');
        if (clean) {
          return clean;
        }
      }
    }
  } catch (error) {
    // ignore malformed URL parsing
  }

  return fallbackTitle;
}

function inferTitleFromTrackNodes(url, fallbackTitle) {
  const trackTitleNodes = Array.from(document.querySelectorAll('.track__title, [class*="track__title"]'));
  if (!trackTitleNodes.length) {
    return fallbackTitle;
  }

  for (const titleNode of trackTitleNodes) {
    const parent = titleNode.closest('.track, .track__item, li, article, section, div') || titleNode.parentElement;
    if (!parent) {
      continue;
    }

    const parentHtml = parent.innerHTML || '';
    if (!parentHtml.includes(url)) {
      continue;
    }

    const clean = sanitizeTitle(titleNode.textContent || titleNode.getAttribute('title') || '');
    if (clean) {
      return clean;
    }
  }

  return fallbackTitle;
}

function collectEntriesFromSourceText(fullText, fallbackTitle) {
  const urls = extractUrlsFromText(fullText);
  return urls.map((url) => {
    const byText = inferTitleNearUrl(fullText, url, fallbackTitle);
    const byDom = inferTitleFromDomForUrl(url, byText);
    const byTrack = inferTitleFromTrackNodes(url, byDom);
    return {
      url,
      title: sanitizeTitle(byTrack || byDom || byText || fallbackTitle)
    };
  });
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

  const mediaEls = Array.from(document.querySelectorAll('video, source, iframe'));
  mediaEls.forEach((mediaEl) => {
    const src = mediaEl.getAttribute('src') || mediaEl.currentSrc;
    if (src) {
      sourceParts.push(src);
    }

    const dataSrc = mediaEl.getAttribute('data-src') || mediaEl.getAttribute('data-url');
    if (dataSrc) {
      sourceParts.push(dataSrc);
    }
  });

  return sourceParts.join('\n');
}

function dedupeEntries(entries, fallbackTitle) {
  const map = new Map();

  entries.forEach((entry) => {
    const url = entry?.url;
    if (!url) {
      return;
    }

    const title = sanitizeTitle(entry?.title || '');
    if (!map.has(url)) {
      map.set(url, { url, title: title || fallbackTitle });
      return;
    }

    const existing = map.get(url);
    if (!existing.title && title) {
      existing.title = title;
      map.set(url, existing);
    }
  });

  return Array.from(map.values()).map((entry) => ({
    ...entry,
    title: sanitizeTitle(entry.title || '') || fallbackTitle
  }));
}

const fallbackTitle = getDocumentTitleFallback();
const candidateTitles = collectCandidateTitles();
const bestFallback = sanitizeTitle(candidateTitles[0] || fallbackTitle);
const sourceText = collectPotentialSources();
const byText = collectEntriesFromSourceText(sourceText, bestFallback);
const byJsonLd = parseJsonLdEntries();
const foundEntries = dedupeEntries([...byText, ...byJsonLd], bestFallback);

if (foundEntries.length) {
  chrome.runtime.sendMessage({
    type: 'REPORT_FOUND_URLS',
    entries: foundEntries
  });
}
