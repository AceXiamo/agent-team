import React from 'react';
import { Box, Text } from 'ink';

import { pulse, sweep, useAnimationBeat } from './motion.js';

interface StatusBarProps {
  messageCount: number;
  selectedIndex: number; // -1 means tail
  runningAgents: string[];
  queuedCount: number;
  pendingReviewCount: number;
  disabledAgents: string[];
  submitting: boolean;
  liveCount: number;
  shouldAnimate: boolean;
}

export const StatusBar = React.memo(function StatusBar({
  messageCount,
  selectedIndex,
  runningAgents,
  queuedCount,
  pendingReviewCount,
  disabledAgents,
  submitting,
  liveCount,
  shouldAnimate
}: StatusBarProps): React.JSX.Element {
  const uiBeat = useAnimationBeat(shouldAnimate && (submitting || runningAgents.length > 0 || liveCount > 0));
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

  const segments = [
    focusLabel,
    runningLabel,
    queueLabel,
    reviewLabel,
    liveCount > 0 ? `${liveCount} live` : null,
    submitting ? 'dispatching…' : null,
    disabledLabel
  ].filter(Boolean).join('  ');

  return (
    <Box borderStyle="round" borderColor="gray" paddingX={1} flexShrink={0} overflow="hidden">
      <Text wrap="truncate">
        <Text bold color="white">{signal}</Text>
        <Text dimColor>{`  ${segments}`}</Text>
      </Text>
    </Box>
  );
});
