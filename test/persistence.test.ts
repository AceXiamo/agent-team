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

  it('creates and switches workspace sessions', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-team-'));
    tempDirs.push(baseDir);
    const store = new SessionStore(baseDir);

    const first = await store.createSession('hash-1', 'Planning');
    await store.bindAgentSession('hash-1', first.id, 'claude', 'claude-session-1');
    const second = await store.createSession('hash-1', 'Implementation');
    await store.bindAgentSession('hash-1', second.id, 'codex', 'codex-session-2');

    let sessions = await store.loadWorkspaceSessions('hash-1');
    expect(sessions.activeSessionId).toBe(second.id);
    expect(sessions.agentEnabled).toEqual({ claude: true, codex: true, kimi: true, copilot: true });
    expect(sessions.sessions).toHaveLength(2);

    await store.switchSession('hash-1', first.id);
    sessions = await store.loadWorkspaceSessions('hash-1');
    expect(sessions.activeSessionId).toBe(first.id);
    expect(sessions.sessions[0]?.agentSessions.claude).toBe('claude-session-1');
  });

  it('clears agent driver session from the active workspace session', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-team-'));
    tempDirs.push(baseDir);
    const store = new SessionStore(baseDir);

    const session = await store.createSession('hash-1', 'Reset me');
    await store.bindAgentSession('hash-1', session.id, 'claude', 'claude-session-1');
    expect(await store.load('hash-1')).toEqual({ claude: 'claude-session-1' });

    await store.clear('hash-1', 'claude');
    expect(await store.load('hash-1')).toEqual({});
  });

  it('migrates legacy session format into a workspace session', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-team-'));
    tempDirs.push(baseDir);
    await fs.writeFile(
      path.join(baseDir, 'sessions.json'),
      `${JSON.stringify({ 'hash-1': { claude: 'legacy-claude', codex: 'legacy-codex' } }, null, 2)}\n`,
      'utf8'
    );

    const store = new SessionStore(baseDir);
    const sessions = await store.loadWorkspaceSessions('hash-1');
    expect(sessions.activeSessionId).toBe('session_migrated');
    expect(sessions.agentEnabled).toEqual({ claude: true, codex: true, kimi: true, copilot: true });
    expect(sessions.sessions[0]?.agentSessions).toEqual({
      claude: 'legacy-claude',
      codex: 'legacy-codex'
    });
  });

  it('persists agent enablement per workspace', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-team-'));
    tempDirs.push(baseDir);
    const store = new SessionStore(baseDir);

    await store.createSession('hash-1', 'Controls');
    await store.setAgentEnabled('hash-1', 'claude', false);

    const sessions = await store.loadWorkspaceSessions('hash-1');
    expect(sessions.agentEnabled).toEqual({ claude: false, codex: true, kimi: true, copilot: true });
  });

  it('persists messages as session-scoped jsonl', async () => {
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

    await store.save('hash-1', messages, 'session-a');
    await store.save('hash-1', [], 'session-b');

    expect(await store.load('hash-1', 'session-a')).toEqual(messages);
    expect(await store.load('hash-1', 'session-b')).toEqual([]);
  });
});
