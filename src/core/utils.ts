import crypto from 'node:crypto';

import type { AgentName, AgentState, Message, Sender } from '../types.js';

export const AGENTS: AgentName[] = ['claude', 'codex', 'kimi', 'copilot'];

export const AGENT_LABELS: Record<AgentName, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  kimi: 'Kimi',
  copilot: 'Copilot CLI'
};

export function createAgentRecord<T>(create: (agent: AgentName) => T): Record<AgentName, T> {
  return Object.fromEntries(AGENTS.map((agent) => [agent, create(agent)])) as Record<AgentName, T>;
}

export function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function hashWorkdir(workdir: string): string {
  return crypto.createHash('sha256').update(workdir).digest('hex');
}

export function createEmptyAgentState(name: AgentName): AgentState {
  return {
    name,
    sessionId: null,
    status: 'idle',
    available: false,
    enabled: true,
    queueLength: 0,
    pendingReviewCount: 0,
    activeMode: null,
    activeRunId: null,
    lastError: null
  };
}

export function senderLabel(sender: Sender): string {
  if (sender === 'human') {
    return 'You';
  }
  if (sender === 'system') {
    return 'System';
  }
  return AGENT_LABELS[sender];
}

export function formatTimestamp(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
}

export function cloneMessage(message: Message): Message {
  return {
    ...message,
    timestamp: new Date(message.timestamp),
    content: message.content.map((item) => ({ ...item }))
  };
}

export function summarizeText(value: string, limit: number): string {
  const singleLine = value.replace(/\s+/g, ' ').trim();
  if (!singleLine) {
    return '';
  }

  return singleLine.length > limit ? `${singleLine.slice(0, limit - 3)}...` : singleLine;
}
