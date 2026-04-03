import type { SendOptions } from '../types.js';
import { BaseJsonlDriver } from './base.js';

export class KimiDriver extends BaseJsonlDriver {
  readonly name = 'kimi';
  readonly displayName = 'Kimi';
  protected readonly binary = 'kimi';

  protected buildArgs(opts: SendOptions): string[] {
    const args = ['--print', '--prompt', opts.prompt, '--output-format', 'stream-json', '--work-dir', opts.workdir];
    if (opts.model) {
      args.push('--model', opts.model);
    }
    if (opts.sessionId) {
      args.push('--resume', opts.sessionId);
    }
    return args;
  }
}
