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

  it('parses sessions command', () => {
    expect(parseUserInput('/sessions')).toEqual({
      type: 'sessions'
    });
  });

  it('parses new session command with title', () => {
    expect(parseUserInput('/new review flow')).toEqual({
      type: 'new_session',
      title: 'review flow'
    });
  });

  it('parses new session command without title', () => {
    expect(parseUserInput('/new')).toEqual({
      type: 'new_session',
      title: undefined
    });
  });

  it('parses switch session command', () => {
    expect(parseUserInput('/switch session_abc')).toEqual({
      type: 'switch_session',
      sessionId: 'session_abc'
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
