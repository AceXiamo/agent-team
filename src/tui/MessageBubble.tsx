import React from 'react';
import { Box, Text } from 'ink';

import type { Message } from '../types.js';
import { formatTimestamp, senderLabel } from '../core/utils.js';
import { MarkdownText } from './MarkdownText.js';

interface MessageBubbleProps {
  message: Message;
  selected: boolean;
}

export function MessageBubble({ message, selected }: MessageBubbleProps): React.JSX.Element {
  return (
    <Box
      flexDirection="column"
      borderStyle={selected ? 'round' : undefined}
      borderColor={selected ? 'cyan' : undefined}
      paddingLeft={selected ? 1 : 0}
      marginBottom={1}
    >
      <Text bold>
        {selected ? '>' : ' '} [{senderLabel(message.sender)}] {formatTimestamp(message.timestamp)}
      </Text>
      <Box flexDirection="column" marginLeft={2}>
        {message.content.length === 0 ? <Text dimColor>...</Text> : null}
        {message.content.map((content, index) => {
          switch (content.type) {
            case 'text':
              return <MarkdownText key={index} text={content.text} />;
            case 'thinking':
              return (
                <Text key={index} dimColor>
                  • {content.text}
                </Text>
              );
            case 'tool_use':
              return (
                <Box key={index} flexDirection="column">
                  <Text color="magenta">✦ {content.tool} {content.collapsed ? '(collapsed)' : ''}</Text>
                  {!content.collapsed ? <Text>{JSON.stringify(content.input, null, 2)}</Text> : null}
                </Box>
              );
            case 'tool_result':
              return (
                <Box key={index} flexDirection="column">
                  <Text color="green">✓ {content.tool} {content.collapsed ? '(collapsed)' : ''}</Text>
                  {!content.collapsed ? <Text>{content.output}</Text> : null}
                </Box>
              );
            case 'delegate':
              return (
                <Text key={index} color="cyan">
                  → {content.message}
                </Text>
              );
            case 'system':
              return (
                <Text key={index} color={content.tone === 'error' ? 'red' : 'blue'}>
                  {content.text}
                </Text>
              );
          }
        })}
      </Box>
    </Box>
  );
}
