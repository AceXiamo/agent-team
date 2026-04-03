import type { SendOptions } from '../types.js';
import type { AgentEvent } from '../types.js';
import { BaseJsonlDriver, extractUsage } from './base.js';

export class CodexDriver extends BaseJsonlDriver {
  readonly name = 'codex';
  readonly displayName = 'Codex';
  protected readonly binary = 'codex';

  protected override shouldTreatEmptyOutputAsError(): boolean {
    return true;
  }

  protected buildArgs(opts: SendOptions): string[] {
    if (opts.sessionId) {
      const args = [
        'exec',
        'resume',
        opts.sessionId,
        opts.prompt,
        '--json',
        '--dangerously-bypass-approvals-and-sandbox'
      ];
      if (opts.model) {
        args.push('--model', opts.model);
      }
      return args;
    }

    const args = [
      'exec',
      opts.prompt,
      '--json',
      '--dangerously-bypass-approvals-and-sandbox',
      '--skip-git-repo-check',
      '-C',
      opts.workdir
    ];
    if (opts.model) {
      args.push('--model', opts.model);
    }
    return args;
  }

  protected override mapLine(record: Record<string, unknown>): AgentEvent[] {
    const type = readString(record.type);

    if (type === 'done') {
      const sessionId = readString(record.session_id) ?? readString(record.sessionId);
      return sessionId ? [{ type: 'done', sessionId }] : [];
    }

    if (type === 'thread.started') {
      const sessionId = readString(record.thread_id);
      return sessionId ? [{ type: 'done', sessionId }] : [];
    }

    if (type === 'item.completed') {
      return mapCompletedItem(record.item);
    }

    if (type === 'response_item') {
      return mapResponseItem(record.payload);
    }

    if (type === 'event_msg') {
      return mapEventMessage(record.payload);
    }

    if (type === 'turn.completed') {
      const usage = extractUsage(record);
      return usage ? [{ type: 'usage', usage }] : [];
    }

    if (type === 'turn.started' || type === 'turn_context') {
      return [];
    }

    return super.mapLine(record);
  }
}

function mapResponseItem(payload: unknown): AgentEvent[] {
  if (!isRecord(payload)) {
    return [];
  }

  const type = readString(payload.type);
  if (type === 'message') {
    const role = readString(payload.role);
    if (role && role !== 'assistant') {
      return [];
    }

    const content = Array.isArray(payload.content) ? payload.content : [];
    const events: AgentEvent[] = [];

    for (const item of content) {
      if (!isRecord(item)) {
        continue;
      }
      const itemType = readString(item.type);
      if (itemType === 'output_text') {
        const text = readString(item.text);
        if (text) {
          events.push({ type: 'text', content: text });
        }
      }
    }

    return events;
  }

  if (type === 'function_call') {
    const tool = readString(payload.name);
    if (!tool) {
      return [];
    }
    return [
      {
        type: 'tool_use',
        tool,
        input: maybeParseJson(payload.arguments) ?? payload.arguments ?? {}
      }
    ];
  }

  if (type === 'function_call_output') {
    return [
      {
        type: 'tool_result',
        tool: readString(payload.name) ?? readString(payload.call_id) ?? 'function_call',
        output: stringify(payload.output ?? '')
      }
    ];
  }

  return [];
}

function mapEventMessage(payload: unknown): AgentEvent[] {
  if (!isRecord(payload)) {
    return [];
  }

  const type = readString(payload.type);
  if (type === 'agent_message') {
    const message = readString(payload.message);
    return message ? [{ type: 'text', content: message }] : [];
  }

  if (type === 'agent_reasoning') {
    const text = readString(payload.text);
    return text ? [{ type: 'thinking', content: text }] : [];
  }

  if (type === 'task_complete') {
    const message = readString(payload.last_agent_message);
    return message ? [{ type: 'text', content: message }] : [];
  }

  return [];
}

function mapCompletedItem(item: unknown): AgentEvent[] {
  if (!isRecord(item)) {
    return [];
  }

  const itemType = readString(item.type);
  if (itemType === 'agent_message') {
    const text = readString(item.text);
    return text ? [{ type: 'text', content: text }] : [];
  }

  if (itemType === 'reasoning') {
    const text = readString(item.text);
    return text ? [{ type: 'thinking', content: text }] : [];
  }

  if (itemType === 'function_call') {
    const tool = readString(item.name);
    return tool
      ? [
          {
            type: 'tool_use',
            tool,
            input: maybeParseJson(item.arguments) ?? item.arguments ?? {}
          }
        ]
      : [];
  }

  if (itemType === 'function_call_output') {
    return [
      {
        type: 'tool_result',
        tool: readString(item.name) ?? readString(item.call_id) ?? 'function_call',
        output: stringify(item.output ?? '')
      }
    ];
  }

  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function maybeParseJson(value: unknown): unknown {
  if (typeof value !== 'string') {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function stringify(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  return JSON.stringify(value, null, 2);
}
