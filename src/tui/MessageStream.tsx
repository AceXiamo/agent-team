import React from 'react';
import { Box, Text } from 'ink';

import type { Message } from '../types.js';
import { MessageBubble } from './MessageBubble.js';

interface MessageStreamProps {
  messages: Message[];
  selectedMessageId: string | null;
}

export function MessageStream({ messages, selectedMessageId }: MessageStreamProps): React.JSX.Element {
  const rows = process.stdout.rows ?? 24;
  const visibleCount = Math.max(4, rows - 10);
  const selectedIndex = selectedMessageId ? messages.findIndex((message) => message.id === selectedMessageId) : messages.length - 1;

  let start = Math.max(0, messages.length - visibleCount);
  if (selectedIndex !== -1) {
    if (selectedIndex < start) {
      start = selectedIndex;
    } else if (selectedIndex >= start + visibleCount) {
      start = selectedIndex - visibleCount + 1;
    }
  }

  const visibleMessages = messages.slice(start, start + visibleCount);

  return (
    <Box flexDirection="column" flexGrow={1} borderStyle="round" paddingX={1}>
      {visibleMessages.length === 0 ? (
        <Text dimColor>No messages yet. Send `@Codex ...` or another single target agent.</Text>
      ) : (
        visibleMessages.map((message) => (
          <MessageBubble key={message.id} message={message} selected={message.id === selectedMessageId} />
        ))
      )}
    </Box>
  );
}
