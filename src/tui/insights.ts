import { parseUserInput } from '../core/commandParser.js';
import { formatTimestamp, senderLabel } from '../core/utils.js';

import type { AgentName, AgentState, Message, MessageContent, TokenUsage } from '../types.js';

export interface ConversationOverview {
  totalMessages: number;
  liveMessages: number;
  errorMessages: number;
  toolEvents: number;
  delegateEvents: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
}

export interface FocusedMessageInsight {
  title: string;
  detail: string;
  preview: string;
}

export interface DraftInsight {
  state: 'neutral' | 'ready' | 'error';
  title: string;
  detail: string;
}

export function collectConversationOverview(messages: Message[]): ConversationOverview {
  return messages.reduce<ConversationOverview>(
    (overview, message) => {
      overview.totalMessages += 1;
      if (message.status === 'streaming') {
        overview.liveMessages += 1;
      }
      if (message.status === 'error') {
        overview.errorMessages += 1;
      }

      for (const content of message.content) {
        if (content.type === 'tool_use' || content.type === 'tool_result') {
          overview.toolEvents += 1;
        }
        if (content.type === 'delegate') {
          overview.delegateEvents += 1;
        }
      }

      if (message.usage) {
        overview.totalInputTokens += message.usage.inputTokens ?? 0;
        overview.totalOutputTokens += message.usage.outputTokens ?? 0;
        overview.totalCostUsd += message.usage.costUsd ?? 0;
      }

      return overview;
    },
    {
      totalMessages: 0,
      liveMessages: 0,
      errorMessages: 0,
      toolEvents: 0,
      delegateEvents: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostUsd: 0
    }
  );
}

export function describeFocusedMessage(messages: Message[], selectedMessageId: string | null): FocusedMessageInsight {
  if (messages.length === 0) {
    return {
      title: 'Focus empty',
      detail: 'No messages yet. Start with a single target like @Codex inspect src/',
      preview: 'The panel will summarize the selected message here once the thread starts.'
    };
  }

  const selectedIndex = selectedMessageId ? messages.findIndex((message) => message.id === selectedMessageId) : messages.length - 1;
  const index = selectedIndex >= 0 ? selectedIndex : messages.length - 1;
  const message = messages[index] ?? messages[messages.length - 1]!;
  const blockSummary = summarizeContentTypes(message.content);
  const usageSummary = formatUsage(message.usage);
  const detailParts = [
    `${index + 1}/${messages.length}`,
    senderLabel(message.sender),
    `${formatTimestamp(message.timestamp)} ${message.status}`
  ];

  if (blockSummary) {
    detailParts.push(blockSummary);
  }
  if (usageSummary) {
    detailParts.push(usageSummary);
  }

  return {
    title: `Focus ${senderLabel(message.sender)}`,
    detail: detailParts.join(' • '),
    preview: summarizePreview(message.content)
  };
}

export function describeDraft(input: string, agents: Record<AgentName, AgentState>): DraftInsight {
  const trimmed = input.trim();
  if (!trimmed) {
    return {
      state: 'neutral',
      title: 'Ready for a new turn',
      detail: 'Use @Agent to send work, or /sessions, /new, /switch, /reset to manage context.'
    };
  }

  if (!trimmed.includes('@') && !trimmed.startsWith('/')) {
    return {
      state: 'neutral',
      title: 'Add one target agent',
      detail: 'Messages require exactly one @Claude, @Codex, or @Kimi mention.'
    };
  }

  const parsed = parseUserInput(trimmed);
  switch (parsed.type) {
    case 'send': {
      const agent = agents[parsed.target];
      return {
        state: agent.available ? 'ready' : 'error',
        title: `Enter sends to ${senderLabel(parsed.target)}`,
        detail: `${describeAgent(agent)} • ${parsed.prompt.length} chars • ${agent.sessionId ? 'resume session' : 'start fresh session'}`
      };
    }
    case 'sessions':
      return {
        state: 'ready',
        title: 'Enter lists workspace sessions',
        detail: 'Use this when you need ids before switching or auditing previous work.'
      };
    case 'new_session':
      return {
        state: 'ready',
        title: 'Enter creates a new session',
        detail: parsed.title ? `New title: ${parsed.title}` : 'No title provided yet; the app will create a default title.'
      };
    case 'switch_session':
      return {
        state: 'ready',
        title: 'Enter switches the active session',
        detail: `Target session id: ${parsed.sessionId}`
      };
    case 'reset':
      return {
        state: 'ready',
        title: `Enter resets ${senderLabel(parsed.target)}`,
        detail: 'Clears the bound agent session for the current workspace session and drops its queue.'
      };
    case 'error':
      return {
        state: 'error',
        title: 'Draft needs adjustment',
        detail: parsed.message
      };
  }
}

function describeAgent(agent: AgentState): string {
  if (!agent.available) {
    return 'agent unavailable';
  }

  if (agent.status === 'running') {
    return agent.queueLength > 0 ? `running • queue ${agent.queueLength}` : 'running now';
  }

  if (agent.status === 'error') {
    return agent.lastError ? `error • ${agent.lastError}` : 'agent in error state';
  }

  return agent.queueLength > 0 ? `ready • queue ${agent.queueLength}` : 'ready';
}

function summarizeContentTypes(content: MessageContent[]): string {
  const labels = new Set<string>();

  for (const block of content) {
    switch (block.type) {
      case 'text':
        labels.add('reply');
        break;
      case 'thinking':
        labels.add('thinking');
        break;
      case 'tool_use':
      case 'tool_result':
        labels.add('tools');
        break;
      case 'delegate':
        labels.add('delegation');
        break;
      case 'system':
        labels.add('system');
        break;
    }
  }

  return [...labels].join(' + ');
}

function summarizePreview(content: MessageContent[]): string {
  const text = content
    .map((block) => {
      switch (block.type) {
        case 'text':
          return block.text;
        case 'thinking':
          return block.text;
        case 'tool_use':
          return `tool ${block.tool}`;
        case 'tool_result':
          return `result ${block.tool}`;
        case 'delegate':
          return `delegated to ${block.target}: ${block.message}`;
        case 'system':
          return block.text;
      }
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) {
    return 'Waiting for output...';
  }

  return text.length > 140 ? `${text.slice(0, 137)}...` : text;
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

  return parts.length > 0 ? `tokens ${parts.join(' • ')}` : '';
}
