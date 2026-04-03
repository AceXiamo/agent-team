import React from 'react';
import { Box, Text } from 'ink';

interface StatusBarProps {
  messageCount: number;
  selectedIndex: number; // -1 means tail
  runningAgents: string[];
  queuedCount: number;
  pendingReviewCount: number;
  disabledAgents: string[];
  submitting: boolean;
}

export function StatusBar({
  messageCount,
  selectedIndex,
  runningAgents,
  queuedCount,
  pendingReviewCount,
  disabledAgents,
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
  const reviewLabel = pendingReviewCount > 0 ? `${pendingReviewCount} review pending` : 'review clear';
  const disabledLabel = disabledAgents.length > 0 ? `${disabledAgents.join(', ')} off` : 'all agents on';

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
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
        <Text dimColor>│</Text>
        <Text dimColor>{reviewLabel}</Text>
        {submitting ? (
          <>
            <Text dimColor>│</Text>
            <Text color="yellow">dispatching…</Text>
          </>
        ) : null}
      </Box>

      <Text dimColor>{disabledLabel}</Text>
      <Text dimColor>
        ↑↓ focus  Esc clear draft  ⏎ toggle/send  Tab @mention  /agent @Claude off|on  /new  /sessions  /switch  ^C quit
      </Text>
    </Box>
  );
}
