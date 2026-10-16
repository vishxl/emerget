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
let title = 'emergent-chat';

const stamp = () => new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);

function fmtTranscript(msgs) {
  // mirrors the manual copy: message text, then its timestamp line
  return msgs.map((m) => m.text + (m.ts ? '\n' + m.ts : '')).join('\n\n');
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
    'Date: ' + new Date().toISOString(),
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

const formatters = {
  transcript: fmtTranscript,
  markdown: fmtMarkdown,
  resume: fmtResume,
  json: (m) => JSON.stringify(m, null, 2),
};

function currentText() {
  if (!messages.length) return '';
  const ext = { transcript: 'txt', markdown: 'md', resume: 'txt', json: 'json' }[el.fmt.value];
  return { text: formatters[el.fmt.value](messages), ext };
}

function render() {
  el.preview.hidden = !messages.length;
  if (messages.length) {
    el.preview.textContent =
      currentText().text.slice(0, 600) + (currentText().text.length > 600 ? '…' : '');
    el.meta.textContent = `${messages.length} messages · ${title}`;
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
    title = s.title || title;
    el.primary.disabled = false;
    el.status.textContent = `Captured ${s.count} messages in order.`;
    render();
  }
}

chrome.storage.onChanged.addListener((ch, area) => {
  if (area === 'local' && ch[stateKey]) refresh();
});

el.primary.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/app\.emergent\.sh/.test(tab.url || '')) {
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
  a.download = `${title.replace(/[^\w-]+/g, '_')}_${stamp()}.${ext}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  el.status.textContent = 'Downloaded.';
});

document.getElementById('diag').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/app\.emergent\.sh/.test(tab.url || '')) {
    el.status.textContent = 'Open an app.emergent.sh tab first.';
    return;
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  } catch (_) {}
  await chrome.storage.local.remove(stateKey);
  chrome.tabs.sendMessage(tab.id, { type: 'EMERGET_DIAG' }, () => void chrome.runtime.lastError);
  el.status.textContent = 'Diag running… results appear in the Downloaded text (switch format to JSON).';
  setTimeout(async () => {
    const { [stateKey]: s } = await chrome.storage.local.get(stateKey);
    if (s && s.state === 'diag') {
      messages = [{ role: 'user', text: JSON.stringify(s, null, 2) }];
      render();
      el.status.textContent = 'Diag done — Copy/Download shows the JSON.';
    }
  }, 6000);
});

el.fmt.addEventListener('change', render);
refresh();
