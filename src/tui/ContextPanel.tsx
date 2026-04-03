import React from 'react';
import { Box, Text } from 'ink';

import type { Message } from '../types.js';
import { collectConversationOverview, describeFocusedMessage } from './insights.js';
import { pulse, useAnimationBeat } from './motion.js';

interface ContextPanelProps {
  messages: Message[];
  selectedMessageId: string | null;
  shouldAnimate: boolean;
}

export const ContextPanel = React.memo(function ContextPanel({ messages, selectedMessageId, shouldAnimate }: ContextPanelProps): React.JSX.Element {
  const uiBeat = useAnimationBeat(shouldAnimate);
  const overview = collectConversationOverview(messages);
  const focused = describeFocusedMessage(messages, selectedMessageId);
  const stats = [
    `${overview.totalMessages} msgs`,
    overview.liveMessages > 0 ? `${overview.liveMessages} live` : 'idle',
    overview.errorMessages > 0 ? `${overview.errorMessages} errors` : 'no errors',
    overview.toolEvents > 0 ? `${overview.toolEvents} tool events` : 'no tools',
    overview.delegateEvents > 0 ? `${overview.delegateEvents} delegations` : 'no delegations'
  ];

  if (overview.totalInputTokens > 0 || overview.totalOutputTokens > 0) {
    stats.push(`tokens ${overview.totalInputTokens}/${overview.totalOutputTokens}`);
  }
  if (overview.totalCostUsd > 0) {
    stats.push(`$${overview.totalCostUsd.toFixed(4)}`);
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold color="magenta">
          {pulse(uiBeat)} Context
        </Text>
        <Text dimColor>{stats.join(' • ')}</Text>
      </Box>
      <Box>
        <Text color="gray">lane </Text>
        {renderLane(messages, selectedMessageId, uiBeat)}
        <Text dimColor>{`  last ${Math.min(messages.length, 24)}`}</Text>
      </Box>
      <Text>
        <Text color="gray">focus </Text>
        <Text bold>{focused.title}</Text>
        <Text dimColor>{`  ${focused.detail}`}</Text>
      </Text>
      <Text dimColor>{focused.preview}</Text>
      <Text dimColor>{describeNextMove(messages, overview.liveMessages)}</Text>
    </Box>
  );
});

function renderLane(messages: Message[], selectedMessageId: string | null, uiBeat: number): React.JSX.Element {
  const recent = messages.slice(-24);

  if (recent.length === 0) {
    return <Text dimColor>waiting for the first turn</Text>;
  }

  return (
    <Text>
      {recent.map((message, index) => {
        const selected = message.id === selectedMessageId;
        const color = message.status === 'error'
          ? 'red'
          : message.sender === 'human'
            ? 'yellow'
            : message.sender === 'system'
              ? 'blue'
              : message.sender === 'claude'
                ? 'magenta'
                : message.sender === 'codex'
                  ? 'cyan'
                  : 'green';
        const glyph = selected
          ? '▣'
          : message.status === 'streaming'
            ? uiBeat % 2 === 0
              ? '◉'
              : '◎'
            : message.status === 'error'
              ? '▲'
              : '■';

        return (
          <Text key={message.id ?? index} color={color}>
            {glyph}
          </Text>
        );
      })}
    </Text>
  );
}

function describeNextMove(messages: Message[], liveMessages: number): string {
  if (messages.length === 0) {
    return 'Tip: start with one target like @Codex inspect src/ and let the lane fill with live activity.';
  }

  if (liveMessages > 0) {
    return 'Live output is active. Use Ctrl+L to snap back to tail if you have scrolled into history.';
  }

  const latest = messages[messages.length - 1];
  if (latest?.status === 'error') {
    return 'Latest turn ended in error. Move focus there and inspect tool/result blocks before sending follow-up work.';
  }

  return 'Navigation stays local to the selected message. Enter toggles expanded blocks when the draft is empty.';
}
