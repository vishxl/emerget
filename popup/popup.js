// Emerget — popup

const stateKey = 'emerget:state';
const el = {
  status: document.getElementById('status'),
  bar: document.querySelector('#bar i'),
  primary: document.getElementById('primary'),
  copy: document.getElementById('copy'),
  download: document.getElementById('download'),
  fmt: document.getElementById('fmt'),
  preview: document.getElementById('preview'),
  meta: document.getElementById('meta'),
};

let messages = [];
let meta = { title: 'Emergent chat', url: '' };

const stamp = () => new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);

function headerBlock(kind) {
  if (kind === 'md') {
    return [
      `# ${meta.title} — Emergent chat export`,
      '',
      `> Exported with Emerget · ${new Date().toLocaleString()}`,
      `> Source: ${meta.url} · ${messages.length} messages`,
      '',
    ].join('\n');
  }
  return [
    '=== Emerget — Emergent Chat Export ===',
    'Chat: ' + meta.title,
    'Source: ' + meta.url,
    'Exported: ' + new Date().toLocaleString(),
    'Messages: ' + messages.length,
    '',
  ].join('\n');
}

function fmtTranscript(msgs) {
  // labeled transcript: [USER]/[ASSISTANT], message text, timestamp line
  return msgs
    .map((m) => (m.role === 'user' ? '[USER]' : '[ASSISTANT]') + '\n' + m.text + (m.ts ? '\n' + m.ts : ''))
    .join('\n\n');
}

function fmtMarkdown(msgs) {
  return msgs
    .map((m) => '## ' + (m.role === 'user' ? 'User' : 'Assistant') + '\n\n' + m.text +
      (m.ts ? '\n\n*' + m.ts + '*' : '') + '\n')
    .join('\n---\n\n');
}

function fmtResume(msgs) {
  const lines = [
    '=== EMERGENT CHAT HISTORY - RESUME PROMPT ===',
    'Exported with Emerget — ' + new Date().toISOString(),
    'Messages: ' + msgs.length,
    '',
    'The following is my complete previous conversation. Read the full history',
    'and continue seamlessly from where it left off. Do not summarize or skip context.',
    '',
    '--- CONVERSATION HISTORY START ---',
    '',
  ];
  for (const m of msgs) {
    lines.push(m.role === 'user' ? '[USER]' : '[ASSISTANT]');
    lines.push(m.text);
    lines.push('');
  }
  lines.push('--- CONVERSATION HISTORY END ---');
  return lines.join('\n');
}

function fmtJson(msgs) {
  return JSON.stringify({
    exported_by: 'Emerget',
    exported_at: new Date().toISOString(),
    chat_title: meta.title,
    source_url: meta.url,
    messages: msgs,
  }, null, 2);
}

const formatters = {
  transcript: (m) => headerBlock('txt') + '\n' + fmtTranscript(m),
  markdown: (m) => headerBlock('md') + '\n' + fmtMarkdown(m),
  resume: fmtResume,
  json: fmtJson,
};

function currentText() {
  if (!messages.length) return '';
  const ext = { transcript: 'txt', markdown: 'md', resume: 'txt', json: 'json' }[el.fmt.value];
  return { text: formatters[el.fmt.value](messages), ext };
}

function render() {
  el.preview.hidden = !messages.length;
  if (messages.length) {
    const text = currentText().text;
    el.preview.textContent = text.slice(0, 600) + (text.length > 600 ? '…' : '');
    el.meta.textContent = `${messages.length} messages · ${meta.title}`;
  } else {
    el.meta.textContent = '';
  }
  el.copy.disabled = el.download.disabled = !messages.length;
}

async function refresh() {
  const { [stateKey]: s } = await chrome.storage.local.get(stateKey);
  if (!s) return;
  el.status.textContent = s.error || s.phase || (s.state === 'done' ? 'Done.' : 'Ready.');
  el.bar.style.width = (s.pct || 0) + '%';
  if (s.state === 'running') el.primary.disabled = true;
  if (s.state === 'done' && s.messages) {
    messages = s.messages;
    meta = { title: s.title || meta.title, url: s.url || meta.url };
    el.primary.disabled = false;
    el.status.textContent = `Captured ${s.count} messages in order.`;
    render();
  }
}

chrome.storage.onChanged.addListener((ch, area) => {
  if (area === 'local' && ch[stateKey]) refresh();
});

async function activeEmergentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/app\.emergent\.sh/.test(tab.url || '')) return null;
  return tab;
}

el.primary.addEventListener('click', async () => {
  const tab = await activeEmergentTab();
  if (!tab) {
    el.status.textContent = 'Open an app.emergent.sh chat tab first.';
    return;
  }
  messages = [];
  render();
  el.primary.disabled = true;
  el.status.textContent = 'Starting…';
  await chrome.storage.local.remove(stateKey);
  try {
    // Page may have opened before the extension loaded — inject on demand.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  } catch (e) {
    el.status.textContent = 'Could not inject into tab: ' + e.message;
    el.primary.disabled = false;
    return;
  }
  chrome.tabs.sendMessage(tab.id, { type: 'EMERGET_CAPTURE' }, (res) => {
    if (chrome.runtime.lastError || !res?.ok) {
      el.status.textContent =
        'Could not reach the page (' + (chrome.runtime.lastError?.message || 'no response') +
        '). Reload the Emergent tab and try again.';
      el.primary.disabled = false;
      return;
    }
    el.status.textContent = 'Capturing… keep this tab open.';
  });
});

el.copy.addEventListener('click', async () => {
  const { text } = currentText();
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  el.status.textContent = 'Copied to clipboard.';
});

el.download.addEventListener('click', () => {
  const { text, ext } = currentText();
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `emerget_${meta.title.replace(/[^\w-]+/g, '_').slice(0, 40)}_${stamp()}.${ext}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  el.status.textContent = 'Downloaded.';
});

el.fmt.addEventListener('change', render);
refresh();
