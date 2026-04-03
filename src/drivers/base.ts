import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import readline from 'node:readline';

import type { AgentDriver, AgentEvent, SendOptions } from '../types.js';

class AsyncEventQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private resolvers: Array<(result: IteratorResult<T>) => void> = [];
  private ended = false;

  push(item: T): void {
    const resolver = this.resolvers.shift();
    if (resolver) {
      resolver({ value: item, done: false });
      return;
    }
    this.items.push(item);
  }

  end(): void {
    this.ended = true;
    while (this.resolvers.length > 0) {
      const resolver = this.resolvers.shift();
      resolver?.({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.items.length > 0) {
          return Promise.resolve({ value: this.items.shift() as T, done: false });
        }
        if (this.ended) {
          return Promise.resolve({ value: undefined, done: true });
        }
        return new Promise<IteratorResult<T>>((resolve) => {
          this.resolvers.push(resolve);
        });
      }
    };
  }
}

export abstract class BaseJsonlDriver implements AgentDriver {
  abstract readonly name: AgentDriver['name'];
  abstract readonly displayName: string;
  protected abstract readonly binary: string;

  private readonly processes = new Map<string, ChildProcessByStdio<null, Readable, Readable>>();

  async *send(opts: SendOptions): AsyncIterable<AgentEvent> {
    const queue = new AsyncEventQueue<AgentEvent>();
    let sawStdoutEvent = false;
    let sawDoneEvent = false;
    const child = spawn(this.binary, this.buildArgs(opts), {
      cwd: opts.workdir,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    this.processes.set(opts.runId, child);

    const stdout = readline.createInterface({ input: child.stdout });
    stdout.on('line', (line) => {
      if (!line.trim()) {
        return;
      }

      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        for (const event of this.mapLine(parsed)) {
          sawStdoutEvent = true;
          if (event.type === 'done') {
            sawDoneEvent = true;
          }
          queue.push(event);
        }
      } catch {
        sawStdoutEvent = true;
        queue.push({ type: 'text', content: line });
      }
    });

    const stderr = readline.createInterface({ input: child.stderr });
    stderr.on('line', (line) => {
      const content = line.trim();
      if (content) {
        queue.push({ type: 'thinking', content: `[stderr] ${content}` });
      }
    });

    child.on('error', (error) => {
      queue.push({ type: 'error', message: error.message });
    });

    child.on('close', (code, signal) => {
      this.processes.delete(opts.runId);
      if (!code && this.shouldTreatEmptyOutputAsError() && !sawStdoutEvent && !sawDoneEvent) {
        queue.push({
          type: 'error',
          message: `${this.displayName} exited without any JSON/text output. Check CLI auth, network access, or local plugin startup.`
        });
      }
      if (code && code !== 0) {
        queue.push({
          type: 'error',
          message: `${this.displayName} exited with code ${code}${signal ? ` (${signal})` : ''}.`
        });
      }
      stdout.close();
      stderr.close();
      queue.end();
    });

    for await (const item of queue) {
      yield item;
    }
  }

  async abort(runId: string): Promise<void> {
    const child = this.processes.get(runId);
    if (!child || child.killed) {
      return;
    }

    child.kill('SIGINT');
  }

  async isAvailable(): Promise<boolean> {
    const child = spawn('bash', ['-lc', `command -v ${this.binary}`], {
      env: process.env,
      stdio: ['ignore', 'ignore', 'ignore']
    });

    return await new Promise<boolean>((resolve) => {
      child.on('close', (code) => resolve(code === 0));
      child.on('error', () => resolve(false));
    });
  }

  protected abstract buildArgs(opts: SendOptions): string[];

  protected shouldTreatEmptyOutputAsError(): boolean {
    return false;
  }

  protected mapLine(record: Record<string, unknown>): AgentEvent[] {
    const nested = unwrapEventRecord(record);
    const source = nested ?? record;
    const type = getString(source.type) ?? getString(source.event);
    const content = getString(source.content) ?? getString(source.message) ?? getString(source.text);

    if (type === 'assistant') {
      return mapAnthropicAssistantEvent(source);
    }

    if (type === 'message') {
      return mapMessageEvent(source);
    }

    if (type === 'thinking' || type === 'reasoning') {
      return content ? [{ type: 'thinking', content }] : [];
    }

    if (type === 'tool_use') {
      const tool = getString(source.tool) ?? getString(source.name);
      return tool ? [{ type: 'tool_use', tool, input: source.input ?? source.arguments ?? {} }] : [];
    }

    if (type === 'tool_result') {
      const tool = getString(source.tool) ?? getString(source.name) ?? getString(source.tool_use_id) ?? 'tool';
      const output = stringifyValue(source.output ?? source.result ?? source.content ?? '');
      return [{ type: 'tool_result', tool, output }];
    }

    if (type === 'function_call') {
      const tool = getString(source.name);
      return tool ? [{ type: 'tool_use', tool, input: maybeParseJson(source.arguments) ?? source.arguments ?? {} }] : [];
    }

    if (type === 'function_call_output') {
      const tool = getString(source.name) ?? getString(source.call_id) ?? 'function_call';
      const output = stringifyValue(source.output ?? '');
      return [{ type: 'tool_result', tool, output }];
    }

    if (type === 'result') {
      const subtype = getString(source.subtype);
      const sessionId =
        getString(source.sessionId) ??
        getString(source.session_id) ??
        getString((source.output as Record<string, unknown> | undefined)?.session_id) ??
        getString((source.output as Record<string, unknown> | undefined)?.sessionId);

      if (subtype?.startsWith('error')) {
        return [{ type: 'error', message: getString(source.error) ?? 'Unknown driver error.' }];
      }

      return sessionId ? [{ type: 'done', sessionId }] : [];
    }

    if (type === 'done' || type === 'completed') {
      const sessionId =
        getString(source.sessionId) ??
        getString(source.session_id) ??
        getString((source.output as Record<string, unknown> | undefined)?.session_id) ??
        getString((source.output as Record<string, unknown> | undefined)?.sessionId);

      return sessionId ? [{ type: 'done', sessionId }] : [];
    }

    if (type === 'error') {
      return [{ type: 'error', message: content ?? 'Unknown driver error.' }];
    }

    return content ? [{ type: 'text', content }] : [];
  }
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function stringifyValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  return JSON.stringify(value, null, 2);
}

function mapAnthropicAssistantEvent(record: Record<string, unknown>): AgentEvent[] {
  const message = isRecord(record.message) ? record.message : null;
  const content = Array.isArray(message?.content) ? message.content : [];
  const events: AgentEvent[] = [];

  for (const item of content) {
    if (!isRecord(item)) {
      continue;
    }

    const type = getString(item.type);
    if (type === 'text') {
      const text = getString(item.text);
      if (text) {
        events.push({ type: 'text', content: text });
      }
      continue;
    }

    if (type === 'tool_use') {
      const tool = getString(item.name);
      if (tool) {
        events.push({ type: 'tool_use', tool, input: item.input ?? {} });
      }
    }
  }

  return events;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function mapMessageEvent(record: Record<string, unknown>): AgentEvent[] {
  const role = getString(record.role);
  if (role && role !== 'assistant') {
    return [];
  }

  const directContent = getString(record.content);
  if (directContent) {
    return [{ type: 'text', content: directContent }];
  }

  const content = Array.isArray(record.content) ? record.content : [];
  const events: AgentEvent[] = [];

  for (const item of content) {
    if (!isRecord(item)) {
      continue;
    }

    const itemType = getString(item.type);
    if (itemType === 'output_text' || itemType === 'text' || itemType === 'input_text') {
      const text = getString(item.text);
      if (text) {
        events.push({
          type: itemType === 'output_text' && getString(record.phase) === 'commentary' ? 'thinking' : 'text',
          content: text
        });
      }
    }
  }

  return events;
}

function unwrapEventRecord(record: Record<string, unknown>): Record<string, unknown> | null {
  const type = getString(record.type);

  if (type === 'response_item' && isRecord(record.payload)) {
    return record.payload;
  }

  if (type === 'event_msg' && isRecord(record.payload)) {
    return record.payload;
  }

  return null;
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
