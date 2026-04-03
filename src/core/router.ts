import { buildAgentPrompt } from './prompt.js';
import { parseUserInput } from './commandParser.js';
import { DelegationParser } from './delegation.js';
import { MessageLogStore, SessionStore } from './persistence.js';
import { createEmptyAgentState, createId, hashWorkdir, AGENTS } from './utils.js';
import { DriverRegistry } from './registry.js';

import type { AgentName, AppState, Message, MessageContent, Sender, SessionInfo, TokenUsage } from '../types.js';

interface PendingTask {
  runId: string;
  source: Sender;
  target: AgentName;
  prompt: string;
  mode: 'user_request' | 'delegated_work' | 'review_handoff';
}

interface RouterOptions {
  workdir: string;
  registry: DriverRegistry;
  sessionStore?: SessionStore;
  messageStore?: MessageLogStore;
}

interface PersistSnapshot {
  sessionKey?: string;
  messages: Message[];
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
  private pendingPersist: PersistSnapshot | null = null;
  private state: AppState;

  private emitTimer: ReturnType<typeof setTimeout> | null = null;
  private emitQueued = false;
  private static readonly EMIT_DELAY_MS = 80;

  private constructor(options: RouterOptions) {
    this.workdir = options.workdir;
    this.workdirHash = hashWorkdir(options.workdir);
    this.registry = options.registry;
    this.sessionStore = options.sessionStore ?? new SessionStore();
    this.messageStore = options.messageStore ?? new MessageLogStore();
    this.state = {
      workdir: options.workdir,
      messages: [],
      activeSessionId: null,
      activeSessionTitle: null,
      sessionCount: 0,
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

    if (parsed.type === 'sessions') {
      await this.listSessions();
      return;
    }

    if (parsed.type === 'new_session') {
      await this.createNewSession(parsed.title);
      return;
    }

    if (parsed.type === 'switch_session') {
      await this.switchSession(parsed.sessionId);
      return;
    }

    if (parsed.type === 'reset') {
      await this.resetAgent(parsed.target);
      return;
    }

    if (parsed.type === 'toggle_agent') {
      await this.setAgentEnabled(parsed.target, parsed.enabled);
      return;
    }

    const dispatchError = this.getAgentDispatchError(parsed.target);
    if (dispatchError) {
      this.appendSystemMessage(dispatchError, 'error');
      return;
    }

    await this.ensureActiveSession();

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
      prompt: parsed.prompt,
      mode: 'user_request'
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
    state.pendingReviewCount = 0;
    state.activeMode = null;
    state.activeRunId = null;
    state.status = 'idle';
    state.lastError = null;
    state.sessionId = null;

    if (this.state.activeSessionId) {
      await this.sessionStore.clearAgentSession(this.workdirHash, this.state.activeSessionId, agent);
    }

    this.appendSystemMessage(`Reset ${agent} session for the current workspace session and cleared its pending queue.`, 'info');
    this.emit();
  }

  async setAgentEnabled(agent: AgentName, enabled: boolean): Promise<void> {
    const state = this.state.agents[agent];
    if (state.enabled === enabled) {
      this.appendSystemMessage(`${agent} is already ${enabled ? 'enabled' : 'disabled'} for this workspace.`, 'info');
      return;
    }

    const queued = this.queues[agent].length;
    if (!enabled) {
      this.queues[agent] = [];
      if (state.activeRunId) {
        this.cancelledRuns.add(state.activeRunId);
        await this.registry.get(agent).abort(state.activeRunId);
      }
    }

    state.enabled = enabled;
    this.syncAgentWorkState(agent);
    await this.sessionStore.setAgentEnabled(this.workdirHash, agent, enabled);

    if (enabled) {
      this.appendSystemMessage(`Enabled ${agent} for this workspace.`, 'info');
    } else {
      const clearedLabel = queued > 0 ? ` and cleared ${queued} queued task${queued === 1 ? '' : 's'}` : '';
      const activeLabel = state.activeRunId ? ' Aborted the active run.' : '';
      this.appendSystemMessage(`Disabled ${agent} for this workspace${clearedLabel}.${activeLabel}`.trim(), 'info');
    }

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
    const [workspaceSessions, availability] = await Promise.all([
      this.sessionStore.loadWorkspaceSessions(this.workdirHash),
      Promise.all(
        this.registry.values().map(async (driver) => ({
          name: driver.name,
          available: await driver.isAvailable()
        }))
      )
    ]);

    const activeSession = workspaceSessions.sessions.find((session) => session.id === workspaceSessions.activeSessionId) ?? null;
    this.state.messages = await this.loadMessagesForSession(activeSession?.id);
    this.state.activeSessionId = activeSession?.id ?? null;
    this.state.activeSessionTitle = activeSession?.title ?? null;
    this.state.sessionCount = workspaceSessions.sessions.length;

    for (const agent of AGENTS) {
      const state = this.state.agents[agent];
      state.sessionId = activeSession?.agentSessions[agent] ?? null;
      state.available = availability.find((item) => item.name === agent)?.available ?? false;
      state.enabled = workspaceSessions.agentEnabled[agent];
      this.syncAgentWorkState(agent);
    }

    this.emit();
  }

  private enqueueTask(task: PendingTask): void {
    const state = this.state.agents[task.target];
    if (state.status === 'running') {
      this.queues[task.target].push(task);
      this.syncAgentWorkState(task.target);
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
    const sessionKey = this.state.activeSessionId;
    let lastError: string | null = null;
    let returnedControlToSource = false;

    agentState.status = 'running';
    agentState.activeRunId = task.runId;
    agentState.activeMode = task.mode;
    agentState.lastError = null;
    this.syncAgentWorkState(task.target);

    this.appendMessage(message);

    try {
      for await (const event of driver.send({
        runId: task.runId,
        workdir: this.workdir,
        prompt: buildAgentPrompt({
          target: task.target,
          source: task.source,
          mode: task.mode,
          body: task.prompt,
          workdir: this.workdir
        }),
        sessionId: agentState.sessionId ?? undefined
      })) {
        switch (event.type) {
          case 'text': {
            const consumed = parser.consume(event.content);
            if (task.mode === 'delegated_work' && consumed.requests.some((request) => request.target === task.source)) {
              returnedControlToSource = true;
            }
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
            if (task.mode === 'delegated_work' && event.target === task.source) {
              returnedControlToSource = true;
            }
            this.handleDelegateRequest(task.target, event.target, event.message);
            break;
          case 'usage':
            this.mergeUsage(message.id, event.usage);
            break;
          case 'done':
            agentState.sessionId = event.sessionId;
            if (sessionKey) {
              await this.sessionStore.bindAgentSession(this.workdirHash, sessionKey, task.target, event.sessionId);
            }
            break;
          case 'error':
            lastError = event.message;
            this.pushContent(message.id, { type: 'system', text: event.message, tone: 'error' });
            break;
        }
      }

      const finalChunk = parser.finalize();
      if (task.mode === 'delegated_work' && finalChunk.requests.some((request) => request.target === task.source)) {
        returnedControlToSource = true;
      }
      this.applyDelegationResult(message.id, finalChunk.displayText, finalChunk.requests, finalChunk.errors, task.target);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      this.pushContent(message.id, { type: 'system', text: lastError, tone: 'error' });
    } finally {
      const wasCancelled = this.cancelledRuns.delete(task.runId);
      agentState.activeRunId = null;
      agentState.activeMode = null;
      agentState.lastError = wasCancelled ? null : lastError;
      agentState.status = wasCancelled ? 'idle' : lastError ? 'error' : 'idle';
      this.syncAgentWorkState(task.target);
      this.updateMessageStatus(message.id, wasCancelled ? 'done' : lastError ? 'error' : 'done');
      this.maybeQueueReviewHandoff(task, message.id, returnedControlToSource, wasCancelled);
      this.emit();
      void this.startNext(task.target);
    }
  }

  private async startNext(agent: AgentName): Promise<void> {
    const next = this.queues[agent].shift();
    this.syncAgentWorkState(agent);
    if (!next) {
      this.emit();
      return;
    }

    await this.startTask(next);
  }

  private async listSessions(): Promise<void> {
    const workspaceSessions = await this.sessionStore.loadWorkspaceSessions(this.workdirHash);
    if (workspaceSessions.sessions.length === 0) {
      this.appendSystemMessage('No workspace sessions found. Use `/new [title]` to start one.', 'info');
      return;
    }

    const lines = workspaceSessions.sessions.map((session) => {
      const marker = session.id === workspaceSessions.activeSessionId ? ' (active)' : '';
      const agents = AGENTS.filter((agent) => session.agentSessions[agent]).join(', ') || 'no agents yet';
      return `  ${session.id}${marker} - ${session.title} [${agents}]`;
    });

    this.appendSystemMessage(`Workspace sessions:\n${lines.join('\n')}`, 'info');
  }

  private async createNewSession(title?: string): Promise<void> {
    if (Object.values(this.state.agents).some((agent) => agent.status === 'running')) {
      this.appendSystemMessage('Cannot create a new session while an agent is running.', 'error');
      return;
    }

    await this.flushPersist();
    const created = await this.sessionStore.createSession(this.workdirHash, title);
    this.applyActiveSession(created, [], this.state.sessionCount + 1);
    this.emit();
    this.appendSystemMessage(`Created session ${created.id}${title ? `: ${created.title}` : ''}.`, 'info');
  }

  private async switchSession(sessionId: string): Promise<void> {
    if (Object.values(this.state.agents).some((agent) => agent.status === 'running')) {
      this.appendSystemMessage('Cannot switch sessions while an agent is running.', 'error');
      return;
    }

    await this.flushPersist();
    const session = await this.sessionStore.switchSession(this.workdirHash, sessionId);
    if (!session) {
      this.appendSystemMessage(`Session ${sessionId} not found.`, 'error');
      return;
    }

    const messages = await this.loadMessagesForSession(session.id);
    this.applyActiveSession(session, messages, this.state.sessionCount);
    this.emit();
    this.appendSystemMessage(`Switched to session ${session.title} (${session.id}).`, 'info');
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

    const dispatchError = this.getAgentDispatchError(target);
    if (dispatchError) {
      this.appendSystemMessage(`Cannot delegate to ${target}: ${dispatchError}`, 'error');
      return;
    }

    this.enqueueTask({
      runId: createId('run'),
      source,
      target,
      prompt: `Message from ${source}: ${message}`,
      mode: 'delegated_work'
    });
  }

  private maybeQueueReviewHandoff(
    task: PendingTask,
    messageId: string,
    returnedControlToSource: boolean,
    wasCancelled: boolean
  ): void {
    if (task.mode !== 'delegated_work' || wasCancelled || returnedControlToSource || !isAgentSender(task.source)) {
      return;
    }

    const dispatchError = this.getAgentDispatchError(task.source);
    if (dispatchError) {
      this.appendSystemMessage(`Cannot return delegated result to ${task.source}: ${dispatchError}`, 'error');
      return;
    }

    const handoffMessage = this.state.messages.find((item) => item.id === messageId);
    if (!handoffMessage) {
      return;
    }

    this.appendSystemMessage(`Queued ${task.target}'s delegated result back to ${task.source} for review.`, 'info');
    this.enqueueTask({
      runId: createId('run'),
      source: task.target,
      target: task.source,
      mode: 'review_handoff',
      prompt: buildReviewHandoffPrompt(task.target, handoffMessage)
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

  private getAgentDispatchError(agent: AgentName): string | null {
    const state = this.state.agents[agent];
    if (!state.enabled) {
      return `${agent} is disabled for this workspace. Use \`/agent @${capitalizeAgent(agent)} on\` to re-enable it.`;
    }
    if (!state.available) {
      return `${agent} is unavailable on this machine.`;
    }
    return null;
  }

  private syncAgentWorkState(agent: AgentName): void {
    const state = this.state.agents[agent];
    state.queueLength = this.queues[agent].length;
    state.pendingReviewCount =
      this.queues[agent].filter((task) => task.mode === 'review_handoff').length + (state.activeMode === 'review_handoff' ? 1 : 0);
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
    this.scheduleEmit();
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
    this.scheduleEmit();
  }

  /**
   * Immediate emit — used for low-frequency structural events
   * (session switch, reset, task start/finish, initial load).
   * Cancels any pending scheduled emit to avoid double-firing.
   */
  private emit(): void {
    if (this.emitTimer) {
      clearTimeout(this.emitTimer);
      this.emitTimer = null;
      this.emitQueued = false;
    }
    const snapshot = this.snapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  /**
   * Throttled emit — used for high-frequency streaming updates
   * (pushContent, mergeUsage). Multiple calls within the window
   * are coalesced into a single emit.
   */
  private scheduleEmit(): void {
    if (this.emitQueued) {
      return;
    }
    this.emitQueued = true;
    this.emitTimer = setTimeout(() => {
      this.emitQueued = false;
      this.emitTimer = null;
      const snapshot = this.snapshot();
      for (const listener of this.listeners) {
        listener(snapshot);
      }
    }, MessageRouter.EMIT_DELAY_MS);
  }

  private snapshot(): AppState {
    return {
      ...this.state,
      messages: [...this.state.messages],
      agents: {
        claude: { ...this.state.agents.claude },
        codex: { ...this.state.agents.codex },
        kimi: { ...this.state.agents.kimi }
      }
    };
  }

  private schedulePersist(): void {
    this.pendingPersist = {
      sessionKey: this.state.activeSessionId ?? undefined,
      messages: structuredClone(this.state.messages)
    };

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

    const snapshot = this.pendingPersist;
    if (!snapshot) {
      return;
    }

    this.pendingPersist = null;
    this.persistPromise = this.persistPromise.then(() =>
      this.messageStore.save(this.workdirHash, snapshot.messages, snapshot.sessionKey)
    );
    await this.persistPromise;
  }

  private async ensureActiveSession(): Promise<void> {
    if (this.state.activeSessionId) {
      return;
    }

    const created = await this.sessionStore.createSession(this.workdirHash);
    this.applyActiveSession(created, [], this.state.sessionCount + 1);
    this.emit();
  }

  private applyActiveSession(session: SessionInfo, messages: Message[], sessionCount: number): void {
    this.state.messages = messages;
    this.state.activeSessionId = session.id;
    this.state.activeSessionTitle = session.title;
    this.state.sessionCount = sessionCount;

    for (const agent of AGENTS) {
      this.state.agents[agent].sessionId = session.agentSessions[agent] ?? null;
    }
  }

  private async loadMessagesForSession(sessionId?: string): Promise<Message[]> {
    if (!sessionId) {
      return [];
    }

    const messages = await this.messageStore.load(this.workdirHash, sessionId);
    if (messages.length > 0 || sessionId !== 'session_migrated') {
      return messages;
    }

    return this.messageStore.load(this.workdirHash);
  }
}

function isAgentSender(sender: Sender): sender is AgentName {
  return sender === 'claude' || sender === 'codex' || sender === 'kimi';
}

function buildReviewHandoffPrompt(source: AgentName, message: Message): string {
  const lines = [
    `Delegated work from ${source} has completed. Review it before answering the human user.`,
    'If it is incomplete, delegate follow-up work or make the necessary fixes yourself.',
    '',
    'Returned work:',
    serializeMessageForReview(message)
  ];

  return lines.join('\n');
}

function serializeMessageForReview(message: Message): string {
  const blocks = message.content.map((content) => {
    switch (content.type) {
      case 'text':
        return content.text.trim();
      case 'thinking':
        return `[thinking]\n${content.text.trim()}`;
      case 'tool_use':
        return `[tool ${content.tool}] ${summarizeValue(content.input)}`;
      case 'tool_result':
        return `[tool result ${content.tool}] ${summarizeText(content.output, 240)}`;
      case 'delegate':
        return `[delegated to ${content.target}] ${content.message}`;
      case 'system':
        return `[system ${content.tone ?? 'info'}] ${content.text}`;
    }
  });

  const usage = formatUsage(message.usage);
  if (usage) {
    blocks.push(`[usage] ${usage}`);
  }

  return blocks.filter(Boolean).join('\n\n') || '[no output captured]';
}

function summarizeValue(value: unknown): string {
  if (value == null) {
    return 'none';
  }

  if (typeof value === 'string') {
    return summarizeText(value, 120);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    return `${value.length} item${value.length === 1 ? '' : 's'}`;
  }

  if (typeof value === 'object') {
    return summarizeText(JSON.stringify(value), 120);
  }

  return String(value);
}

function summarizeText(value: string, limit: number): string {
  const singleLine = value.replace(/\s+/g, ' ').trim();
  if (!singleLine) {
    return '';
  }

  return singleLine.length > limit ? `${singleLine.slice(0, limit - 3)}...` : singleLine;
}

function formatUsage(usage?: TokenUsage): string {
  if (!usage) {
    return '';
  }

  const parts: string[] = [];
  if (usage.inputTokens != null) {
    parts.push(`${usage.inputTokens} in`);
  }
  if (usage.outputTokens != null) {
    parts.push(`${usage.outputTokens} out`);
  }
  if (usage.costUsd != null) {
    parts.push(`$${usage.costUsd.toFixed(4)}`);
  }

  return parts.join(' • ');
}

function capitalizeAgent(agent: AgentName): string {
  return `${agent.slice(0, 1).toUpperCase()}${agent.slice(1)}`;
}
