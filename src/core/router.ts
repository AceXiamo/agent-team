import { buildAgentPrompt } from './prompt.js';
import { parseUserInput } from './commandParser.js';
import { DelegationParser } from './delegation.js';
import { MessageLogStore, SessionStore } from './persistence.js';
import { createEmptyAgentState, createId, hashWorkdir, AGENTS } from './utils.js';
import { DriverRegistry } from './registry.js';

import type { AgentName, AppState, Message, MessageContent, Sender, TokenUsage } from '../types.js';

interface PendingTask {
  runId: string;
  source: Sender;
  target: AgentName;
  prompt: string;
}

interface RouterOptions {
  workdir: string;
  registry: DriverRegistry;
  sessionStore?: SessionStore;
  messageStore?: MessageLogStore;
}

type Listener = (state: AppState) => void;

export class MessageRouter {
  private readonly workdir: string;
  private readonly workdirHash: string;
  private readonly registry: DriverRegistry;
  private readonly sessionStore: SessionStore;
  private readonly messageStore: MessageLogStore;
  private readonly listeners = new Set<Listener>();
  private readonly cancelledRuns = new Set<string>();
  private readonly queues: Record<AgentName, PendingTask[]> = {
    claude: [],
    codex: [],
    kimi: []
  };

  private persistTimer: NodeJS.Timeout | null = null;
  private persistPromise = Promise.resolve();
  private state: AppState;

  private constructor(options: RouterOptions) {
    this.workdir = options.workdir;
    this.workdirHash = hashWorkdir(options.workdir);
    this.registry = options.registry;
    this.sessionStore = options.sessionStore ?? new SessionStore();
    this.messageStore = options.messageStore ?? new MessageLogStore();
    this.state = {
      workdir: options.workdir,
      messages: [],
      agents: {
        claude: createEmptyAgentState('claude'),
        codex: createEmptyAgentState('codex'),
        kimi: createEmptyAgentState('kimi')
      }
    };
  }

  static async create(options: RouterOptions): Promise<MessageRouter> {
    const router = new MessageRouter(options);
    await router.initialize();
    return router;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState(): AppState {
    return this.snapshot();
  }

  async handleInput(rawInput: string): Promise<void> {
    const parsed = parseUserInput(rawInput);

    if (parsed.type === 'error') {
      this.appendSystemMessage(parsed.message, 'error');
      return;
    }

    if (parsed.type === 'reset') {
      await this.resetAgent(parsed.target);
      return;
    }

    const agentState = this.state.agents[parsed.target];
    if (!agentState.available) {
      this.appendSystemMessage(`${parsed.target} is unavailable on this machine.`, 'error');
      return;
    }

    this.appendMessage({
      id: createId('msg'),
      sender: 'human',
      timestamp: new Date(),
      status: 'done',
      content: [{ type: 'text', text: `@${parsed.target} ${parsed.prompt}` }]
    });

    this.enqueueTask({
      runId: createId('run'),
      source: 'human',
      target: parsed.target,
      prompt: parsed.prompt
    });
  }

  async resetAgent(agent: AgentName): Promise<void> {
    const state = this.state.agents[agent];
    if (state.activeRunId) {
      this.cancelledRuns.add(state.activeRunId);
      await this.registry.get(agent).abort(state.activeRunId);
    }

    this.queues[agent] = [];
    state.queueLength = 0;
    state.activeRunId = null;
    state.status = 'idle';
    state.lastError = null;
    state.sessionId = null;
    await this.sessionStore.clear(this.workdirHash, agent);

    this.appendSystemMessage(`Reset ${agent} session and cleared its pending queue.`, 'info');
    this.emit();
  }

  toggleMessageExpansion(messageId: string): void {
    const message = this.state.messages.find((item) => item.id === messageId);
    if (!message) {
      return;
    }

    message.content = message.content.map((content) => {
      if (content.type === 'tool_use' || content.type === 'tool_result') {
        return { ...content, collapsed: !content.collapsed };
      }
      return content;
    });

    this.schedulePersist();
    this.emit();
  }

  async dispose(): Promise<void> {
    for (const agent of AGENTS) {
      const runId = this.state.agents[agent].activeRunId;
      if (runId) {
        await this.registry.get(agent).abort(runId);
      }
    }
    await this.flushPersist();
  }

  private async initialize(): Promise<void> {
    const [savedSessions, savedMessages, availability] = await Promise.all([
      this.sessionStore.load(this.workdirHash),
      this.messageStore.load(this.workdirHash),
      Promise.all(
        this.registry.values().map(async (driver) => ({
          name: driver.name,
          available: await driver.isAvailable()
        }))
      )
    ]);

    this.state.messages = savedMessages;

    for (const agent of AGENTS) {
      const state = this.state.agents[agent];
      state.sessionId = savedSessions[agent] ?? null;
      state.available = availability.find((item) => item.name === agent)?.available ?? false;
    }

    this.emit();
  }

  private enqueueTask(task: PendingTask): void {
    const state = this.state.agents[task.target];
    if (state.status === 'running') {
      this.queues[task.target].push(task);
      state.queueLength = this.queues[task.target].length;
      this.emit();
      return;
    }

    void this.startTask(task);
  }

  private async startTask(task: PendingTask): Promise<void> {
    const driver = this.registry.get(task.target);
    const agentState = this.state.agents[task.target];
    const message = this.createStreamingAgentMessage(task.target);
    const parser = new DelegationParser();
    let lastError: string | null = null;

    agentState.status = 'running';
    agentState.activeRunId = task.runId;
    agentState.lastError = null;
    agentState.queueLength = this.queues[task.target].length;

    this.appendMessage(message);

    try {
      for await (const event of driver.send({
        runId: task.runId,
        workdir: this.workdir,
        prompt: buildAgentPrompt({
          target: task.target,
          source: task.source,
          body: task.prompt,
          workdir: this.workdir
        }),
        sessionId: agentState.sessionId ?? undefined
      })) {
        switch (event.type) {
          case 'text': {
            const consumed = parser.consume(event.content);
            this.applyDelegationResult(message.id, consumed.displayText, consumed.requests, consumed.errors, task.target);
            break;
          }
          case 'thinking':
            this.pushContent(message.id, { type: 'thinking', text: event.content });
            break;
          case 'tool_use':
            this.pushContent(message.id, {
              type: 'tool_use',
              tool: event.tool,
              input: event.input,
              collapsed: true
            });
            break;
          case 'tool_result':
            this.pushContent(message.id, {
              type: 'tool_result',
              tool: event.tool,
              output: event.output,
              collapsed: true
            });
            break;
          case 'delegate_request':
            this.handleDelegateRequest(task.target, event.target, event.message);
            break;
          case 'usage':
            this.mergeUsage(message.id, event.usage);
            break;
          case 'done':
            agentState.sessionId = event.sessionId;
            await this.sessionStore.set(this.workdirHash, task.target, event.sessionId);
            break;
          case 'error':
            lastError = event.message;
            this.pushContent(message.id, { type: 'system', text: event.message, tone: 'error' });
            break;
        }
      }

      const finalChunk = parser.finalize();
      this.applyDelegationResult(message.id, finalChunk.displayText, finalChunk.requests, finalChunk.errors, task.target);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      this.pushContent(message.id, { type: 'system', text: lastError, tone: 'error' });
    } finally {
      const wasCancelled = this.cancelledRuns.delete(task.runId);
      agentState.activeRunId = null;
      agentState.lastError = wasCancelled ? null : lastError;
      agentState.status = wasCancelled ? 'idle' : lastError ? 'error' : 'idle';
      agentState.queueLength = this.queues[task.target].length;
      this.updateMessageStatus(message.id, wasCancelled ? 'done' : lastError ? 'error' : 'done');
      this.emit();
      void this.startNext(task.target);
    }
  }

  private async startNext(agent: AgentName): Promise<void> {
    const next = this.queues[agent].shift();
    this.state.agents[agent].queueLength = this.queues[agent].length;
    if (!next) {
      this.emit();
      return;
    }

    await this.startTask(next);
  }

  private handleDelegateRequest(source: AgentName, target: AgentName, message: string): void {
    if (source === target) {
      this.appendSystemMessage(`Ignored self-delegation request from ${source}.`, 'error');
      return;
    }

    this.appendMessage({
      id: createId('msg'),
      sender: 'system',
      timestamp: new Date(),
      status: 'done',
      content: [{ type: 'delegate', target, message: `${source} delegated: ${message}` }]
    });

    const targetState = this.state.agents[target];
    if (!targetState.available) {
      this.appendSystemMessage(`Cannot delegate to ${target}: CLI unavailable.`, 'error');
      return;
    }

    this.enqueueTask({
      runId: createId('run'),
      source,
      target,
      prompt: `Message from ${source}: ${message}`
    });
  }

  private applyDelegationResult(
    messageId: string,
    displayText: string,
    requests: Array<{ target: AgentName; message: string }>,
    errors: string[],
    source: AgentName
  ): void {
    if (displayText) {
      this.pushContent(messageId, { type: 'text', text: displayText });
    }

    for (const request of requests) {
      this.handleDelegateRequest(source, request.target, request.message);
    }

    for (const error of errors) {
      this.appendSystemMessage(error, 'error');
    }
  }

  private createStreamingAgentMessage(sender: AgentName): Message {
    return {
      id: createId('msg'),
      sender,
      timestamp: new Date(),
      status: 'streaming',
      content: []
    };
  }

  private appendSystemMessage(text: string, tone: 'info' | 'error'): void {
    this.appendMessage({
      id: createId('msg'),
      sender: 'system',
      timestamp: new Date(),
      status: tone === 'error' ? 'error' : 'done',
      content: [{ type: 'system', text, tone }]
    });
  }

  private appendMessage(message: Message): void {
    this.state.messages.push(message);
    this.schedulePersist();
    this.emit();
  }

  private pushContent(messageId: string, content: MessageContent): void {
    const message = this.state.messages.find((item) => item.id === messageId);
    if (!message) {
      return;
    }

    const last = message.content.at(-1);
    if (content.type === 'text' && last?.type === 'text') {
      last.text += content.text;
    } else if (content.type === 'thinking' && last?.type === 'thinking') {
      last.text += `\n${content.text}`;
    } else {
      message.content.push(content);
    }

    this.schedulePersist();
    this.emit();
  }

  private updateMessageStatus(messageId: string, status: Message['status']): void {
    const message = this.state.messages.find((item) => item.id === messageId);
    if (!message) {
      return;
    }
    message.status = status;
    this.schedulePersist();
  }

  private mergeUsage(messageId: string, incoming: TokenUsage): void {
    const message = this.state.messages.find((item) => item.id === messageId);
    if (!message) {
      return;
    }

    const prev = message.usage ?? {};
    message.usage = {
      inputTokens: (prev.inputTokens ?? 0) + (incoming.inputTokens ?? 0) || undefined,
      cachedInputTokens: (prev.cachedInputTokens ?? 0) + (incoming.cachedInputTokens ?? 0) || undefined,
      outputTokens: (prev.outputTokens ?? 0) + (incoming.outputTokens ?? 0) || undefined,
      costUsd: (prev.costUsd ?? 0) + (incoming.costUsd ?? 0) || undefined
    };

    this.schedulePersist();
    this.emit();
  }

  private emit(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private snapshot(): AppState {
    return structuredClone(this.state);
  }

  private schedulePersist(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
    }
    this.persistTimer = setTimeout(() => {
      void this.flushPersist();
    }, 25);
  }

  private async flushPersist(): Promise<void> {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }

    this.persistPromise = this.persistPromise.then(() =>
      this.messageStore.save(this.workdirHash, this.state.messages)
    );
    await this.persistPromise;
  }
}
