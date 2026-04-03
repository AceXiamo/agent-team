import crypto from 'node:crypto';

import type { AgentName, AgentState, Message, Sender } from '../types.js';

export const AGENTS: AgentName[] = ['claude', 'codex', 'kimi'];

export const AGENT_LABELS: Record<AgentName, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  kimi: 'Kimi'
};

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
    queueLength: 0,
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
