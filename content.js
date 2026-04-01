(function () {
  function isWistiaM3u8Url(str) {
    if (!str || typeof str !== 'string') {
      return false;
    }
    const lower = str.toLowerCase();
    const w = lower.includes('wistia') || lower.includes('wi.st');
    const m = lower.includes('.m3u8') || lower.includes('m3u8');
    return w && m && /^https?:\/\//i.test(str);
  }

  function extractUrlsFromText(text) {
    if (!text) {
      return [];
    }

    const regex = /https?:\/\/[^\s"'<>]+/g;
    const candidates = text.match(regex) || [];

    return candidates.filter((candidate) => isWistiaM3u8Url(candidate));
  }

  const JSON_META_KEYS = new Set([
    'name',
    'title',
    'displayName',
    'mediaName',
    'hashedId',
    'hashed_id',
    'slug',
    'customId',
    'custom_id',
    'duration',
    'type',
    'id',
    'projectId',
    'accountKey',
    'width',
    'height',
    'aspectRatio',
    'quality',
    'bitrate',
    'extension',
    'thumbnailUrl',
    'thumbnail',
    'stillUrl',
    'deliveryId',
    'media_id',
    'mediaId',
    'headline',
    'host',
    'file',
    'pathId'
  ]);

  function shrinkMeta(obj) {
    if (!obj || typeof obj !== 'object') {
      return {};
    }
    const out = {};
    let n = 0;
    const maxKeys = 14;
    for (const k of Object.keys(obj)) {
      if (n >= maxKeys) {
        break;
      }
      const v = obj[k];
      if (v === undefined || v === null || v === '') {
        continue;
      }
      if (typeof v === 'string') {
        out[k] = v.length > 96 ? `${v.slice(0, 93)}…` : v;
      } else if (typeof v === 'number' && Number.isFinite(v)) {
        out[k] = v;
      } else if (typeof v === 'boolean') {
        out[k] = v;
      }
      n++;
    }
    return out;
  }

  function tryParseBalancedJson(text, start) {
    const first = text[start];
    if (first !== '{' && first !== '[') {
      return null;
    }
    const stack = [first === '{' ? '}' : ']'];
    let i = start + 1;
    let inString = false;
    let escape = false;

    while (i < text.length) {
      const c = text[i];
      if (inString) {
        if (escape) {
          escape = false;
        } else if (c === '\\') {
          escape = true;
        } else if (c === '"') {
          inString = false;
        }
        i += 1;
        continue;
      }
      if (c === '"') {
        inString = true;
        i += 1;
        continue;
      }
      if (c === '{') {
        stack.push('}');
        i += 1;
        continue;
      }
      if (c === '[') {
        stack.push(']');
        i += 1;
        continue;
      }
      if (c === '}' || c === ']') {
        if (!stack.length || stack[stack.length - 1] !== c) {
          return null;
        }
        stack.pop();
        i += 1;
        if (!stack.length) {
          const slice = text.slice(start, i);
          try {
            return { value: JSON.parse(slice), end: i };
          } catch (e) {
            return null;
          }
        }
        continue;
      }
      i += 1;
    }
    return null;
  }

  function iterateJsonRootValues(text) {
    const values = [];
    const maxLen = Math.min(text.length, 2_500_000);
    let pos = 0;
    const maxObjects = 400;
    while (pos < maxLen && values.length < maxObjects) {
      const ch = text[pos];
      if (ch === '{' || ch === '[') {
        const parsed = tryParseBalancedJson(text, pos);
        if (parsed) {
          values.push(parsed.value);
          pos = parsed.end;
          continue;
        }
      }
      pos += 1;
    }
    return values;
  }

  function walkJsonForM3u8(node, inheritedMeta, out, seenUrls) {
    if (node == null) {
      return;
    }
    if (typeof node === 'string') {
      if (isWistiaM3u8Url(node) && !seenUrls.has(node)) {
        seenUrls.add(node);
        const title = sanitizeTitle(
          inheritedMeta.title || inheritedMeta.name || inheritedMeta.mediaName || inheritedMeta.displayName || ''
        );
        out.push({
          url: node,
          title,
          meta: shrinkMeta(inheritedMeta)
        });
      }
      return;
    }
    if (typeof node !== 'object') {
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item) => walkJsonForM3u8(item, inheritedMeta, out, seenUrls));
      return;
    }

    const nextMeta = { ...inheritedMeta };
    for (const k of Object.keys(node)) {
      if (!JSON_META_KEYS.has(k)) {
        continue;
      }
      const v = node[k];
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        nextMeta[k] = v;
      }
    }

    for (const k of Object.keys(node)) {
      walkJsonForM3u8(node[k], nextMeta, out, seenUrls);
    }
  }

  /** Script / gömülü JSON bloklarında m3u8 URL + küçük meta. */
  /** meta-infer.js (manifest’te önce yüklenir) ile aynı mantık — shrinkMeta ile sınır. */
  function inferMetaFromWistiaM3u8Url(url) {
    if (typeof globalThis.inferWistiaM3U8Meta === 'function') {
      return shrinkMeta(globalThis.inferWistiaM3U8Meta(url));
    }
    return {};
  }

  function extractM3u8EntriesFromEmbeddedJson(text) {
    if (!text || text.length < 10) {
      return [];
    }
    const roots = iterateJsonRootValues(text);
    const out = [];
    const seen = new Set();
    for (const root of roots) {
      walkJsonForM3u8(root, {}, out, seen);
    }
    return out;
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
            const ldMeta = shrinkMeta({
              name: item.name,
              headline: item.headline,
              duration: item.duration
            });
            entries.push({
              url: String(directUrl),
              title,
              meta: ldMeta
            });
          }

          const parts = [item.encoding, item.subjectOf, item.video, item.hasPart].flat().filter(Boolean);
          parts.forEach((part) => {
            if (!part || typeof part !== 'object') {
              return;
            }

            const nestedUrl = part.contentUrl || part.embedUrl || part.url || '';
            const nestedTitle = sanitizeTitle(part.name || part.headline || title || '');
            if (nestedUrl) {
              const pMeta = shrinkMeta({
                name: part.name,
                headline: part.headline,
                duration: part.duration
              });
              entries.push({
                url: String(nestedUrl),
                title: nestedTitle,
                meta: pMeta
              });
            }
          });
        });
      } catch (error) {
        // ignore JSON-LD parse failures
      }
    });

    return entries;
  }

  /** track__title ve yaygın varyasyonlar — sıra DOM sırası (çoklu video için eşleştirme). */
  function collectOrderedTrackTitles() {
    const selectors = [
      '.track__title',
      '[class*="track__title"]',
      '[class*="track-title"]',
      '[class*="TrackTitle"]',
      '.track .title',
      '.track-item__title',
      'li.track .title',
      '[data-testid*="track"][class*="title"]'
    ];

    const seen = new Set();
    const ordered = [];

    for (const sel of selectors) {
      let nodes;
      try {
        nodes = document.querySelectorAll(sel);
      } catch (e) {
        continue;
      }
      nodes.forEach((node) => {
        const value =
          node.getAttribute('title') ||
          node.getAttribute('aria-label') ||
          node.textContent ||
          '';
        const clean = sanitizeTitle(value);
        if (!clean || seen.has(clean)) {
          return;
        }
        seen.add(clean);
        ordered.push(clean);
      });
    }

    return ordered;
  }

  function collectCandidateTitles(extraTitles = []) {
    const fromTracks = collectOrderedTrackTitles();
    const selectors = [
      '.track__title',
      '[class="track__title"]',
      '[class*="track__title"]',
      '[class*="track-title"]',
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

    const titles = [...fromTracks];
    const seen = new Set(fromTracks);
    for (const ext of extraTitles) {
      const clean = sanitizeTitle(ext || '');
      if (!clean || seen.has(clean)) {
        continue;
      }
      seen.add(clean);
      titles.push(clean);
    }

    selectors.forEach((selector) => {
      let nodes;
      try {
        nodes = Array.from(document.querySelectorAll(selector));
      } catch (e) {
        return;
      }
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
    const tryChunk = (searchUrl) => {
      const idx = text.indexOf(searchUrl);
      if (idx === -1) {
        return '';
      }
      const chunk = text.slice(Math.max(0, idx - 800), Math.min(text.length, searchUrl.length + idx + 800));
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
      return '';
    };

    let found = tryChunk(url);
    if (found) {
      return found;
    }

    try {
      const u = new URL(url);
      found = tryChunk(u.pathname) || tryChunk(decodeURIComponent(u.pathname));
    } catch (e) {
      // ignore
    }

    return found || fallbackTitle;
  }

  function parentSeemsLinkedToUrl(parentHtml, url) {
    if (!parentHtml || !url) {
      return false;
    }
    if (parentHtml.includes(url)) {
      return true;
    }

    const decoded = parentHtml
      .replace(/&amp;/g, '&')
      .replace(/&#38;/g, '&')
      .replace(/&quot;/g, '"');
    if (decoded.includes(url)) {
      return true;
    }

    try {
      const u = new URL(url);
      const tail = u.pathname.split('/').filter(Boolean).pop() || '';
      if (tail && parentHtml.includes(tail)) {
        return true;
      }
      const noExt = tail.replace(/\.m3u8$/i, '');
      if (noExt && noExt !== tail && parentHtml.includes(noExt)) {
        return true;
      }
    } catch (e) {
      // ignore
    }

    return false;
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
          tokenNode
            .closest('.track, .track__item, li, article, section, div')
            ?.querySelector('[class*="track__title"], [class*="track-title"]')?.textContent,
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
    const trackTitleNodes = Array.from(
      document.querySelectorAll(
        '.track__title, [class*="track__title"], [class*="track-title"], [class*="TrackTitle"]'
      )
    );
    if (!trackTitleNodes.length) {
      return fallbackTitle;
    }

    for (const titleNode of trackTitleNodes) {
      const parent =
        titleNode.closest('.track, .track__item, .track-list__item, li, article, section, [class*="track"]') ||
        titleNode.parentElement;
      if (!parent) {
        continue;
      }

      const parentHtml = parent.innerHTML || '';
      if (!parentSeemsLinkedToUrl(parentHtml, url)) {
        continue;
      }

      const clean = sanitizeTitle(titleNode.textContent || titleNode.getAttribute('title') || '');
      if (clean) {
        return clean;
      }
    }

    return fallbackTitle;
  }

  function isWeakTitle(title, fallbackTitle) {
    const t = sanitizeTitle(title || '');
    const f = sanitizeTitle(fallbackTitle || '');
    return !t || (f && t === f);
  }

  function collectEntriesFromSourceText(fullText, fallbackTitle, orderedTrackTitles) {
    const urls = extractUrlsFromText(fullText);
    const tracks = orderedTrackTitles.length ? orderedTrackTitles : collectOrderedTrackTitles();

    return urls.map((url, index) => {
      const byText = inferTitleNearUrl(fullText, url, fallbackTitle);
      const byDom = inferTitleFromDomForUrl(url, byText);
      let byTrack = inferTitleFromTrackNodes(url, byDom);

      let chosen = sanitizeTitle(byTrack || byDom || byText || '');
      if (isWeakTitle(chosen, fallbackTitle)) {
        let fromList = tracks[index];
        if (!sanitizeTitle(fromList || '') && urls.length === 1 && tracks[0]) {
          fromList = tracks[0];
        }
        const fromListClean = sanitizeTitle(fromList || '');
        if (fromListClean) {
          chosen = fromListClean;
        }
      }

      if (!chosen) {
        chosen = sanitizeTitle(fallbackTitle || '');
      }

      return {
        url,
        title: chosen,
        meta: inferMetaFromWistiaM3u8Url(url)
      };
    });
  }

  function collectOpenShadowInnerHtml(rootEl) {
    const chunks = [];
    function collectHost(host) {
      if (!host || !host.querySelectorAll) {
        return;
      }
      try {
        host.querySelectorAll('*').forEach((el) => {
          const sr = el.shadowRoot;
          if (!sr) {
            return;
          }
          chunks.push(sr.innerHTML || '');
          collectHost(sr);
        });
      } catch (e) {
        // kapalı gölge veya erişim yok
      }
    }
    collectHost(rootEl);
    return chunks.join('\n');
  }

  function collectIframeSourcesAndTitles() {
    const sourceParts = [];
    const titleParts = [];
    const seenTitles = new Set();

    const pushTitle = (raw) => {
      const clean = sanitizeTitle(raw || '');
      if (!clean || seenTitles.has(clean)) {
        return;
      }
      seenTitles.add(clean);
      titleParts.push(clean);
    };

    const iframes = Array.from(document.querySelectorAll('iframe'));
    iframes.forEach((iframe) => {
      const src =
        iframe.getAttribute('src') ||
        iframe.getAttribute('data-src') ||
        iframe.getAttribute('data-url') ||
        '';
      if (src) {
        sourceParts.push(src);
      }
      pushTitle(
        iframe.getAttribute('title') ||
          iframe.getAttribute('aria-label') ||
          iframe.getAttribute('name') ||
          iframe.dataset?.title ||
          ''
      );

      // same-origin iframe ise içeriği de tara.
      try {
        const doc = iframe.contentDocument;
        if (!doc) {
          return;
        }
        const html = doc.documentElement?.innerHTML || '';
        if (html) {
          sourceParts.push(html);
        }
        const scripts = Array.from(doc.scripts || []);
        scripts.forEach((scriptEl) => {
          if (scriptEl.src) {
            sourceParts.push(scriptEl.src);
          }
          if (scriptEl.textContent) {
            sourceParts.push(scriptEl.textContent);
          }
        });
        const iframeTrackNodes = Array.from(
          doc.querySelectorAll(
            '.track__title, [class*="track__title"], [class*="track-title"], [class*="TrackTitle"], h1, h2, [class*="title" i]'
          )
        );
        iframeTrackNodes.forEach((node) => {
          pushTitle(
            node.getAttribute('title') ||
              node.getAttribute('aria-label') ||
              node.textContent ||
              ''
          );
        });
      } catch (e) {
        // cross-origin iframe: DOM erişimi yok, sadece src/data-title ile yetin.
      }
    });

    return {
      iframeSourceText: sourceParts.join('\n'),
      iframeTitles: titleParts
    };
  }

  function collectPotentialSources(extraSourceText = '') {
    const root = document.documentElement;
    const sourceParts = [root?.innerHTML || '', collectOpenShadowInnerHtml(root)];
    if (extraSourceText) {
      sourceParts.push(extraSourceText);
    }

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
      const meta = entry?.meta && typeof entry.meta === 'object' ? entry.meta : {};
      if (!map.has(url)) {
        map.set(url, { url, title: title || fallbackTitle, meta: { ...meta } });
        return;
      }

      const existing = map.get(url);
      const prefer = sanitizeTitle(entry?.title || '');
      const existingTitle = sanitizeTitle(existing.title || '');
      if (!existingTitle && prefer) {
        existing.title = prefer;
      } else if (prefer && prefer.length > existingTitle.length && !isWeakTitle(prefer, fallbackTitle)) {
        existing.title = prefer;
      }
      existing.meta = { ...(existing.meta || {}), ...meta };
      map.set(url, existing);
    });

    return Array.from(map.values()).map((entry) => ({
      ...entry,
      title: sanitizeTitle(entry.title || '') || fallbackTitle,
      meta: entry.meta && typeof entry.meta === 'object' ? shrinkMeta(entry.meta) : {}
    }));
  }

  function runScan() {
    const orderedTrackTitles = collectOrderedTrackTitles();
    const iframeData = collectIframeSourcesAndTitles();
    const fallbackTitle = getDocumentTitleFallback();
    const candidateTitles = collectCandidateTitles(iframeData.iframeTitles);
    const bestFallback = sanitizeTitle(candidateTitles[0] || fallbackTitle);
    const sourceText = collectPotentialSources(iframeData.iframeSourceText);
    const byText = collectEntriesFromSourceText(sourceText, bestFallback, orderedTrackTitles);
    const byJsonLd = parseJsonLdEntries();
    const byEmbeddedJson = extractM3u8EntriesFromEmbeddedJson(sourceText);
    return dedupeEntries([...byText, ...byJsonLd, ...byEmbeddedJson], bestFallback);
  }

  /**
   * fast.wistia.com/embed/medias/{id}.m3u8 — tarayıcıda aynı sekmenin Referer’ı ile .json meta (isim, süre).
   * Uzantı dışı GET’te genelde {"error":true}; içerik betiğinde çalışır.
   */
  async function enrichEntriesWithWistiaFastEmbedJson(entries) {
    const referer = typeof location !== 'undefined' && location.href ? location.href : '';
    if (!referer || !Array.isArray(entries) || !entries.length) {
      return entries;
    }
    await Promise.all(
      entries.map(async (entry) => {
        try {
          const url = entry?.url;
          if (!url || typeof url !== 'string') {
            return;
          }
          if (!/\/\/fast\.wistia\.com\/embed\/medias\/.+\.m3u8/i.test(url)) {
            return;
          }
          const u = new URL(url);
          if (!u.pathname.toLowerCase().endsWith('.m3u8')) {
            return;
          }
          u.pathname = u.pathname.replace(/\.m3u8$/i, '.json');
          u.search = '';
          const jsonUrl = u.href;
          const res = await fetch(jsonUrl, {
            credentials: 'omit',
            cache: 'no-store',
            headers: {
              Accept: 'application/json',
              Referer: referer
            }
          });
          if (!res.ok) {
            return;
          }
          const parseFn = globalThis.parseWistiaEmbedJsonResponse;
          const toMetaFn = globalThis.wistiaEmbedJsonToMeta;
          if (typeof parseFn !== 'function' || typeof toMetaFn !== 'function') {
            return;
          }
          const data = parseFn(await res.text());
          if (!data) {
            return;
          }
          const extra = toMetaFn(data);
          if (!Object.keys(extra).length) {
            return;
          }
          entry.meta = shrinkMeta({ ...(entry.meta || {}), ...extra });
        } catch (e) {
          // CORS veya parse: sessiz geç
        }
      })
    );
    return entries;
  }

  function sendReport(entries) {
    const payload = { type: 'REPORT_FOUND_URLS', entries };
    function attempt(n) {
      try {
        chrome.runtime.sendMessage(payload, () => {
          const err = chrome.runtime.lastError;
          if (err && n < 8) {
            setTimeout(() => attempt(n + 1), 100 + n * 50);
          }
        });
      } catch (e) {
        if (n < 8) {
          setTimeout(() => attempt(n + 1), 100 + n * 50);
        }
      }
    }
    attempt(0);
  }

  (async () => {
    let found = runScan();
    await enrichEntriesWithWistiaFastEmbedJson(found);
    sendReport(found);
  })();
})();
