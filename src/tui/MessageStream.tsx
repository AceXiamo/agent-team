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
  const visibleCount = Math.max(5, rows - 14);
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
  const hiddenAbove = start;
  const hiddenBelow = Math.max(0, messages.length - (start + visibleMessages.length));
  const focusLabel =
    selectedIndex === -1 || messages.length === 0 ? 'focus tail' : `focus ${selectedIndex + 1}/${messages.length}`;

  return (
    <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor="blue" paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold color="blue">
          Conversation
        </Text>
        <Text dimColor>
          {messages.length} messages • {focusLabel}
        </Text>
      </Box>
      {visibleMessages.length === 0 ? (
        <EmptyState />
      ) : (
        <Box flexDirection="column">
          {hiddenAbove > 0 ? <Text dimColor>{`↑ ${hiddenAbove} earlier message${hiddenAbove === 1 ? '' : 's'}`}</Text> : null}
          {visibleMessages.map((message) => (
            <MessageBubble key={message.id} message={message} selected={message.id === selectedMessageId} />
          ))}
          {hiddenBelow > 0 ? <Text dimColor>{`↓ ${hiddenBelow} newer message${hiddenBelow === 1 ? '' : 's'}`}</Text> : null}
        </Box>
      )}
    </Box>
  );
}

function EmptyState(): React.JSX.Element {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>No messages yet.</Text>
      <Text dimColor>Send one targeted message like `@Codex inspect src/` to start the thread.</Text>
      <Text dimColor>Delegations, tool activity, queueing, and agent replies will stream here.</Text>
    </Box>
  );
}
