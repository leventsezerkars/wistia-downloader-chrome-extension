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
    const src = mediaEl.getAttribute('src');
    if (src) {
      sourceParts.push(src);
    }
  });

  return sourceParts.join('\n');
}

const found = extractUrlsFromText(collectPotentialSources());

if (found.length) {
  chrome.runtime.sendMessage({
    type: 'REPORT_FOUND_URLS',
    urls: found
  });
}
