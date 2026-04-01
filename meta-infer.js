/**
 * Wistia m3u8 URL'lerinden popup için her zaman dolu olabilecek küçük meta.
 * content script, service worker ve popup tarafından paylaşılır.
 */
(function () {
  function compactMeta(obj, maxKeys) {
    const out = {};
    let n = 0;
    const lim = maxKeys || 16;
    for (const k of Object.keys(obj || {})) {
      if (n >= lim) {
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
      n += 1;
    }
    return out;
  }

  function inferWistiaM3U8Meta(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') {
      return {};
    }
    try {
      const u = new URL(rawUrl.trim());
      const href = u.href.toLowerCase();
      if (!href.includes('wistia') && !href.includes('wi.st')) {
        return {};
      }

      const meta = {};
      const hostShort = u.hostname.replace(/^www\./i, '');
      if (hostShort) {
        meta.host = hostShort;
      }

      const path = u.pathname || '';
      const medias = path.match(/\/(?:embed\/)?medias\/([^/]+)/i);
      if (medias) {
        let id = medias[1].replace(/\.m3u8$/i, '').replace(/\.m3u$/i, '');
        if (id) {
          meta.hashedId = id;
        }
      }

      let del = path.match(/\/deliveries\/([^/]+)/i);
      if (!del) {
        del = path.match(/\/delivery\/([^/]+)/i);
      }
      if (del) {
        const id = del[1];
        meta.deliveryId = id.length > 48 ? `${id.slice(0, 46)}…` : id;
      }

      const segs = path.split('/').filter(Boolean);
      const last = segs[segs.length - 1] || '';
      if (/\.m3u8$/i.test(last)) {
        const stem = last.replace(/\.m3u8$/i, '');
        if (stem && !/^(playlist|index|manifest|master)$/i.test(stem) && stem !== meta.hashedId) {
          meta.file = stem;
        }
      }

      if (segs.length >= 2) {
        const parent = segs[segs.length - 2];
        const boring = /^(hls|dash|video|audio|deliveries|delivery|medias|embed|bin|chunks?|segments?)$/i;
        if (
          parent &&
          parent.length >= 6 &&
          !boring.test(parent) &&
          parent !== meta.deliveryId &&
          parent !== meta.hashedId
        ) {
          meta.pathId = parent.length > 40 ? `${parent.slice(0, 38)}…` : parent;
        }
      }

      for (const key of ['media_id', 'mediaId', 'videoFoamId']) {
        const v = u.searchParams.get(key);
        if (v && String(v).trim() && !meta.hashedId) {
          meta.hashedId = String(v).trim().replace(/\.m3u8$/i, '');
          break;
        }
      }

      if (meta.file && meta.hashedId && meta.file === meta.hashedId) {
        delete meta.file;
      }

      return compactMeta(meta, 16);
    } catch (e) {
      return {};
    }
  }

  function parseWistiaEmbedJsonResponse(raw) {
    if (!raw || typeof raw !== 'string') {
      return null;
    }
    const idx = raw.indexOf('{');
    if (idx < 0) {
      return null;
    }
    try {
      return JSON.parse(raw.slice(idx));
    } catch (e) {
      return null;
    }
  }

  function wistiaEmbedJsonToMeta(data) {
    if (!data || typeof data !== 'object' || data.error === true) {
      return {};
    }
    const out = {};
    const media = data.media && typeof data.media === 'object' ? data.media : null;
    const primary = media || data;
    if (primary && typeof primary === 'object') {
      const n = primary.name || primary.mediaName || primary.displayName || primary.headline;
      if (n) {
        out.name = String(n);
      }
      let d = primary.duration;
      if (d == null && primary.durationInSeconds != null) {
        d = primary.durationInSeconds;
      }
      if (typeof d === 'number' && Number.isFinite(d)) {
        out.duration = d;
      }
      const hid = primary.hashedId || primary.hashed_id || data.hashedId;
      if (hid) {
        out.hashedId = String(hid).replace(/\.m3u8$/i, '');
      }
      const typ = primary.mediaType || primary.type;
      if (typ && typeof typ === 'string') {
        out.type = typ;
      }
      if (primary.description && typeof primary.description === 'string' && !out.name) {
        const short = primary.description.trim().replace(/\s+/g, ' ');
        if (short) {
          out.name = short.length > 80 ? `${short.slice(0, 77)}…` : short;
        }
      }
    }
    return out;
  }

  function isFastWistiaEmbedM3u8Url(rawUrl) {
    try {
      const u = new URL(String(rawUrl || '').trim());
      return (
        /^fast\.wistia\.com$/i.test(u.hostname) && /\/embed\/medias\/.+\.m3u8$/i.test(u.pathname)
      );
    } catch (e) {
      return false;
    }
  }

  function extractFastWistiaEmbedHashedId(rawUrl) {
    try {
      const m = new URL(String(rawUrl || '').trim()).pathname.match(/\/embed\/medias\/([^/]+)/i);
      if (!m) {
        return '';
      }
      return m[1].replace(/\.m3u8$/i, '').replace(/\.m3u$/i, '');
    } catch (e) {
      return '';
    }
  }

  function buildFastWistiaEmbedJsonUrl(hashedId) {
    const id = String(hashedId || '')
      .trim()
      .replace(/\.m3u8$/i, '');
    if (!id) {
      return '';
    }
    return `https://fast.wistia.com/embed/medias/${encodeURIComponent(id)}.json`;
  }

  globalThis.inferWistiaM3U8Meta = inferWistiaM3U8Meta;
  globalThis.parseWistiaEmbedJsonResponse = parseWistiaEmbedJsonResponse;
  globalThis.wistiaEmbedJsonToMeta = wistiaEmbedJsonToMeta;
  globalThis.isFastWistiaEmbedM3u8Url = isFastWistiaEmbedM3u8Url;
  globalThis.extractFastWistiaEmbedHashedId = extractFastWistiaEmbedHashedId;
  globalThis.buildFastWistiaEmbedJsonUrl = buildFastWistiaEmbedJsonUrl;
})();
