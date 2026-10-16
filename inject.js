// Emerget — main-world recorder (document_start, before the page's own JS).
// Every backend request that carries a job id gets recorded to a DOM attribute
// (the only bridge between the page's world and the content script's world),
// so the open chat is always identifiable — no reliance on Chrome's capped
// performance-entry buffer, which silently drops requests on long-open tabs.
(() => {
  const seen = [];
  const rec = (url) => {
    try {
      if (!/\/jobs\/|job_id=/.test(String(url))) return;
      const m = String(url).match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
      if (!m) return;
      if (seen[seen.length - 1] !== m[1]) {
        seen.push(m[1]);
        if (seen.length > 20) seen.shift(); // ponytail: last 20 jobs is plenty for one tab
      }
      document.documentElement.setAttribute('data-emerget-jobs', seen.join(' '));
    } catch (_) { /* never break the page */ }
  };

  const origFetch = window.fetch;
  window.fetch = function (input) {
    try { rec(typeof input === 'string' ? input : (input && input.url) || ''); } catch (_) {}
    return origFetch.apply(this, arguments);
  };

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (_method, url) {
    try { rec(url || ''); } catch (_) {}
    return origOpen.apply(this, arguments);
  };
})();
