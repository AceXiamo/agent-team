import type { SendOptions } from '../types.js';
import type { AgentEvent } from '../types.js';
import { BaseJsonlDriver } from './base.js';

export class CopilotDriver extends BaseJsonlDriver {
  readonly name = 'copilot';
  readonly displayName = 'Copilot CLI';
  protected readonly binary = 'copilot';

  protected override shouldTreatEmptyOutputAsError(): boolean {
    return true;
  }

  protected buildArgs(opts: SendOptions): string[] {
    const args = [
      '--prompt',
      opts.prompt,
      '--output-format',
      'json',
      '--allow-all',
      '--stream',
      'off',
      '--no-color'
    ];

    if (opts.sessionId) {
      args.push(`--resume=${opts.sessionId}`);
    }

    return args;
  }

  protected override mapLine(record: Record<string, unknown>): AgentEvent[] {
    const type = readString(record.type);

    if (type === 'assistant.message') {
      return mapAssistantMessage(record.data);
    }

    if (type === 'assistant.reasoning') {
      const data = asRecord(record.data);
      const content = readString(data?.content);
      return content ? [{ type: 'thinking', content }] : [];
    }

    if (type === 'tool.execution_start') {
      const data = asRecord(record.data);
      const tool = readString(data?.toolName);
      return tool ? [{ type: 'tool_use', tool, input: data?.arguments ?? {} }] : [];
    }

    if (type === 'tool.execution_complete') {
      return mapToolExecutionComplete(record.data);
    }

    if (type === 'result') {
      const sessionId = readString(record.sessionId);
      const exitCode = typeof record.exitCode === 'number' ? record.exitCode : 0;

      if (exitCode !== 0) {
        return [{ type: 'error', message: `Copilot CLI reported exit code ${exitCode}.` }];
      }

      return sessionId ? [{ type: 'done', sessionId }] : [];
    }

    return [];
  }
}

function mapAssistantMessage(payload: unknown): AgentEvent[] {
  const data = asRecord(payload);
  if (!data) {
    return [];
  }

  const events: AgentEvent[] = [];
  const content = readString(data.content);
  if (content) {
    events.push({ type: 'text', content });
  }

  if (typeof data.outputTokens === 'number') {
    events.push({ type: 'usage', usage: { outputTokens: data.outputTokens } });
  }

  return events;
}

function mapToolExecutionComplete(payload: unknown): AgentEvent[] {
  const data = asRecord(payload);
  if (!data) {
    return [];
  }

  const result = asRecord(data.result);
  const tool =
    readString(data.toolName) ??
    readString(data.toolCallId) ??
    'tool';
  const output =
    readString(result?.detailedContent) ??
    readString(result?.content) ??
    JSON.stringify(result ?? {}, null, 2);

  return [{ type: 'tool_result', tool, output }];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
