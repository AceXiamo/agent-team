import type { SendOptions } from '../types.js';
import { BaseJsonlDriver } from './base.js';

export class ClaudeDriver extends BaseJsonlDriver {
  readonly name = 'claude';
  readonly displayName = 'Claude Code';
  protected readonly binary = 'claude';

  protected buildArgs(opts: SendOptions): string[] {
    const args = ['-p', opts.prompt, '--output-format', 'stream-json', '--verbose'];
    if (opts.sessionId) {
      args.push('--resume', opts.sessionId);
    }
    return args;
  }
}
