import React from 'react';
import { Box, Text } from 'ink';

interface StatusBarProps {
  messageCount: number;
  selectedIndex: number; // -1 means tail
  runningAgents: string[];
  queuedCount: number;
  submitting: boolean;
}

export function StatusBar({
  messageCount,
  selectedIndex,
  runningAgents,
  queuedCount,
  submitting
}: StatusBarProps): React.JSX.Element {
  const isTail = selectedIndex === -1 || selectedIndex === messageCount - 1;
  const focusLabel = messageCount === 0
    ? 'empty'
    : isTail
      ? `tail ${messageCount}/${messageCount}`
      : `focus ${selectedIndex + 1}/${messageCount}`;

  const runningLabel = runningAgents.length > 0
    ? `${runningAgents.join(', ')} running`
    : 'idle';

  const queueLabel = queuedCount > 0 ? `${queuedCount} queued` : 'queue clear';

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
      {/* Row 1: live state */}
      <Box gap={2}>
        <Text dimColor>
          <Text bold color="white">▶</Text>
          {` ${focusLabel}`}
        </Text>
        <Text dimColor>│</Text>
        <Text dimColor>
          {runningAgents.length > 0 ? <Text color="green">{runningLabel}</Text> : runningLabel}
        </Text>
        <Text dimColor>│</Text>
        <Text dimColor>{queueLabel}</Text>
        {submitting ? (
          <>
            <Text dimColor>│</Text>
            <Text color="yellow">dispatching…</Text>
          </>
        ) : null}
      </Box>

      {/* Row 2: keybindings */}
      <Text dimColor>
        ↑↓ focus  ⏎ toggle/send  Tab @mention  /new  /sessions  /switch  ^C quit
      </Text>
    </Box>
  );
}
