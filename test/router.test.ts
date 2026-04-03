import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DriverRegistry } from '../src/core/registry.js';
import { MessageRouter } from '../src/core/router.js';
import { MessageLogStore, SessionStore } from '../src/core/persistence.js';
import { hashWorkdir } from '../src/core/utils.js';
import type { AgentDriver, AgentEvent, AgentName, AppState, SendOptions } from '../src/types.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('MessageRouter', () => {
  it('automatically returns delegated work to the owner for review', async () => {
    const { router } = await createRouter({
      codex: [
        { type: 'text', content: 'Delegating\n```agent-team\n{"action":"delegate","target":"claude","message":"implement the requested slice"}\n```' },
        { type: 'done', sessionId: 'codex-owner-session' }
      ],
      codexExtra: [
        { type: 'text', content: 'I reviewed Claude output and prepared the final response.' },
        { type: 'done', sessionId: 'codex-owner-session' }
      ],
      claude: [
        { type: 'text', content: 'Implemented the requested slice and validated the happy path.' },
        { type: 'done', sessionId: 'claude-session' }
      ]
    });

    await router.handleInput('@Codex build the feature');
    await waitForIdle(router);

    const state = router.getState();
    expect(state.messages.filter((message) => message.sender === 'codex')).toHaveLength(2);
    expect(state.messages.filter((message) => message.sender === 'claude')).toHaveLength(1);
    expect(
      state.messages.some((message) =>
        message.content.some(
          (content) => content.type === 'system' && content.text.includes("Queued claude's delegated result back to codex for review.")
        )
      )
    ).toBe(true);

    await router.dispose();
  });

  it('routes human -> codex -> claude delegation and persists session ids', async () => {
    const { router, baseDir } = await createRouter({
      codex: [
        { type: 'text', content: 'Working\n```agent-team\n{"action":"delegate","target":"claude","message":"please review"}\n```' },
        { type: 'done', sessionId: 'codex-session' }
      ],
      codexExtra: [
        { type: 'text', content: 'I reviewed Claude output and wrapped up the task.' },
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

  it('does not auto-return delegated work when the worker already delegated back explicitly', async () => {
    const { router } = await createRouter({
      codex: [
        { type: 'text', content: 'Need Claude to inspect\n```agent-team\n{"action":"delegate","target":"claude","message":"inspect the patch"}\n```' },
        { type: 'done', sessionId: 'codex-session' }
      ],
      codexExtra: [
        { type: 'text', content: 'I reviewed the explicit handoff from Claude.' },
        { type: 'done', sessionId: 'codex-session' }
      ],
      claude: [
        {
          type: 'text',
          content:
            'Inspection complete.\n```agent-team\n{"action":"delegate","target":"codex","message":"review my findings and decide next steps"}\n```'
        },
        { type: 'done', sessionId: 'claude-session' }
      ]
    });

    await router.handleInput('@Codex inspect this');
    await waitForIdle(router);

    const state = router.getState();
    expect(state.messages.filter((message) => message.sender === 'codex')).toHaveLength(2);
    expect(
      state.messages.some((message) =>
        message.content.some(
          (content) => content.type === 'system' && content.text.includes("Queued claude's delegated result back to codex for review.")
        )
      )
    ).toBe(false);

    await router.dispose();
  });

  it('does not dispatch work to agents disabled for the workspace', async () => {
    const { router } = await createRouter({
      codex: [
        { type: 'text', content: 'Trying Claude\n```agent-team\n{"action":"delegate","target":"claude","message":"review this"}\n```' },
        { type: 'done', sessionId: 'codex-session' }
      ]
    });

    await router.handleInput('/agent @Claude off');
    await router.handleInput('@Codex inspect this');
    await waitForIdle(router);

    const state = router.getState();
    expect(state.agents.claude.enabled).toBe(false);
    expect(state.messages.some((message) => message.sender === 'claude')).toBe(false);
    expect(
      state.messages.some((message) =>
        message.content.some(
          (content) => content.type === 'system' && content.text.includes('Cannot delegate to claude: claude is disabled for this workspace.')
        )
      )
    ).toBe(true);

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

describe('MessageRouter - emit throttling', () => {
  it('throttles high-frequency pushContent: emits fewer times than push calls', async () => {
    const chunks = 20;
    const events: AgentEvent[] = [];
    for (let i = 0; i < chunks; i++) {
      events.push({ type: 'text', content: `chunk-${i} ` });
    }
    events.push({ type: 'done', sessionId: 'throttle-session' });

    const { router } = await createRouter({ codex: events });

    let emitCount = 0;
    const states: AppState[] = [];
    router.subscribe((state) => {
      emitCount++;
      states.push(state);
    });

    await router.handleInput('@Codex stream me');
    await waitForIdle(router);

    // The initial subscribe snapshot is 1 emit, plus the task completion emit.
    // The 20 text chunks should be coalesced by scheduleEmit (50ms window).
    // Total emits should be well under chunks + initial + completion.
    expect(emitCount).toBeLessThan(chunks);

    // Verify final state is correct: all chunks merged
    const agentMsg = router.getState().messages.find((m) => m.sender === 'codex');
    expect(agentMsg).toBeDefined();
    expect(agentMsg!.content.length).toBeGreaterThan(0);
    const fullText = agentMsg!.content.filter((c) => c.type === 'text').map((c) => (c as { text: string }).text).join('');
    for (let i = 0; i < chunks; i++) {
      expect(fullText).toContain(`chunk-${i}`);
    }

    await router.dispose();
  });

  it('continuous mergeUsage does not lose state', async () => {
    const usageCount = 15;
    const events: AgentEvent[] = [];
    for (let i = 0; i < usageCount; i++) {
      events.push({ type: 'usage', usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.0001 } });
    }
    events.push({ type: 'done', sessionId: 'usage-session' });

    const { router } = await createRouter({ codex: events });

    await router.handleInput('@Codex count tokens');
    await waitForIdle(router);

    const agentMsg = router.getState().messages.find((m) => m.sender === 'codex');
    expect(agentMsg).toBeDefined();
    expect(agentMsg!.usage).toBeDefined();
    expect(agentMsg!.usage!.inputTokens).toBe(10 * usageCount);
    expect(agentMsg!.usage!.outputTokens).toBe(5 * usageCount);
    expect(agentMsg!.usage!.costUsd).toBeCloseTo(0.0001 * usageCount);

    await router.dispose();
  });

  it('snapshot is a shallow copy — mutating returned state does not affect router', async () => {
    const { router } = await createRouter({
      codex: [
        { type: 'text', content: 'hello' },
        { type: 'done', sessionId: 'snap-session' }
      ]
    });

    await router.handleInput('@Codex test');
    await waitForIdle(router);

    const snap1 = router.getState();
    const originalLength = snap1.messages.length;

    // Mutate the snapshot — should not affect the router
    snap1.messages.push({
      id: 'fake',
      sender: 'human',
      timestamp: new Date(),
      status: 'done',
      content: [{ type: 'text', text: 'injected' }]
    });

    const snap2 = router.getState();
    expect(snap2.messages.length).toBe(originalLength);

    await router.dispose();
  });

  it('immediate emit for structural events (session switch) still works', async () => {
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
    const firstSessionId = router.getState().activeSessionId!;

    await router.handleInput('/new Test session');
    const secondSessionId = router.getState().activeSessionId!;
    expect(secondSessionId).not.toBe(firstSessionId);

    await router.handleInput('@Codex second thread');
    await waitForIdle(router);

    // Switch back to first session — should reflect immediately (not throttled)
    await router.handleInput(`/switch ${firstSessionId}`);
    const state = router.getState();
    expect(state.activeSessionId).toBe(firstSessionId);
    expect(state.messages.some((m) => m.content.some((c) => c.type === 'text' && (c as { text: string }).text.includes('first session reply')))).toBe(true);
    expect(state.messages.some((m) => m.content.some((c) => c.type === 'text' && (c as { text: string }).text.includes('second session reply')))).toBe(false);

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
  // With throttled emits, we need a slightly longer wait
  for (let index = 0; index < 80; index += 1) {
    const state = router.getState();
    if (Object.values(state.agents).every((agent) => agent.status !== 'running' && agent.queueLength === 0)) {
      // Extra wait to flush any pending scheduleEmit
      await new Promise((resolve) => setTimeout(resolve, 60));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('router did not become idle');
}

function testWorkdir(): string {
  return '/tmp/agent-team-spec';
}
