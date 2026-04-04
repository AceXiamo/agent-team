import { describe, expect, it } from 'vitest';

import { messageMatchesQuery } from '../src/tui/search.js';
import type { Message } from '../src/types.js';

describe('messageMatchesQuery', () => {
  const message: Message = {
    id: 'msg-1',
    sender: 'codex',
    timestamp: new Date('2026-04-04T00:00:00.000Z'),
    status: 'done',
    content: [
      { type: 'text', text: 'Implemented message search' },
      { type: 'thinking', text: 'Checking the current app state', collapsed: true },
      { type: 'tool_use', tool: 'rg', input: { pattern: 'searchMode' }, collapsed: true },
      { type: 'tool_result', tool: 'rg', output: 'src/tui/App.tsx: searchMode', collapsed: true },
      { type: 'delegate', target: 'kimi', message: 'polish the bubble UI', collapsed: true },
      { type: 'system', text: 'info note' }
    ]
  };

  it('matches sender, status, and message blocks', () => {
    expect(messageMatchesQuery(message, 'codex')).toBe(true);
    expect(messageMatchesQuery(message, 'done')).toBe(true);
    expect(messageMatchesQuery(message, 'implemented')).toBe(true);
    expect(messageMatchesQuery(message, 'current app state')).toBe(true);
    expect(messageMatchesQuery(message, 'searchMode')).toBe(true);
    expect(messageMatchesQuery(message, 'polish the bubble')).toBe(true);
    expect(messageMatchesQuery(message, 'info note')).toBe(true);
  });

  it('treats blank queries as a match and rejects misses', () => {
    expect(messageMatchesQuery(message, '')).toBe(true);
    expect(messageMatchesQuery(message, 'nope')).toBe(false);
  });
});
