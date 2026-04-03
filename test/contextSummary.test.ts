import { describe, expect, it } from 'vitest';

import { buildContextSummary } from '../src/core/prompt.js';

import type { Message } from '../src/types.js';

function msg(sender: Message['sender'], text: string, status: Message['status'] = 'done'): Message {
  return {
    id: `msg_${Math.random().toString(36).slice(2)}`,
    sender,
    timestamp: new Date(),
    status,
    content: [{ type: 'text', text }]
  };
}

function streamingMsg(sender: Message['sender']): Message {
  return {
    id: `msg_${Math.random().toString(36).slice(2)}`,
    sender,
    timestamp: new Date(),
    status: 'streaming',
    content: []
  };
}

describe('buildContextSummary', () => {
  it('returns null when there are no messages', () => {
    expect(buildContextSummary({ target: 'claude', messages: [] })).toBeNull();
  });

  it('returns null when the only messages are from the target agent', () => {
    const messages: Message[] = [msg('claude', 'I did some work')];
    expect(buildContextSummary({ target: 'claude', messages })).toBeNull();
  });

  it('summarizes messages from other agents after the last target message', () => {
    const messages: Message[] = [
      msg('human', 'hello'),
      msg('claude', 'working on it'),
      msg('codex', 'I also looked at this'),
    ];
    const summary = buildContextSummary({ target: 'claude', messages });
    expect(summary).toContain('Codex');
    expect(summary).toContain('I also looked at this');
  });

  it('includes all messages when target has never spoken', () => {
    const messages: Message[] = [
      msg('human', 'hello'),
      msg('codex', 'I checked the code'),
    ];
    const summary = buildContextSummary({ target: 'kimi', messages });
    expect(summary).toContain('Human');
    expect(summary).toContain('hello');
    expect(summary).toContain('Codex');
    expect(summary).toContain('I checked the code');
  });

  it('ignores the streaming placeholder for the target when computing boundary', () => {
    // This is the key bug: if the streaming message is already appended,
    // buildContextSummary should skip it and look back to the last real message.
    const messages: Message[] = [
      msg('human', 'hello'),
      msg('codex', 'I looked at it'),
      streamingMsg('claude'),
    ];
    const summary = buildContextSummary({ target: 'claude', messages });
    // Should find human and codex activity, NOT treat the streaming claude msg as boundary
    expect(summary).not.toBeNull();
    expect(summary).toContain('Human');
    expect(summary).toContain('Codex');
  });

  it('truncates oversized human text instead of dropping it entirely', () => {
    const longText = 'A'.repeat(2500);
    const messages: Message[] = [msg('human', longText)];
    const summary = buildContextSummary({ target: 'claude', messages, maxChars: 2000 });
    // Should contain a truncated version, not just an omission marker
    expect(summary).not.toBeNull();
    expect(summary).toContain('Human');
    // Should contain the truncation indicator from summarizeText
    expect(summary).toContain('...');
    // Should NOT be only the omission marker
    expect(summary).not.toMatch(/^\.\.\. \(\d+ earlier messages? omitted\)$/);
  });

  it('omits earlier lines when total exceeds maxChars', () => {
    const messages: Message[] = [
      msg('human', 'first message'),
      msg('codex', 'second message'),
      msg('kimi', 'third message'),
    ];
    const summary = buildContextSummary({ target: 'claude', messages, maxChars: 50 });
    expect(summary).toContain('earlier message');
    expect(summary).toContain('omitted');
  });

  it('returns null when all messages after boundary are from the target itself', () => {
    const messages: Message[] = [
      msg('human', 'hello'),
      msg('claude', 'working'),
      msg('claude', 'still working'),
    ];
    const summary = buildContextSummary({ target: 'claude', messages });
    expect(summary).toBeNull();
  });

  it('includes delegation system messages', () => {
    const messages: Message[] = [
      msg('claude', 'done'),
      {
        id: 'sys1',
        sender: 'system',
        timestamp: new Date(),
        status: 'done',
        content: [{ type: 'delegate', target: 'kimi', message: 'claude delegated: check the tests' }]
      }
    ];
    const summary = buildContextSummary({ target: 'codex', messages });
    expect(summary).toContain('claude delegated');
  });
});
