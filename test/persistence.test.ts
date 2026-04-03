import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { MessageLogStore, SessionStore } from '../src/core/persistence.js';
import { hashWorkdir } from '../src/core/utils.js';
import type { Message } from '../src/types.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('persistence', () => {
  it('hashes workdirs deterministically', () => {
    expect(hashWorkdir('/tmp/example')).toBe(hashWorkdir('/tmp/example'));
  });

  it('stores and clears sessions by workdir', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-team-'));
    tempDirs.push(baseDir);
    const store = new SessionStore(baseDir);

    await store.set('hash-1', 'claude', 'session-123');
    expect(await store.load('hash-1')).toEqual({ claude: 'session-123' });

    await store.clear('hash-1', 'claude');
    expect(await store.load('hash-1')).toEqual({});
  });

  it('persists messages as jsonl', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-team-'));
    tempDirs.push(baseDir);
    const store = new MessageLogStore(baseDir);
    const messages: Message[] = [
      {
        id: '1',
        sender: 'human',
        timestamp: new Date('2026-04-03T00:00:00.000Z'),
        status: 'done',
        content: [{ type: 'text', text: '@Codex hi' }]
      }
    ];

    await store.save('hash-1', messages);
    const loaded = await store.load('hash-1');
    expect(loaded).toEqual(messages);
  });
});
