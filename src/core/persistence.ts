import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { AgentName, Message, PersistedMessage, SessionInfo, WorkspaceSessions } from '../types.js';
import { AGENTS } from './utils.js';

export class SessionStore {
  private readonly filePath: string;
  private writePromise = Promise.resolve();

  constructor(baseDir = defaultBaseDir()) {
    this.filePath = path.join(baseDir, 'sessions.json');
  }

  async load(workdirHash: string): Promise<Partial<Record<AgentName, string>>> {
    const sessions = await this.loadWorkspaceSessions(workdirHash);
    const active = sessions.sessions.find((session) => session.id === sessions.activeSessionId);
    return { ...(active?.agentSessions ?? {}) };
  }

  async loadWorkspaceSessions(workdirHash: string): Promise<WorkspaceSessions> {
    const data = await readJson<Record<string, unknown>>(this.filePath, {});
    return normalizeWorkspaceSessions(data[workdirHash]);
  }

  async setAgentEnabled(workdirHash: string, agent: AgentName, enabled: boolean): Promise<void> {
    await this.enqueueWrite(async () => {
      const data = await readJson<Record<string, unknown>>(this.filePath, {});
      const workspace = normalizeWorkspaceSessions(data[workdirHash]);
      workspace.agentEnabled[agent] = enabled;
      data[workdirHash] = workspace;
      await writeJson(this.filePath, data);
    });
  }

  async createSession(workdirHash: string, title?: string): Promise<SessionInfo> {
    let created!: SessionInfo;

    await this.enqueueWrite(async () => {
      const data = await readJson<Record<string, unknown>>(this.filePath, {});
      const workspace = normalizeWorkspaceSessions(data[workdirHash]);
      const now = new Date().toISOString();
      created = {
        id: `session_${crypto.randomUUID()}`,
        title: title?.trim() || `Session ${workspace.sessions.length + 1}`,
        createdAt: now,
        updatedAt: now,
        agentSessions: {}
      };

      workspace.sessions.push(created);
      workspace.activeSessionId = created.id;
      data[workdirHash] = workspace;
      await writeJson(this.filePath, data);
    });

    return created;
  }

  async switchSession(workdirHash: string, sessionId: string): Promise<SessionInfo | null> {
    let matched: SessionInfo | null = null;

    await this.enqueueWrite(async () => {
      const data = await readJson<Record<string, unknown>>(this.filePath, {});
      const workspace = normalizeWorkspaceSessions(data[workdirHash]);
      const session = workspace.sessions.find((entry) => entry.id === sessionId);
      if (!session) {
        return;
      }

      session.updatedAt = new Date().toISOString();
      workspace.activeSessionId = session.id;
      matched = cloneSession(session);
      data[workdirHash] = workspace;
      await writeJson(this.filePath, data);
    });

    return matched;
  }

  async bindAgentSession(workdirHash: string, sessionId: string, agent: AgentName, driverSessionId: string): Promise<void> {
    await this.updateSession(workdirHash, sessionId, (session) => {
      session.agentSessions[agent] = driverSessionId;
      session.updatedAt = new Date().toISOString();
    });
  }

  async clearAgentSession(workdirHash: string, sessionId: string, agent: AgentName): Promise<void> {
    await this.updateSession(workdirHash, sessionId, (session) => {
      delete session.agentSessions[agent];
      session.updatedAt = new Date().toISOString();
    });
  }

  async clear(workdirHash: string, agent: AgentName): Promise<void> {
    const workspace = await this.loadWorkspaceSessions(workdirHash);
    const active = workspace.activeSessionId;
    if (!active) {
      return;
    }

    await this.clearAgentSession(workdirHash, active, agent);
  }

  private async updateSession(
    workdirHash: string,
    sessionId: string,
    update: (session: SessionInfo) => void
  ): Promise<void> {
    await this.enqueueWrite(async () => {
      const data = await readJson<Record<string, unknown>>(this.filePath, {});
      const workspace = normalizeWorkspaceSessions(data[workdirHash]);
      const session = workspace.sessions.find((entry) => entry.id === sessionId);
      if (!session) {
        return;
      }

      update(session);
      data[workdirHash] = workspace;
      await writeJson(this.filePath, data);
    });
  }

  private async enqueueWrite(operation: () => Promise<void>): Promise<void> {
    this.writePromise = this.writePromise.then(operation);
    await this.writePromise;
  }
}

export class MessageLogStore {
  private readonly messagesDir: string;

  constructor(baseDir = defaultBaseDir()) {
    this.messagesDir = path.join(baseDir, 'messages');
  }

  async load(workdirHash: string, sessionKey?: string): Promise<Message[]> {
    const filePath = this.getFilePath(workdirHash, sessionKey);
    try {
      const content = await fs.readFile(filePath, 'utf8');
      return content
        .split('\n')
        .filter(Boolean)
        .map((line) => deserializeMessage(JSON.parse(line) as PersistedMessage));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  async save(workdirHash: string, messages: Message[], sessionKey?: string): Promise<void> {
    const filePath = this.getFilePath(workdirHash, sessionKey);
    await fs.mkdir(this.messagesDir, { recursive: true });
    const payload = messages.map((message) => JSON.stringify(serializeMessage(message))).join('\n');
    await fs.writeFile(filePath, payload ? `${payload}\n` : '', 'utf8');
  }

  private getFilePath(workdirHash: string, sessionKey?: string): string {
    const suffix = sessionKey ? `_${sessionKey}` : '';
    return path.join(this.messagesDir, `${workdirHash}${suffix}.jsonl`);
  }
}

function serializeMessage(message: Message): PersistedMessage {
  return {
    ...message,
    timestamp: message.timestamp.toISOString()
  };
}

function deserializeMessage(message: PersistedMessage): Message {
  return {
    ...message,
    timestamp: new Date(message.timestamp)
  };
}

function normalizeWorkspaceSessions(value: unknown): WorkspaceSessions {
  if (isWorkspaceSessions(value)) {
    const candidate = value as WorkspaceSessions & { agentEnabled?: unknown };
    return {
      activeSessionId: value.activeSessionId,
      agentEnabled: normalizeAgentEnabled(candidate.agentEnabled),
      sessions: value.sessions.map(cloneSession)
    };
  }

  if (!value || typeof value !== 'object') {
    return { activeSessionId: null, agentEnabled: defaultAgentEnabled(), sessions: [] };
  }

  const migratedAgentSessions: Partial<Record<AgentName, string>> = {};
  for (const agent of AGENTS) {
    const maybeSession = (value as Record<string, unknown>)[agent];
    if (typeof maybeSession === 'string' && maybeSession) {
      migratedAgentSessions[agent] = maybeSession;
    }
  }

  if (Object.keys(migratedAgentSessions).length === 0) {
    return { activeSessionId: null, agentEnabled: defaultAgentEnabled(), sessions: [] };
  }

  const now = new Date().toISOString();
  const session: SessionInfo = {
    id: 'session_migrated',
    title: 'Migrated session',
    createdAt: now,
    updatedAt: now,
    agentSessions: migratedAgentSessions
  };

  return {
    activeSessionId: session.id,
    agentEnabled: defaultAgentEnabled(),
    sessions: [session]
  };
}

function isWorkspaceSessions(value: unknown): value is WorkspaceSessions {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate.activeSessionId === 'string' || candidate.activeSessionId === null
    ? Array.isArray(candidate.sessions)
    : false;
}

function cloneSession(session: SessionInfo): SessionInfo {
  return {
    ...session,
    agentSessions: { ...session.agentSessions }
  };
}

function defaultAgentEnabled(): Record<AgentName, boolean> {
  return {
    claude: true,
    codex: true,
    kimi: true
  };
}

function normalizeAgentEnabled(value: unknown): Record<AgentName, boolean> {
  const defaults = defaultAgentEnabled();
  if (!value || typeof value !== 'object') {
    return defaults;
  }

  const candidate = value as Record<string, unknown>;
  return {
    claude: typeof candidate.claude === 'boolean' ? candidate.claude : defaults.claude,
    codex: typeof candidate.codex === 'boolean' ? candidate.codex : defaults.codex,
    kimi: typeof candidate.kimi === 'boolean' ? candidate.kimi : defaults.kimi
  };
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return fallback;
    }
    throw error;
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  const directory = path.dirname(filePath);
  const tempFile = path.join(directory, `${path.basename(filePath)}.tmp`);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(tempFile, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(tempFile, filePath);
}

function defaultBaseDir(): string {
  return path.join(os.homedir(), '.agent-team');
}
