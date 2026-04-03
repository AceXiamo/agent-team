import React from 'react';
import { Box, Text } from 'ink';

import type { Message } from '../types.js';
import { collectConversationOverview, describeFocusedMessage } from './insights.js';

interface ContextPanelProps {
  messages: Message[];
  selectedMessageId: string | null;
}

export function ContextPanel({ messages, selectedMessageId }: ContextPanelProps): React.JSX.Element {
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
          Context
        </Text>
        <Text dimColor>{stats.join(' • ')}</Text>
      </Box>
      <Text>
        <Text color="gray">focus </Text>
        <Text bold>{focused.title}</Text>
        <Text dimColor>{`  ${focused.detail}`}</Text>
      </Text>
      <Text dimColor>{focused.preview}</Text>
    </Box>
  );
}
