import { describe, expect, it } from 'vitest';

import { extractMentionCandidates, parseUserInput } from '../src/core/commandParser.js';

describe('parseUserInput', () => {
  it('parses a single target agent message', () => {
    expect(parseUserInput('@Codex inspect src')).toEqual({
      type: 'send',
      target: 'codex',
      prompt: 'inspect src'
    });
  });

  it('rejects multiple mentions', () => {
    expect(parseUserInput('@Codex ask @Claude')).toEqual({
      type: 'error',
      message: 'Only one target @Agent is allowed per message.'
    });
  });

  it('parses reset command', () => {
    expect(parseUserInput('/reset @Claude')).toEqual({
      type: 'reset',
      target: 'claude'
    });
  });
});

describe('extractMentionCandidates', () => {
  it('finds matching mention candidates', () => {
    expect(extractMentionCandidates('ping @c')).toEqual(['claude', 'codex']);
  });

  it('stops matching after whitespace', () => {
    expect(extractMentionCandidates('ping @codex now')).toEqual([]);
  });
});
