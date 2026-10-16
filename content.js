// Emerget — content script
// Full-history capture for app.emergent.sh chat screens.
// Primary strategy: Emergent's own timeline API — paginated via older_than cursor,
// complete, ordered, no DOM games. DOM sweep is a fallback only.

(() => {
  if (window.__emergetActive) return;
  window.__emergetActive = true;

  const STATE_KEY = 'emerget:state';           // must match popup.js
  const API = '/__backend';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function report(update) {
    try {
      chrome.storage.local.set({ [STATE_KEY]: { url: location.href, at: Date.now(), ...update } });
    } catch (_) { /* context torn down */ }
  }

  // ---------- auth ----------

  function getToken() {
    // Supabase session lives in localStorage as sb-<ref>-auth-token.
    // ponytail: only localStorage sessions; if Emergent switches storage, extend here
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('sb-') && k.endsWith('-auth-token')) {
        try {
          const s = JSON.parse(localStorage.getItem(k));
          const tok = s.access_token || (s.currentSession && s.currentSession.access_token);
          if (tok) return tok;
        } catch (_) {}
      }
    }
    return null;
  }

  // ---------- timeline API ----------

  function apiGet(path) {
    const tok = getToken();
    if (!tok) throw new Error('No Emergent session token found — are you logged in to this tab?');
    return fetch(API + path, {
      credentials: 'include',
      headers: { Authorization: 'Bearer ' + tok },
    }).then((r) => {
      if (r.status === 401) throw new Error('Timeline API returned 401 — token expired; reload the page and retry.');
      if (!r.ok) throw new Error('Timeline API ' + r.status + ' on ' + path);
      return r.json();
    });
  }

  async function getJobId() {
    // Prefer the live URL …/jobs/v0/<uuid>/; else take the job the open timeline fetch used.
    const m = location.href.match(/jobs\/(?:v0\/)?([0-9a-f]{8}-[0-9a-f-]{27,36})/i);
    if (m) return m[1];
    const tok = getToken();
    const r = await fetch(API + '/jobs/v0/?limit=1&offset=0', {
      credentials: 'include',
      headers: { Authorization: 'Bearer ' + tok },
    });
    if (!r.ok) throw new Error('Could not list recent jobs (' + r.status + ')');
    const data = await r.json();
    const list = Array.isArray(data) ? data : data.jobs || data.items || [];
    if (!list.length) throw new Error('No recent jobs found for this account.');
    // ponytail: first item assumed most recent; verify shape if it ever looks wrong
    return (list[0].job_id || list[0].id);
  }

  async function fetchTimeline(jobId) {
    const events = [];
    let cursor = undefined;
    let pages = 0;
    for (;;) {
      const params = new URLSearchParams({ flags: 'true', main_only: 'true', limit: '200' });
      if (cursor) params.set('older_than', cursor);
      const d = await apiGet(`/v1/jobs/${jobId}/timeline?${params}`);
      const evs = d.events || [];
      events.push(...evs);
      pages++;
      report({ state: 'running', phase: 'Fetching history via API', pct: Math.min(90, pages * 10), events: events.length });
      if (!d.has_more_older || !d.older_than_cursor) break;
      cursor = d.older_than_cursor;
      if (pages > 50) break;                  // ponytail: sanity cap
      await sleep(300);                       // be polite to the API
    }
    // The API returns newest-first; reverse to chronological.
    events.reverse();
    return events;
  }

  // ---------- event → transcript ----------

  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();

  function fmtTs(iso) {
    try {
      return new Date(iso).toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
      });
    } catch { return ''; }
  }

  // Event mix observed (diag): InputReceived, AssistantText (the real message
  // bodies), AssistantFinalText + AgentFinished.output (terminal duplicates of the
  // turn's last AssistantText), ToolCallStart (UI tiles), plus bookkeeping events.
  function eventsToMessages(events) {
    const msgs = [];
    const push = (role, text, ts) => {
      if (text && text.trim()) msgs.push({ role, text, ts: ts || '' });
    };
    for (const ev of events) {
      const p = ev.payload || {};
      const ts = fmtTs(ev.occurred_at);
      switch (ev.event_type) {
        case 'InputReceived':
          push('user', p.content || p.text || '', ts);          // each input = its own turn
          break;
        case 'AssistantText':
          push('assistant', p.text || '', ts);                  // every block, no merging
          break;
        case 'AssistantFinalText':
        case 'AgentFinished': {
          const t = ev.event_type === 'AgentFinished' ? (p.output || '') : (p.text || '');
          // duplicates the turn's last AssistantText — keep only if it adds new text
          const prev = msgs[msgs.length - 1];
          if (prev && prev.role === 'assistant' && norm(prev.text) === norm(t)) break;
          push('assistant', t, ts);
          break;
        }
        case 'ToolCallStart': {
          // The UI's tiles: "Viewing 6 paths", "$ tail …", "Delegated to …", etc.
          const a = p.args || {};
          const detail = a.command || a.path || a.file_path || a.query || a.url || '';
          const label = p.tool_action_label || p.tool_display_name || p.tool_name || '';
          push('assistant', detail ? `${label}: ${detail}` : label, ts);
          break;
        }
        // Thinking / Step* / Task* / AgentStarted / ToolCallResult: bookkeeping — skip
      }
    }
    return msgs;
  }

  // ---------- main ----------

  async function capture() {
    const started = Date.now();
    try {
      report({ state: 'running', phase: 'Starting', pct: 2 });
      const jobId = await getJobId();
      report({ state: 'running', phase: 'Found job ' + jobId.slice(0, 8), pct: 6 });
      const events = await fetchTimeline(jobId);
      if (!events.length) {
        report({ state: 'error', error: 'Timeline returned 0 events — open the chat, let it load, then retry.' });
        return;
      }
      const messages = eventsToMessages(events);
      report({
        state: 'done',
        pct: 100,
        events: events.length,
        messages,
        count: messages.length,
        secs: Math.round((Date.now() - started) / 1000),
        title: document.title.replace(/[-–].*$/, '').trim() || 'emergent-chat',
      });
    } catch (e) {
      report({ state: 'error', error: 'Capture failed: ' + (e && e.message ? e.message : e), secs: Math.round((Date.now() - started) / 1000) });
    }
  }

  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg && msg.type === 'EMERGET_CAPTURE') {
      capture();
      sendResponse({ ok: true });
    }
    return false;
  });
})();
