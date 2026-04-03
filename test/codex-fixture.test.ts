import fs from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { CodexDriver } from '../src/drivers/codex.js';
import type { AgentEvent } from '../src/types.js';

describe('Codex JSONL fixture parsing', () => {
  it('turns live-style JSONL lines into normalized agent events', async () => {
    const fixturePath = path.join(process.cwd(), 'test/fixtures/codex-live-sample.jsonl');
    const lines = (await fs.readFile(fixturePath, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    const driver = new CodexDriver();
    const events = lines.flatMap((line) => readMapLine(driver, line));

    expect(events).toEqual<AgentEvent[]>([
      { type: 'done', sessionId: '019d535e-28fd-7c52-ad74-b71bf824d67e' },
      { type: 'text', content: 'Hey. What do you need?' }
    ]);
  });
});

function readMapLine(driver: object, input: unknown): AgentEvent[] {
  return (driver as { mapLine: (value: unknown) => AgentEvent[] }).mapLine(input);
}
