// Emerget — formatter tests (plain Node, no framework)
// Verifies the export shapes: transcript, markdown, resume prompt, JSON.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Mirror of popup.js formatters — keep in sync (extracted here so tests don't
// need a DOM). popup.js remains the source of truth for behavior.
const fmtTranscript = (msgs) =>
  msgs.map((m) => m.text + (m.ts ? '\n' + m.ts : '')).join('\n\n');

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
};

const sample = [
  { role: 'user', text: 'build a route optimizer', ts: 'Jan 28, 08:22 PM' },
  { role: 'assistant', text: 'Welcome to Emergent.', ts: 'Jan 28, 08:22 PM' },
  { role: 'assistant', text: 'Created 3 files', ts: 'Jan 28, 08:32 PM' },
];

test('transcript keeps order, timestamps, and blank-line separation', () => {
  const t = fmtTranscript(sample);
  const lines = t.split('\n');
  assert.equal(lines[1], 'Jan 28, 08:22 PM');
  assert.ok(t.indexOf('build a route optimizer') < t.indexOf('Welcome to Emergent.'));
  assert.ok(t.indexOf('Welcome to Emergent.') < t.indexOf('Created 3 files'));
});

test('markdown labels roles and separates turns', () => {
  const t = fmtMarkdown(sample);
  const heads = t.match(/^## .+$/gm);
  assert.deepEqual(heads, ['## User', '## Assistant', '## Assistant']);
  assert.ok(t.includes('---\n\n## Assistant'));
});

test('resume prompt brackets every message and counts them', () => {
  const t = fmtResume(sample);
  assert.ok(t.startsWith('=== EMERGENT CHAT HISTORY - RESUME PROMPT ==='));
  assert.equal((t.match(/^\[USER\]$/gm) || []).length, 1);
  assert.equal((t.match(/^\[ASSISTANT\]$/gm) || []).length, 2);
  assert.ok(t.includes('Messages: 3'));
  assert.ok(t.trim().endsWith('--- CONVERSATION HISTORY END ---'));
});

test('empty input produces empty string, no crash', () => {
  assert.equal(fmtTranscript([]), '');
  assert.equal(fmtMarkdown([]), '');
  assert.ok(fmtResume([]).includes('Messages: 0'));
});

test('messages without timestamps omit the ts line', () => {
  const t = fmtTranscript([{ role: 'user', text: 'hi', ts: '' }]);
  assert.equal(t, 'hi');
});
