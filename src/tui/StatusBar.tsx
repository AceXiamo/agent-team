import React from 'react';
import { Box, Text } from 'ink';

import { pulse, sweep, useAnimationBeat } from './motion.js';

interface StatusBarProps {
  messageCount: number;
  selectedIndex: number;
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

  const queueLabel = queuedCount > 0 ? `${queuedCount} queued` : null;
  const reviewLabel = pendingReviewCount > 0 ? `${pendingReviewCount} review` : null;
  const disabledLabel = disabledAgents.length > 0 ? `${disabledAgents.join(', ')} off` : null;
  const signal = submitting || runningAgents.length > 0 || liveCount > 0 ? sweep(uiBeat) : pulse(uiBeat);

  const statusSegments = [
    focusLabel,
    runningLabel,
    queueLabel,
    reviewLabel,
    liveCount > 0 ? `${liveCount} live` : null,
    submitting ? 'dispatching…' : null,
    disabledLabel
  ].filter(Boolean).join('  ');

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} flexShrink={0} overflow="hidden">
      <Box>
        <Text bold color="white">{signal}</Text>
        <Text dimColor>{`  ${statusSegments}`}</Text>
      </Box>
      <KeyHints />
    </Box>
  );
});

function KeyHints(): React.JSX.Element {
  return (
    <Box flexWrap="wrap" gap={1}>
      <KeyBadge k="↑↓" desc="scroll" color="cyan" />
      <KeyBadge k="^P/N" desc="prev/next msg" color="cyan" />
      <KeyBadge k="^L" desc="jump to latest" color="cyan" />
      <KeyBadge k="Enter" desc="send / expand" color="green" />
      <KeyBadge k="Tab" desc="@mention" color="yellow" />
      <KeyBadge k="Esc" desc="clear" color="gray" />
      <KeyBadge k="^C" desc="stop / quit" color="red" />
      <KeyBadge k="/new" desc="session" color="magenta" />
      <KeyBadge k="/sessions" desc="list" color="magenta" />
      <KeyBadge k="/reset" desc="agent" color="magenta" />
      <KeyBadge k="/model" desc="llm" color="magenta" />
    </Box>
  );
}

function KeyBadge({ k, desc, color }: { k: string; desc: string; color: string }): React.JSX.Element {
  return (
    <Text>
      <Text bold color={color}>{k}</Text>
      <Text dimColor>{` ${desc}`}</Text>
    </Text>
  );
}
