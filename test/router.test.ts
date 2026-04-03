import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DriverRegistry } from '../src/core/registry.js';
import { MessageRouter } from '../src/core/router.js';
import { MessageLogStore, SessionStore } from '../src/core/persistence.js';
import { hashWorkdir } from '../src/core/utils.js';
import type { AgentDriver, AgentEvent, AgentName, SendOptions } from '../src/types.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('MessageRouter', () => {
  it('routes human -> codex -> claude delegation and persists session ids', async () => {
    const { router, baseDir } = await createRouter({
      codex: [
        { type: 'text', content: 'Working\n```agent-team\n{"action":"delegate","target":"claude","message":"please review"}\n```' },
        { type: 'done', sessionId: 'codex-session' }
      ],
      claude: [
        { type: 'text', content: 'Reviewed.' },
        { type: 'done', sessionId: 'claude-session' }
      ]
    });

    await router.handleInput('@Codex inspect src');
    await waitForIdle(router);

    const state = router.getState();
    expect(state.messages.some((message) => message.sender === 'system')).toBe(true);
    expect(state.messages.some((message) => message.sender === 'claude')).toBe(true);
    expect(state.agents.codex.sessionId).toBe('codex-session');
    expect(state.agents.claude.sessionId).toBe('claude-session');
    expect(state.activeSessionId).toBeTruthy();

    const sessions = await new SessionStore(baseDir).loadWorkspaceSessions(hashWorkdir(testWorkdir()));
    const active = sessions.sessions.find((session) => session.id === sessions.activeSessionId);
    expect(active?.agentSessions).toEqual({
      codex: 'codex-session',
      claude: 'claude-session'
    });

    await router.dispose();
  });

  it('queues same-agent work and reset clears queue', async () => {
    const { router } = await createRouter({
      codex: [
        { type: 'text', content: 'first' },
        { type: 'done', sessionId: 'one' }
      ],
      codexExtra: [
        { type: 'text', content: 'second' },
        { type: 'done', sessionId: 'two' }
      ]
    });

    const promise1 = router.handleInput('@Codex one');
    const promise2 = router.handleInput('@Codex two');
    await Promise.all([promise1, promise2]);

    expect(router.getState().agents.codex.queueLength).toBeGreaterThanOrEqual(0);
    await router.resetAgent('codex');
    expect(router.getState().agents.codex.sessionId).toBeNull();
    await router.dispose();
  });

  it('restores message log on restart', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-team-router-'));
    tempDirs.push(baseDir);
    const registry = new DriverRegistry([new MockDriver('claude'), new MockDriver('codex'), new MockDriver('kimi')]);

    const first = await MessageRouter.create({
      workdir: testWorkdir(),
      registry,
      sessionStore: new SessionStore(baseDir),
      messageStore: new MessageLogStore(baseDir)
    });

    await first.handleInput('@Codex hello');
    await waitForIdle(first);
    await first.dispose();

    const second = await MessageRouter.create({
      workdir: testWorkdir(),
      registry,
      sessionStore: new SessionStore(baseDir),
      messageStore: new MessageLogStore(baseDir)
    });

    expect(second.getState().messages.length).toBeGreaterThan(0);
    await second.dispose();
  });

  it('creates and switches workspace sessions', async () => {
    const { router } = await createRouter({
      codex: [
        { type: 'text', content: 'first session reply' },
        { type: 'done', sessionId: 'codex-session-1' }
      ],
      codexExtra: [
        { type: 'text', content: 'second session reply' },
        { type: 'done', sessionId: 'codex-session-2' }
      ]
    });

    await router.handleInput('@Codex first thread');
    await waitForIdle(router);
    const firstSessionId = router.getState().activeSessionId;
    expect(firstSessionId).toBeTruthy();

    await router.handleInput('/new Bug bash');
    const secondSessionId = router.getState().activeSessionId;
    expect(secondSessionId).toBeTruthy();
    expect(secondSessionId).not.toBe(firstSessionId);

    await router.handleInput('@Codex second thread');
    await waitForIdle(router);
    expect(router.getState().messages.some((message) => message.content.some((content) => content.type === 'text' && content.text.includes('second session reply')))).toBe(true);

    await router.handleInput(`/switch ${firstSessionId}`);
    expect(router.getState().activeSessionId).toBe(firstSessionId);
    expect(router.getState().messages.some((message) => message.content.some((content) => content.type === 'text' && content.text.includes('first session reply')))).toBe(true);
    expect(router.getState().messages.some((message) => message.content.some((content) => content.type === 'text' && content.text.includes('second session reply')))).toBe(false);

    await router.dispose();
  });
});

class MockDriver implements AgentDriver {
  readonly displayName: string;
  private readonly runs: AgentEvent[][];
  private readonly aborted = new Set<string>();

  constructor(readonly name: AgentName, runs: AgentEvent[][] = [[{ type: 'done', sessionId: `${name}-session` }]]) {
    this.displayName = name;
    this.runs = [...runs];
  }

  async *send(opts: SendOptions): AsyncIterable<AgentEvent> {
    const next = this.runs.shift() ?? [{ type: 'done', sessionId: `${this.name}-session` }];
    for (const event of next) {
      if (this.aborted.has(opts.runId)) {
        yield { type: 'error', message: 'aborted' };
        return;
      }
      await Promise.resolve();
      yield event;
    }
  }

  async abort(runId: string): Promise<void> {
    this.aborted.add(runId);
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }
}

async function createRouter(scenarios: {
  codex?: AgentEvent[];
  codexExtra?: AgentEvent[];
  claude?: AgentEvent[];
  kimi?: AgentEvent[];
}): Promise<{ router: MessageRouter; baseDir: string }> {
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-team-router-'));
  tempDirs.push(baseDir);
  const registry = new DriverRegistry([
    new MockDriver('claude', scenarios.claude ? [scenarios.claude] : undefined),
    new MockDriver(
      'codex',
      [scenarios.codex ?? [{ type: 'done', sessionId: 'codex-session' }], scenarios.codexExtra ?? [{ type: 'done', sessionId: 'codex-session-2' }]]
    ),
    new MockDriver('kimi', scenarios.kimi ? [scenarios.kimi] : undefined)
  ]);

  const router = await MessageRouter.create({
    workdir: testWorkdir(),
    registry,
    sessionStore: new SessionStore(baseDir),
    messageStore: new MessageLogStore(baseDir)
  });

  return { router, baseDir };
}

async function waitForIdle(router: MessageRouter): Promise<void> {
  for (let index = 0; index < 40; index += 1) {
    const state = router.getState();
    if (Object.values(state.agents).every((agent) => agent.status !== 'running' && agent.queueLength === 0)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('router did not become idle');
}

function testWorkdir(): string {
  return '/tmp/agent-team-spec';
}
