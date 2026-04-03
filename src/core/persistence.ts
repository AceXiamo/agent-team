import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { AgentName, Message, PersistedMessage } from '../types.js';
import { AGENTS } from './utils.js';

export class SessionStore {
  private readonly filePath: string;
  private writePromise = Promise.resolve();

  constructor(baseDir = defaultBaseDir()) {
    this.filePath = path.join(baseDir, 'sessions.json');
  }

  async load(workdirHash: string): Promise<Partial<Record<AgentName, string>>> {
    const data = await readJson<Record<string, Partial<Record<AgentName, string>>>>(this.filePath, {});
    return data[workdirHash] ?? {};
  }

  async set(workdirHash: string, agent: AgentName, sessionId: string): Promise<void> {
    await this.enqueueWrite(async () => {
      const data = await readJson<Record<string, Partial<Record<AgentName, string>>>>(this.filePath, {});
      data[workdirHash] ??= {};
      data[workdirHash]![agent] = sessionId;
      await writeJson(this.filePath, data);
    });
  }

  async clear(workdirHash: string, agent: AgentName): Promise<void> {
    await this.enqueueWrite(async () => {
      const data = await readJson<Record<string, Partial<Record<AgentName, string>>>>(this.filePath, {});
      if (!data[workdirHash]) {
        return;
      }
      delete data[workdirHash]![agent];
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

  async load(workdirHash: string): Promise<Message[]> {
    const filePath = this.getFilePath(workdirHash);
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

  async save(workdirHash: string, messages: Message[]): Promise<void> {
    const filePath = this.getFilePath(workdirHash);
    await fs.mkdir(this.messagesDir, { recursive: true });
    const payload = messages.map((message) => JSON.stringify(serializeMessage(message))).join('\n');
    await fs.writeFile(filePath, payload ? `${payload}\n` : '', 'utf8');
  }

  private getFilePath(workdirHash: string): string {
    return path.join(this.messagesDir, `${workdirHash}.jsonl`);
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

export function buildInitialAgentSessions(
  sessions: Partial<Record<AgentName, string>>
): Record<AgentName, string | null> {
  return Object.fromEntries(AGENTS.map((agent) => [agent, sessions[agent] ?? null])) as Record<
    AgentName,
    string | null
  >;
}
