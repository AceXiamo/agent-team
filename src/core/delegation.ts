import type { AgentName, DelegateRequest } from '../types.js';
import { AGENTS } from './utils.js';

const BLOCK_START = '```agent-team';
const BLOCK_END = '```';

export interface DelegationConsumeResult {
  displayText: string;
  requests: DelegateRequest[];
  errors: string[];
}

export class DelegationParser {
  private buffer = '';

  consume(chunk: string): DelegationConsumeResult {
    this.buffer += chunk;
    return this.drain(false);
  }

  finalize(): DelegationConsumeResult {
    return this.drain(true);
  }

  private drain(flushAll: boolean): DelegationConsumeResult {
    let displayText = '';
    const requests: DelegateRequest[] = [];
    const errors: string[] = [];

    while (true) {
      const startIndex = this.buffer.indexOf(BLOCK_START);

      if (startIndex === -1) {
        if (flushAll) {
          displayText += this.buffer;
          this.buffer = '';
        } else {
          const flushLength = this.buffer.length - longestSuffixPrefix(this.buffer, BLOCK_START);
          displayText += this.buffer.slice(0, flushLength);
          this.buffer = this.buffer.slice(flushLength);
        }
        break;
      }

      if (startIndex > 0) {
        displayText += this.buffer.slice(0, startIndex);
        this.buffer = this.buffer.slice(startIndex);
      }

      const endIndex = this.buffer.indexOf(BLOCK_END, BLOCK_START.length);
      if (endIndex === -1) {
        if (flushAll) {
          displayText += this.buffer;
          this.buffer = '';
        }
        break;
      }

      const blockBody = this.buffer.slice(BLOCK_START.length, endIndex).trim();
      const request = safeParseDelegateRequest(blockBody);
      if (request) {
        requests.push(request);
      } else {
        errors.push('Ignored invalid delegate request block.');
      }

      this.buffer = this.buffer.slice(endIndex + BLOCK_END.length);
    }

    return { displayText, requests, errors };
  }
}

function safeParseDelegateRequest(body: string): DelegateRequest | null {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    if (parsed.action !== 'delegate') {
      return null;
    }

    const target = parsed.target;
    const message = parsed.message;
    if (!isAgentName(target) || typeof message !== 'string' || !message.trim()) {
      return null;
    }

    return { target, message: message.trim() };
  } catch {
    return null;
  }
}

function isAgentName(value: unknown): value is AgentName {
  return typeof value === 'string' && AGENTS.includes(value as AgentName);
}

function longestSuffixPrefix(value: string, prefixTarget: string): number {
  const limit = Math.min(value.length, prefixTarget.length - 1);
  for (let length = limit; length > 0; length -= 1) {
    if (value.endsWith(prefixTarget.slice(0, length))) {
      return length;
    }
  }
  return 0;
}
