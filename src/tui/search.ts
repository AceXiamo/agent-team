import { senderLabel } from '../core/utils.js';
import type { Message, MessageContent } from '../types.js';

function contentText(block: MessageContent): string {
  switch (block.type) {
    case 'text':
    case 'thinking':
    case 'system':
      return block.text;
    case 'tool_use':
      return `${block.tool} ${JSON.stringify(block.input)}`;
    case 'tool_result':
      return `${block.tool} ${block.output}`;
    case 'delegate':
      return `${block.target} ${block.message}`;
  }
}

export function messageMatchesQuery(message: Message, query: string): boolean {
  const q = query.toLowerCase().trim();
  if (!q) return true;

  if (senderLabel(message.sender).toLowerCase().includes(q)) return true;
  if (message.status.toLowerCase().includes(q)) return true;

  for (const block of message.content) {
    if (contentText(block).toLowerCase().includes(q)) return true;
  }

  return false;
}
