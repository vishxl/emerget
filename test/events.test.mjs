// Emerget — event-renderer tests
// Verifies eventsToMessages against the real event mix observed from
// Emergent's timeline API (diag: 410 events, 13 types).

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Mirror of content.js eventsToMessages — keep in sync.
const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();

const fmtTs = (iso) => {
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
    });
  } catch { return ''; }
};

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
        push('user', p.content || p.text || '', ts);
        break;
      case 'AssistantText':
        push('assistant', p.text || '', ts);
        break;
      case 'AssistantFinalText':
      case 'AgentFinished': {
        const t = ev.event_type === 'AgentFinished' ? (p.output || '') : (p.text || '');
        const prev = msgs[msgs.length - 1];
        if (prev && prev.role === 'assistant' && norm(prev.text) === norm(t)) break;
        push('assistant', t, ts);
        break;
      }
      case 'ToolCallStart': {
        const a = p.args || {};
        const detail = a.command || a.path || a.file_path || a.query || a.url || '';
        const label = p.tool_action_label || p.tool_display_name || p.tool_name || '';
        push('assistant', detail ? `${label}: ${detail}` : label, ts);
        break;
      }
    }
  }
  return msgs;
}

const ev = (type, payload, at = '2026-01-28T14:52:29Z') => ({
  event_type: type, payload, occurred_at: at,
});

test('every InputReceived becomes its own user turn — no merging', () => {
  const msgs = eventsToMessages([
    ev('InputReceived', { content: 'first request' }),
    ev('InputReceived', { content: 'Works' }),
    ev('InputReceived', { content: 'Works' }),
  ]);
  assert.equal(msgs.length, 3);
  assert.deepEqual(msgs.map((m) => m.role), ['user', 'user', 'user']);
  assert.equal(msgs[1].text, 'Works');
  assert.equal(msgs[2].text, 'Works');
});

test('every AssistantText is kept — nothing skipped', () => {
  const msgs = eventsToMessages([
    ev('AssistantText', { text: 'block one' }),
    ev('AssistantText', { text: 'block two' }),
    ev('AssistantText', { text: 'block three' }),
  ]);
  assert.equal(msgs.length, 3);
  assert.equal(msgs[2].text, 'block three');
});

test('AssistantFinalText identical to last AssistantText is dropped (no dupes)', () => {
  const msgs = eventsToMessages([
    ev('AssistantText', { text: 'Same text.' }),
    ev('AssistantFinalText', { text: 'Same text.' }),
  ]);
  assert.equal(msgs.length, 1);
});

test('AgentFinished.output identical to last assistant text is dropped', () => {
  const msgs = eventsToMessages([
    ev('AssistantText', { text: 'Final summary here' }),
    ev('AgentFinished', { output: 'Final summary here' }),
  ]);
  assert.equal(msgs.length, 1);
});

test('FinalText with new content after other events is kept', () => {
  const msgs = eventsToMessages([
    ev('AssistantText', { text: 'working…' }),
    ev('ToolCallStart', { tool_action_label: 'Reading logs', args: { command: 'tail -20 x.log' } }),
    ev('AssistantFinalText', { text: 'All done.' }),
  ]);
  assert.equal(msgs.length, 3);
  assert.equal(msgs[2].text, 'All done.');
});

test('ToolCallStart renders the UI tile as a label + detail line', () => {
  const msgs = eventsToMessages([
    ev('ToolCallStart', { tool_action_label: 'Reading logs', tool_display_name: 'Execute bash', args: { command: 'tail -20 /var/log/x' } }),
    ev('ToolCallStart', { tool_display_name: 'View file', args: { path: '/app/page.js' } }),
    ev('ToolCallStart', { tool_name: 'delegate_task', args: {} }),
  ]);
  assert.deepEqual(msgs.map((m) => m.text), [
    'Reading logs: tail -20 /var/log/x',
    'View file: /app/page.js',
    'delegate_task',
  ]);
  assert.ok(msgs.every((m) => m.role === 'assistant'));
});

test('bookkeeping events (Thinking, Step*, Task*, AgentStarted, ToolCallResult) are skipped', () => {
  const msgs = eventsToMessages([
    ev('Thinking', { content: 'internal reasoning' }),
    ev('StepStarted', { iteration: 1 }),
    ev('StepFinished', { iteration: 1, status: 'ok' }),
    ev('TaskStarted', { task: 'x', is_subagent: false }),
    ev('TaskFinished', { status: 'completed' }),
    ev('AgentStarted', { is_subagent: false }),
    ev('ToolCallResult', { result: 'huge output blob' }),
  ]);
  assert.equal(msgs.length, 0);
});

test('timestamps are human-format like the manual copy', () => {
  const msgs = eventsToMessages([ev('InputReceived', { content: 'hi' }, '2026-01-28T14:52:29Z')]);
  assert.ok(/^\w{3} \d{1,2}, \d{1,2}:\d{2} (AM|PM)$/.test(msgs[0].ts), 'got: ' + msgs[0].ts);
});

test('empty/whitespace texts are dropped, timeline stays ordered', () => {
  const msgs = eventsToMessages([
    ev('InputReceived', { content: '  ' }),
    ev('AssistantText', { text: '' }),
    ev('InputReceived', { content: 'real' }),
    ev('AssistantText', { text: 'response' }),
  ]);
  assert.deepEqual(msgs.map((m) => m.role), ['user', 'assistant']);
  assert.deepEqual(msgs.map((m) => m.text), ['real', 'response']);
});
