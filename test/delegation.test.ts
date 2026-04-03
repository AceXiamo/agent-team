import { describe, expect, it } from 'vitest';

import { DelegationParser } from '../src/core/delegation.js';

describe('DelegationParser', () => {
  it('extracts valid delegate blocks across chunks', () => {
    const parser = new DelegationParser();
    const first = parser.consume('hello ```agent-team\n{"action":"delegate","target":"cla');
    const second = parser.consume('ude","message":"review this"}\n``` done');

    expect(first.displayText).toBe('hello ');
    expect(first.requests).toEqual([]);
    expect(second.displayText).toBe(' done');
    expect(second.requests).toEqual([{ target: 'claude', message: 'review this' }]);
  });

  it('keeps incomplete blocks as plain text on finalize', () => {
    const parser = new DelegationParser();
    parser.consume('prefix ```agent-team\n{"action":"delegate"');
    const result = parser.finalize();

    expect(result.displayText).toContain('```agent-team');
    expect(result.requests).toEqual([]);
  });

  it('rejects invalid targets', () => {
    const parser = new DelegationParser();
    const result = parser.consume('```agent-team\n{"action":"delegate","target":"ghost","message":"x"}\n```');

    expect(result.errors).toEqual(['Ignored invalid delegate request block.']);
  });
});
