import React from 'react';
import { Box, Text } from 'ink';

import type { Message } from '../types.js';
import { MessageBubble } from './MessageBubble.js';
import { frame, pulse } from './motion.js';

interface MessageStreamProps {
  messages: Message[];
  selectedMessageId: string | null;
  uiBeat: number;
}

export function MessageStream({ messages, selectedMessageId, uiBeat }: MessageStreamProps): React.JSX.Element {
  const rows = process.stdout.rows ?? 24;
  const visibleCount = Math.max(4, rows - 24);
  const selectedIndex = selectedMessageId ? messages.findIndex((message) => message.id === selectedMessageId) : messages.length - 1;
  const liveCount = messages.filter((message) => message.status === 'streaming').length;

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
  const windowStart = visibleMessages.length === 0 ? 0 : start + 1;
  const windowEnd = start + visibleMessages.length;

  return (
    <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor="blue" paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold color="blue">
          {pulse(uiBeat)} Conversation
        </Text>
        <Text dimColor>
          {messages.length} messages • {focusLabel} • {liveCount > 0 ? `${liveCount} live` : 'idle'}
        </Text>
      </Box>
      <Box justifyContent="space-between">
        <Text dimColor>
          {messages.length === 0 ? 'window empty' : `window ${windowStart}-${windowEnd}`} • {hiddenAbove > 0 ? `${hiddenAbove} above` : 'at top'} • {hiddenBelow > 0 ? `${hiddenBelow} below` : 'at tail'}
        </Text>
        <Text dimColor>{describeWindowState(hiddenAbove, hiddenBelow, liveCount, uiBeat)}</Text>
      </Box>
      <Box>
        <Text color="gray">radar </Text>
        {renderRadar(messages, start, visibleMessages.length, selectedMessageId, uiBeat)}
      </Box>
      {visibleMessages.length === 0 ? (
        <EmptyState />
      ) : (
        <Box flexDirection="column">
          {hiddenAbove > 0 ? <Text dimColor>{`↑ ${hiddenAbove} earlier message${hiddenAbove === 1 ? '' : 's'}`}</Text> : null}
          {visibleMessages.map((message) => (
            <MessageBubble key={message.id} message={message} selected={message.id === selectedMessageId} uiBeat={uiBeat} />
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

function renderRadar(
  messages: Message[],
  start: number,
  visibleCount: number,
  selectedMessageId: string | null,
  uiBeat: number
): React.JSX.Element {
  if (messages.length === 0) {
    return <Text dimColor>waiting for signal</Text>;
  }

  const width = Math.min(28, Math.max(10, messages.length));
  const points = Array.from({ length: width }, (_, slot) => {
    const index = Math.min(messages.length - 1, Math.floor((slot / width) * messages.length));
    const message = messages[index]!;
    const inWindow = index >= start && index < start + visibleCount;
    const selected = message.id === selectedMessageId;
    const color = message.status === 'error'
      ? 'red'
      : selected
        ? 'white'
        : inWindow
          ? 'blue'
          : 'gray';
    const glyph = selected
      ? '◆'
      : message.status === 'streaming'
        ? frame(uiBeat, ['•', '◦', '•', '●'])
        : inWindow
          ? '■'
          : '·';

    return { color, glyph, key: `${message.id}-${slot}` };
  });

  return (
    <Text>
      {points.map((point) => (
        <Text key={point.key} color={point.color}>
          {point.glyph}
        </Text>
      ))}
    </Text>
  );
}

function describeWindowState(hiddenAbove: number, hiddenBelow: number, liveCount: number, uiBeat: number): string {
  if (liveCount > 0) {
    return `${frame(uiBeat, ['syncing', 'syncing.', 'syncing..', 'syncing...'])}`;
  }

  if (hiddenAbove > 0 && hiddenBelow > 0) {
    return 'inspecting history';
  }

  if (hiddenAbove > 0) {
    return 'near the tail';
  }

  if (hiddenBelow > 0) {
    return 'near the top';
  }

  return 'all in view';
}
