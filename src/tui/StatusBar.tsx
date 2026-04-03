import React from 'react';
import { Box, Text } from 'ink';

import { meter, pulse, sweep } from './motion.js';

interface StatusBarProps {
  messageCount: number;
  selectedIndex: number; // -1 means tail
  runningAgents: string[];
  queuedCount: number;
  pendingReviewCount: number;
  disabledAgents: string[];
  submitting: boolean;
  liveCount: number;
  uiBeat: number;
}

export function StatusBar({
  messageCount,
  selectedIndex,
  runningAgents,
  queuedCount,
  pendingReviewCount,
  disabledAgents,
  submitting,
  liveCount,
  uiBeat
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
  const signal = submitting || runningAgents.length > 0 || liveCount > 0 ? sweep(uiBeat) : pulse(uiBeat);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
      <Box gap={2}>
        <Text dimColor>
          <Text bold color="white">{signal}</Text>
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
        {liveCount > 0 ? (
          <>
            <Text dimColor>│</Text>
            <Text color="cyan">{`${liveCount} live`}</Text>
          </>
        ) : null}
        {submitting ? (
          <>
            <Text dimColor>│</Text>
            <Text color="yellow">dispatching…</Text>
          </>
        ) : null}
      </Box>

      <Box justifyContent="space-between">
        <Text dimColor>{disabledLabel}</Text>
        <Text dimColor>{`ops ${meter(runningAgents.length + liveCount, 8, uiBeat) || 'clear'}`}</Text>
      </Box>
      <Text dimColor>
        ↑↓ or Ctrl+P/Ctrl+N focus  Ctrl+L tail  Esc clear  ⏎ toggle/send  Tab @mention
      </Text>
      <Text dimColor>
        /agent on|off  /new  /sessions  /switch id  /reset @Agent  ^C quit
      </Text>
    </Box>
  );
}
