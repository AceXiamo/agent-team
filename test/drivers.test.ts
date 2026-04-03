import { describe, expect, it } from 'vitest';

import { ClaudeDriver } from '../src/drivers/claude.js';
import { CopilotDriver } from '../src/drivers/copilot.js';
import { CodexDriver } from '../src/drivers/codex.js';
import { KimiDriver } from '../src/drivers/kimi.js';

describe('driver argument builders', () => {
  it('builds claude args', () => {
    const driver = new ClaudeDriver();
    expect(readBuildArgs(driver, { prompt: 'hello', runId: 'run-1', workdir: '/tmp' })).toEqual([
      '-p',
      'hello',
      '--output-format',
      'stream-json',
      '--verbose',
      '--dangerously-skip-permissions'
    ]);
  });

  it('builds claude args with model', () => {
    const driver = new ClaudeDriver();
    expect(readBuildArgs(driver, { prompt: 'hello', runId: 'run-1', workdir: '/tmp', model: 'sonnet' })).toEqual([
      '-p',
      'hello',
      '--output-format',
      'stream-json',
      '--verbose',
      '--dangerously-skip-permissions',
      '--model',
      'sonnet'
    ]);
  });

  it('builds codex resume args', () => {
    const driver = new CodexDriver();
    expect(
      readBuildArgs(driver, { prompt: 'follow-up', runId: 'run-1', workdir: '/tmp', sessionId: 'sess' })
    ).toEqual([
      'exec',
      'resume',
      'sess',
      'follow-up',
      '--json',
      '--dangerously-bypass-approvals-and-sandbox'
    ]);
  });

  it('builds codex args with model', () => {
    const driver = new CodexDriver();
    expect(readBuildArgs(driver, { prompt: 'hello', runId: 'run-1', workdir: '/tmp', model: 'gpt-5.4' })).toEqual([
      'exec',
      'hello',
      '--json',
      '--dangerously-bypass-approvals-and-sandbox',
      '--skip-git-repo-check',
      '-C',
      '/tmp',
      '--model',
      'gpt-5.4'
    ]);
  });

  it('builds kimi args', () => {
    const driver = new KimiDriver();
    expect(readBuildArgs(driver, { prompt: 'hello', runId: 'run-1', workdir: '/tmp' })).toEqual([
      '--print',
      '--prompt',
      'hello',
      '--output-format',
      'stream-json',
      '--work-dir',
      '/tmp'
    ]);
  });

  it('builds kimi resume args', () => {
    const driver = new KimiDriver();
    expect(
      readBuildArgs(driver, { prompt: 'follow-up', runId: 'run-1', workdir: '/tmp', sessionId: 'sess' })
    ).toEqual([
      '--print',
      '--prompt',
      'follow-up',
      '--output-format',
      'stream-json',
      '--work-dir',
      '/tmp',
      '--resume',
      'sess'
    ]);
  });

  it('builds kimi args with model', () => {
    const driver = new KimiDriver();
    expect(readBuildArgs(driver, { prompt: 'hello', runId: 'run-1', workdir: '/tmp', model: 'kimi-k2' })).toEqual([
      '--print',
      '--prompt',
      'hello',
      '--output-format',
      'stream-json',
      '--work-dir',
      '/tmp',
      '--model',
      'kimi-k2'
    ]);
  });

  it('builds copilot args', () => {
    const driver = new CopilotDriver();
    expect(readBuildArgs(driver, { prompt: 'hello', runId: 'run-1', workdir: '/tmp' })).toEqual([
      '--prompt',
      'hello',
      '--output-format',
      'json',
      '--allow-all',
      '--stream',
      'off',
      '--no-color'
    ]);
  });

  it('builds copilot resume args', () => {
    const driver = new CopilotDriver();
    expect(
      readBuildArgs(driver, { prompt: 'follow-up', runId: 'run-1', workdir: '/tmp', sessionId: 'sess' })
    ).toEqual([
      '--prompt',
      'follow-up',
      '--output-format',
      'json',
      '--allow-all',
      '--stream',
      'off',
      '--no-color',
      '--resume=sess'
    ]);
  });

  it('builds copilot args with model', () => {
    const driver = new CopilotDriver();
    expect(readBuildArgs(driver, { prompt: 'hello', runId: 'run-1', workdir: '/tmp', model: 'gpt-5.2' })).toEqual([
      '--prompt',
      'hello',
      '--output-format',
      'json',
      '--allow-all',
      '--stream',
      'off',
      '--no-color',
      '--model',
      'gpt-5.2'
    ]);
  });
});

describe('driver line normalization', () => {
  it('normalizes done session ids', () => {
    const driver = new ClaudeDriver();
    expect(readMapLine(driver, { type: 'result', session_id: 'sess-1', subtype: 'success' })).toEqual([
      { type: 'done', sessionId: 'sess-1' }
    ]);
  });

  it('normalizes claude assistant tool events', () => {
    const driver = new ClaudeDriver();
    expect(
      readMapLine(driver, {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'x' } }]
        }
      })
    ).toEqual([
      { type: 'tool_use', tool: 'Read', input: { file_path: 'x' } }
    ]);
  });

  it('normalizes codex function call events', () => {
    const driver = new CodexDriver();
    expect(
      readMapLine(driver, {
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'shell',
          arguments: '{"command":"ls"}'
        }
      })
    ).toEqual([
      { type: 'tool_use', tool: 'shell', input: { command: 'ls' } }
    ]);
  });

  it('normalizes codex response_item assistant messages', () => {
    const driver = new CodexDriver();
    expect(
      readMapLine(driver, {
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'hey from codex' }]
        }
      })
    ).toEqual([{ type: 'text', content: 'hey from codex' }]);
  });

  it('normalizes codex event_msg agent messages', () => {
    const driver = new CodexDriver();
    expect(
      readMapLine(driver, {
        type: 'event_msg',
        payload: {
          type: 'agent_message',
          message: 'hello from event message'
        }
      })
    ).toEqual([{ type: 'text', content: 'hello from event message' }]);
  });

  it('normalizes codex completed agent messages', () => {
    const driver = new CodexDriver();
    expect(
      readMapLine(driver, {
        type: 'item.completed',
        item: {
          id: 'item_0',
          type: 'agent_message',
          text: 'Hey. What do you need?'
        }
      })
    ).toEqual([{ type: 'text', content: 'Hey. What do you need?' }]);
  });

  it('captures codex thread id as session id', () => {
    const driver = new CodexDriver();
    expect(
      readMapLine(driver, {
        type: 'thread.started',
        thread_id: '019d5375-616a-72f2-90da-14050631cf4e'
      })
    ).toEqual([{ type: 'done', sessionId: '019d5375-616a-72f2-90da-14050631cf4e' }]);
  });

  it('normalizes codex event_msg reasoning', () => {
    const driver = new CodexDriver();
    expect(
      readMapLine(driver, {
        type: 'event_msg',
        payload: {
          type: 'agent_reasoning',
          text: '**thinking**'
        }
      })
    ).toEqual([{ type: 'thinking', content: '**thinking**' }]);
  });

  it('ignores codex non-assistant message payloads', () => {
    const driver = new CodexDriver();
    expect(
      readMapLine(driver, {
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'ignored' }]
        }
      })
    ).toEqual([]);
  });

  it('normalizes codex function call output payloads', () => {
    const driver = new CodexDriver();
    expect(
      readMapLine(driver, {
        type: 'response_item',
        payload: {
          type: 'function_call_output',
          call_id: 'call_123',
          output: 'done'
        }
      })
    ).toEqual([{ type: 'tool_result', tool: 'call_123', output: 'done' }]);
  });

  it('normalizes claude assistant text events', () => {
    const driver = new ClaudeDriver();
    expect(
      readMapLine(driver, {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'hello' }]
        }
      })
    ).toEqual([
      { type: 'text', content: 'hello' }
    ]);
  });

  it('normalizes explicit tool_use events', () => {
    const driver = new ClaudeDriver();
    expect(readMapLine(driver, { type: 'tool_use', tool: 'read_file', input: { path: 'x' } })).toEqual([
      { type: 'tool_use', tool: 'read_file', input: { path: 'x' } }
    ]);
  });

  it('normalizes copilot assistant messages and usage', () => {
    const driver = new CopilotDriver();
    expect(
      readMapLine(driver, {
        type: 'assistant.message',
        data: {
          content: 'hi from copilot',
          outputTokens: 6
        }
      })
    ).toEqual([
      { type: 'text', content: 'hi from copilot' },
      { type: 'usage', usage: { outputTokens: 6 } }
    ]);
  });

  it('normalizes copilot reasoning events', () => {
    const driver = new CopilotDriver();
    expect(
      readMapLine(driver, {
        type: 'assistant.reasoning',
        data: {
          content: 'Let me inspect the repo.'
        }
      })
    ).toEqual([{ type: 'thinking', content: 'Let me inspect the repo.' }]);
  });

  it('normalizes copilot tool execution events', () => {
    const driver = new CopilotDriver();
    expect(
      readMapLine(driver, {
        type: 'tool.execution_start',
        data: {
          toolName: 'bash',
          arguments: {
            command: 'ls'
          }
        }
      })
    ).toEqual([{ type: 'tool_use', tool: 'bash', input: { command: 'ls' } }]);

    expect(
      readMapLine(driver, {
        type: 'tool.execution_complete',
        data: {
          toolName: 'bash',
          result: {
            detailedContent: 'README.md'
          }
        }
      })
    ).toEqual([{ type: 'tool_result', tool: 'bash', output: 'README.md' }]);
  });

  it('captures copilot result session ids', () => {
    const driver = new CopilotDriver();
    expect(
      readMapLine(driver, {
        type: 'result',
        sessionId: 'copilot-session',
        exitCode: 0
      })
    ).toEqual([{ type: 'done', sessionId: 'copilot-session' }]);
  });
});

function readBuildArgs(driver: object, input: unknown): string[] {
  return (driver as { buildArgs: (value: unknown) => string[] }).buildArgs(input);
}

function readMapLine(driver: object, input: unknown): unknown {
  return (driver as { mapLine: (value: unknown) => unknown }).mapLine(input);
}
