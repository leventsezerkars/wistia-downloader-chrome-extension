(function () {
  const MAX_SEGMENTS = 8000;

  /** Aynı anda parça isteği sayısı (RTT ve bant genişliği için; çok yüksek bağlantıda CDN limitine takılabilir). */
  const FETCH_CONCURRENCY = (function () {
    try {
      const hc =
        typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number'
          ? navigator.hardwareConcurrency
          : 8;
      return Math.min(12, Math.max(6, Math.ceil(hc * 0.75)));
    } catch (e) {
      return 8;
    }
  })();

  function canonicalizeWistiaEmbedPlaylistUrl(rawUrl) {
    try {
      const u = new URL(String(rawUrl || '').trim());
      if (!/^fast\.wistia\.com$/i.test(u.hostname)) {
        return rawUrl;
      }
      if (!/\/embed\/medias\/.+\.m3u8$/i.test(u.pathname)) {
        return rawUrl;
      }
      u.searchParams.delete('start_position');
      u.searchParams.delete('end_position');
      return u.href;
    } catch (e) {
      return rawUrl;
    }
  }

  function assertLooksLikeHlsPlaylist(text) {
    const t = (text || '').trim();
    if (!t) {
      throw new Error('Playlist boş veya erişilemedi.');
    }
    const head = t.slice(0, 800).toLowerCase();
    if (
      head.startsWith('<!doctype') ||
      head.startsWith('<html') ||
      head.includes('<html') ||
      /video not found/i.test(t)
    ) {
      throw new Error(
        'Sunucu HTML döndü (Wistia embed koruması veya hatalı adres). Videonun oynatıldığı sekmeden deneyin; tarayıcı Referer göndermeli. Geçersiz sayfa: yt-dlp veya .m3u8 adresini doğrudan oynatıcı ağından kopyalayın.'
      );
    }
    if (!t.includes('#EXTM3U')) {
      throw new Error('Geçerli bir HLS listesi alınamadı (#EXTM3U yok).');
    }
  }

  function resolveUrl(base, relative) {
    try {
      return new URL(relative.trim(), base).href;
    } catch (e) {
      return relative;
    }
  }

  function hasEncryption(playlistText) {
    return playlistText.split(/\r?\n/).some((line) => {
      if (!line.startsWith('#EXT-X-KEY')) {
        return false;
      }
      return !/METHOD\s*=\s*NONE/i.test(line);
    });
  }

  /** Master playlist: ses için GROUP-ID -> medya m3u8 */
  function parseAudioGroupUris(masterText, masterBaseUrl) {
    const map = new Map();
    const lines = masterText.split(/\r?\n/);
    for (const line of lines) {
      if (!line.startsWith('#EXT-X-MEDIA:')) {
        continue;
      }
      if (!/TYPE=AUDIO/i.test(line)) {
        continue;
      }
      const gidMatch = line.match(/GROUP-ID="([^"]+)"/i);
      const uriMatch = line.match(/URI="([^"]+)"/i);
      if (!gidMatch || !uriMatch) {
        continue;
      }
      map.set(gidMatch[1], resolveUrl(masterBaseUrl, uriMatch[1]));
    }
    return map;
  }

  /**
   * Playlist’te CODECS boşken "muxed" varsaymak, sadece görüntü varyantını seçip sesi düşürmeye yol açabiliyor.
   * Yalnızca açık ses codec dizgesi olan varyantlar gerçek muxed sayılır.
   */
  function codecsExplicitMuxedAudio(codecs) {
    if (!codecs || !String(codecs).trim()) {
      return false;
    }
    const low = String(codecs).toLowerCase();
    return (
      low.includes('mp4a') ||
      low.includes('ac-3') ||
      low.includes('ec-3') ||
      low.includes('opus') ||
      low.includes('flac')
    );
  }

  function parseStreamVariants(masterText, masterBaseUrl) {
    const lines = masterText.split(/\r?\n/);
    const variants = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.startsWith('#EXT-X-STREAM-INF')) {
        continue;
      }
      const uriMatch = line.match(/URI="([^"]+)"/i);
      let mediaPath = uriMatch ? uriMatch[1] : null;
      if (!mediaPath && i + 1 < lines.length) {
        const next = lines[i + 1].trim();
        if (next && !next.startsWith('#')) {
          mediaPath = next;
        }
      }
      if (!mediaPath) {
        continue;
      }
      const bwMatch = line.match(/BANDWIDTH=(\d+)/i);
      const bw = bwMatch ? parseInt(bwMatch[1], 10) : 0;
      const codecsMatch = line.match(/CODECS="([^"]+)"/i);
      const codecs = codecsMatch ? codecsMatch[1].trim() : '';
      const audioGrpMatch = line.match(/AUDIO="([^"]+)"/i);
      const audioGroup = audioGrpMatch ? audioGrpMatch[1] : null;
      variants.push({
        url: resolveUrl(masterBaseUrl, mediaPath),
        bw,
        codecs,
        audioGroup
      });
    }
    return variants;
  }

  /**
   * Aynı çatıda hem görüntü hem ses (çoğu Wistia): en yüksek bant genişliğinde mp4a olan varyant.
   * Sadece ayrı ses kanalı varsa ve mux’lu yoksa — tek MP4 tarayıcıda güvenilir değil; yt-dlp.
   */
  function pickVideoMediaPlaylistUrl(masterText, masterBaseUrl) {
    const variants = parseStreamVariants(masterText, masterBaseUrl);
    if (!variants.length) {
      return null;
    }
    const audioGroups = parseAudioGroupUris(masterText, masterBaseUrl);
    const muxed = variants.filter((v) => codecsExplicitMuxedAudio(v.codecs));
    if (muxed.length) {
      muxed.sort((a, b) => b.bw - a.bw);
      return muxed[0].url;
    }
    if (audioGroups.size > 0) {
      throw new Error(
        'Bu yayın görüntü ve sesi ayrı kanallarda. Tarayıcıda tek MP4 güvenilir değil; "yt-dlp kopyala" ile indirin.'
      );
    }
    variants.sort((a, b) => b.bw - a.bw);
    return variants[0].url;
  }

  function parseExtinfTotalSeconds(playlistText) {
    let total = 0;
    for (const line of playlistText.split(/\r?\n/)) {
      const m = line.match(/^#EXTINF:([\d.]+)\s*,/);
      if (m) {
        total += parseFloat(m[1]);
      }
    }
    return total;
  }

  function findFirstMoofOffset(u8) {
    const lim = Math.min(u8.length - 8, u8.byteLength - 8);
    for (let i = 0; i <= lim; i++) {
      if (u8[i + 4] === 0x6d && u8[i + 5] === 0x6f && u8[i + 6] === 0x6f && u8[i + 7] === 0x66) {
        return i;
      }
    }
    return u8.byteLength;
  }

  /**
   * mux.js bazen yalnızca mvhd süresini 0xffffffff bırakır (~13:15 görünür).
   * Sadece mvhd düzeltilir: mdhd/tkhd’a EXTINF ile yazmak, gerçek örnek sayısından
   * sapıp sesin gidip gelmesine (A/V timeline) yol açabiliyor.
   */
  function patchFragmentedMp4MetaDurations(u8, durationSec) {
    if (!durationSec || durationSec <= 0 || !Number.isFinite(durationSec)) {
      return u8;
    }
    const scanEnd = findFirstMoofOffset(u8);
    if (scanEnd < 32) {
      return u8;
    }
    const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

    for (let i = 0; i < scanEnd - 8; i++) {
      if (u8[i + 4] === 0x6d && u8[i + 5] === 0x76 && u8[i + 6] === 0x68 && u8[i + 7] === 0x64) {
        const ver = u8[i + 8];
        if (ver === 0) {
          const ts = view.getUint32(i + 20, false);
          if (ts > 0) {
            const d = Math.min(Math.floor(durationSec * ts), 0xffffffff);
            view.setUint32(i + 24, d, false);
          }
        } else if (ver === 1) {
          const ts = view.getUint32(i + 28, false);
          if (ts > 0) {
            const ticks = Math.floor(durationSec * ts);
            const bi = BigInt(ticks);
            view.setUint32(i + 32, Number((bi >> 32n) & 0xffffffffn), false);
            view.setUint32(i + 36, Number(bi & 0xffffffffn), false);
          }
        }
        break;
      }
    }

    return u8;
  }

  function parseSegmentUrls(playlistText, playlistBaseUrl) {
    const urls = [];
    const lines = playlistText.split(/\r?\n/);
    for (const line of lines) {
      const t = line.trim();
      if (!t || t.startsWith('#')) {
        continue;
      }
      urls.push(resolveUrl(playlistBaseUrl, t));
    }
    return urls;
  }

  function fetchAsText(url, fetchInit) {
    return fetch(url, fetchInit).then((res) => {
      if (!res.ok) {
        throw new Error(`Liste alınamadı (${res.status})`);
      }
      return res.text().then((text) => {
        assertLooksLikeHlsPlaylist(text);
        return text;
      });
    });
  }

  function isLikelyMpegTs(u8) {
    if (!u8 || u8.byteLength < 4) {
      return false;
    }
    if (u8[0] === 0x47) {
      return true;
    }
    const max = Math.min(u8.byteLength - 1, 600);
    for (let i = 1; i < max; i++) {
      if (u8[i] !== 0x47) {
        continue;
      }
      if (i + 188 < u8.byteLength && u8[i + 188] === 0x47) {
        return true;
      }
    }
    return false;
  }

  /**
   * Paralel indirme (havuz) + sırayla transmux: ağ doygunluğu ve CPU örtüşür; TS tamponları parça işlenince GC'ye gider.
   * Çıktı tek dev bellek kopyası olmadan Blob(parts) — büyük dosyalarda bellek ve süre tasarrufu.
   */
  async function transmuxParallelTsToMp4Blob(segmentUrls, fetchInit, durationSec, onProgress) {
    const muxjs = globalThis.muxjs;
    if (!muxjs || !muxjs.mp4 || !muxjs.mp4.Transmuxer) {
      throw new Error('mux.js yüklenemedi. vendor/mux.min.js kontrol edin.');
    }

    const n = segmentUrls.length;
    const resolvers = new Array(n);
    const pending = new Array(n);
    for (let i = 0; i < n; i++) {
      pending[i] = new Promise((resolve, reject) => {
        resolvers[i] = { resolve, reject };
      });
    }

    let nextIssued = 0;
    let firstError = null;
    let arrived = 0;

    async function worker() {
      for (;;) {
        const i = nextIssued++;
        if (i >= n) {
          return;
        }
        if (firstError) {
          resolvers[i].reject(firstError);
          continue;
        }
        try {
          const res = await fetch(segmentUrls[i], fetchInit);
          if (!res.ok) {
            throw new Error(`${i + 1}. parça indirilemedi (${res.status})`);
          }
          const buf = await res.arrayBuffer();
          const u8 = new Uint8Array(buf);
          if (!isLikelyMpegTs(u8)) {
            throw new Error(
              `Parça ${i + 1} MPEG-TS görünmüyor (fMP4 HLS). Tarayıcıda MP4 üretilemiyor; yt-dlp kullanın.`
            );
          }
          resolvers[i].resolve(u8);
          arrived += 1;
          if (typeof onProgress === 'function') {
            onProgress(arrived, n);
          }
        } catch (e) {
          const err = e instanceof Error ? e : new Error(String(e));
          if (!firstError) {
            firstError = err;
          }
          resolvers[i].reject(err);
        }
      }
    }

    const pool = Math.min(FETCH_CONCURRENCY, n);
    const fetchDone = Promise.allSettled(Array.from({ length: pool }, () => worker()));

    const Transmuxer = muxjs.mp4.Transmuxer;
    const transmuxer = new Transmuxer({ keepOriginalTimestamps: true });
    const parts = [];
    let initWritten = false;
    let err = null;

    transmuxer.on('data', (segment) => {
      if (segment.initSegment && segment.initSegment.byteLength > 0) {
        if (!initWritten) {
          parts.push(new Uint8Array(segment.initSegment));
          initWritten = true;
        }
      }
      if (segment.data && segment.data.byteLength > 0) {
        parts.push(new Uint8Array(segment.data));
      }
    });

    transmuxer.on('error', (e) => {
      err = e || new Error('Transmux hatası');
    });

    try {
      for (let i = 0; i < n; i++) {
        if (err) {
          break;
        }
        const seg = await pending[i];
        if (!seg || !seg.byteLength) {
          continue;
        }
        transmuxer.push(seg);
        transmuxer.flush();
      }
    } catch (e) {
      err = err || e;
    }

    try {
      transmuxer.dispose();
    } catch (e) {
      // ignore
    }

    await fetchDone;

    if (err) {
      throw err instanceof Error ? err : new Error(String(err));
    }
    if (firstError) {
      throw firstError;
    }

    if (!parts.length) {
      throw new Error('MP4 oluşturulamadı (akış codec’i desteklenmiyor olabilir). yt-dlp deneyin.');
    }

    if (durationSec > 0 && Number.isFinite(durationSec) && parts[0]) {
      patchFragmentedMp4MetaDurations(parts[0], durationSec);
    }

    return new Blob(parts, { type: 'video/mp4' });
  }

  function mergeM3U8PlaylistToMp4Blob(playlistUrl, fetchInit = {}, options = {}) {
    const onProgress = options.onProgress;
    let currentUrl = canonicalizeWistiaEmbedPlaylistUrl(
      typeof playlistUrl === 'string' ? playlistUrl.trim() : playlistUrl
    );
    let mediaPlaylistText = '';

    return fetchAsText(currentUrl, fetchInit)
      .then((text) => {
        if (text.includes('#EXT-X-STREAM-INF')) {
          const mediaUrl = pickVideoMediaPlaylistUrl(text, currentUrl);
          if (!mediaUrl) {
            throw new Error('Master listeden medya listesi seçilemedi.');
          }
          currentUrl = mediaUrl;
          return fetchAsText(currentUrl, fetchInit);
        }
        return text;
      })
      .then((text) => {
        mediaPlaylistText = text;
        if (hasEncryption(text)) {
          throw new Error('Şifreli akış (AES). Tarayıcıda birleştirilemez; yt-dlp kullanın.');
        }

        const segmentUrls = parseSegmentUrls(text, currentUrl);
        if (!segmentUrls.length) {
          throw new Error('Listede parça adresi yok.');
        }
        if (segmentUrls.length > MAX_SEGMENTS) {
          throw new Error(`Çok fazla parça (${segmentUrls.length}). yt-dlp kullanın.`);
        }

        const durationSec = parseExtinfTotalSeconds(mediaPlaylistText);

        return transmuxParallelTsToMp4Blob(segmentUrls, fetchInit, durationSec, onProgress);
      });
  }

  globalThis.mergeM3U8PlaylistToMp4Blob = mergeM3U8PlaylistToMp4Blob;
})();
