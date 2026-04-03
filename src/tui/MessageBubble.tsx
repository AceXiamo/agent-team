import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';

import type { Message, TokenUsage } from '../types.js';
import { formatTimestamp, senderLabel } from '../core/utils.js';
import { MarkdownText } from './MarkdownText.js';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function useSpinner(active: boolean): string {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      setFrame((prev) => (prev + 1) % SPINNER_FRAMES.length);
    }, 80);
    return () => clearInterval(timer);
  }, [active]);

  return active ? SPINNER_FRAMES[frame]! : '';
}

function formatUsage(usage: TokenUsage): string {
  const parts: string[] = [];
  if (usage.inputTokens != null) parts.push(`${usage.inputTokens} in`);
  if (usage.outputTokens != null) parts.push(`${usage.outputTokens} out`);
  if (usage.cachedInputTokens != null) parts.push(`cache: ${usage.cachedInputTokens}`);
  if (usage.costUsd != null) parts.push(`$${usage.costUsd.toFixed(4)}`);
  return parts.length > 0 ? `tokens: ${parts.join(' / ')}` : '';
}

interface MessageBubbleProps {
  message: Message;
  selected: boolean;
}

export function MessageBubble({ message, selected }: MessageBubbleProps): React.JSX.Element {
  const isStreaming = message.status === 'streaming';
  const spinner = useSpinner(isStreaming);
  const usageText = !isStreaming && message.usage ? formatUsage(message.usage) : '';

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
        {isStreaming ? <Text color="yellow"> {spinner}</Text> : null}
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
        {usageText ? <Text dimColor>{usageText}</Text> : null}
      </Box>
    </Box>
  );
}
