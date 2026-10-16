// Emerget — formatter tests (plain Node, no framework)
// Verifies the export shapes: transcript, markdown, resume prompt, JSON.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Mirrors of popup.js formatters — keep in sync (extracted here so tests don't
// need a DOM). popup.js remains the source of truth for behavior.
const meta = { title: 'Route Optimizer', url: 'https://app.emergent.sh/chat' };
let messages = [];

const headerBlock = (kind) => {
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
};

const fmtTranscript = (msgs) =>
  msgs
    .map((m) => (m.role === 'user' ? '[USER]' : '[ASSISTANT]') + '\n' + m.text + (m.ts ? '\n' + m.ts : ''))
    .join('\n\n');

const fmtMarkdown = (msgs) =>
  msgs
    .map(
      (m) =>
        '## ' + (m.role === 'user' ? 'User' : 'Assistant') + '\n\n' + m.text +
        (m.ts ? '\n\n*' + m.ts + '*' : '') + '\n'
    )
    .join('\n---\n\n');

const fmtResume = (msgs) => {
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
};

const fmtJson = (msgs) =>
  JSON.stringify({
    exported_by: 'Emerget',
    exported_at: new Date().toISOString(),
    chat_title: meta.title,
    source_url: meta.url,
    messages: msgs,
  }, null, 2);

const sample = [
  { role: 'user', text: 'build a route optimizer', ts: 'Jan 28, 08:22 PM' },
  { role: 'assistant', text: 'Welcome to Emergent.', ts: 'Jan 28, 08:22 PM' },
  { role: 'assistant', text: 'Created 3 files', ts: 'Jan 28, 08:32 PM' },
];

test('transcript header carries the tool name and chat title', () => {
  messages = sample;
  const t = headerBlock('txt') + '\n' + fmtTranscript(sample);
  assert.ok(t.startsWith('=== Emerget — Emergent Chat Export ==='));
  assert.ok(t.includes('Chat: Route Optimizer'));
  assert.ok(t.includes('Messages: 3'));
});

test('transcript labels every message [USER]/[ASSISTANT] and keeps order', () => {
  const t = fmtTranscript(sample);
  assert.equal((t.match(/^\[USER\]$/gm) || []).length, 1);
  assert.equal((t.match(/^\[ASSISTANT\]$/gm) || []).length, 2);
  const iUser = t.indexOf('build a route optimizer');
  const iAsst = t.indexOf('Welcome to Emergent.');
  const iTile = t.indexOf('Created 3 files');
  assert.ok(iUser < iAsst && iAsst < iTile);
  assert.ok(t.includes('Jan 28, 08:22 PM'));
});

test('markdown header brands the file and labels turns', () => {
  messages = sample;
  const t = headerBlock('md') + '\n' + fmtMarkdown(sample);
  assert.ok(t.startsWith('# Route Optimizer — Emergent chat export'));
  assert.ok(t.includes('Exported with Emerget'));
  assert.ok(!t.includes('github.com'));
  assert.equal((t.match(/^## .+$/gm) || []).length, 3);
  assert.ok(t.includes('---\n\n## Assistant'));
});

test('resume prompt brackets every message and counts them', () => {
  const t = fmtResume(sample);
  assert.ok(t.startsWith('=== EMERGENT CHAT HISTORY - RESUME PROMPT ==='));
  assert.ok(t.includes('Exported with Emerget'));
  assert.equal((t.match(/^\[USER\]$/gm) || []).length, 1);
  assert.equal((t.match(/^\[ASSISTANT\]$/gm) || []).length, 2);
  assert.ok(t.trim().endsWith('--- CONVERSATION HISTORY END ---'));
});

test('json export wraps messages with Emerget metadata', () => {
  messages = sample;
  const parsed = JSON.parse(fmtJson(sample));
  assert.ok(parsed.exported_by.startsWith('Emerget'));
  assert.equal(parsed.chat_title, 'Route Optimizer');
  assert.equal(parsed.messages.length, 3);
  assert.equal(parsed.messages[0].role, 'user');
});

test('empty input produces empty string, no crash', () => {
  assert.equal(fmtTranscript([]), '');
  assert.equal(fmtMarkdown([]), '');
  assert.ok(fmtResume([]).includes('Messages: 0'));
  assert.deepEqual(JSON.parse(fmtJson([])).messages, []);
});

test('messages without timestamps omit the ts line', () => {
  const t = fmtTranscript([{ role: 'user', text: 'hi', ts: '' }]);
  assert.equal(t, '[USER]\nhi');
});
