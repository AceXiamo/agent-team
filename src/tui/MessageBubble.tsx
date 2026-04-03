import React from 'react';
import { Box, Text } from 'ink';

import type { Message, MessageContent, TokenUsage } from '../types.js';
import { formatTimestamp, senderLabel } from '../core/utils.js';
import { MarkdownText } from './MarkdownText.js';

function formatUsage(usage: TokenUsage): string {
  const parts: string[] = [];
  if (usage.inputTokens != null) parts.push(`${usage.inputTokens} in`);
  if (usage.outputTokens != null) parts.push(`${usage.outputTokens} out`);
  if (usage.cachedInputTokens != null) parts.push(`cache ${usage.cachedInputTokens}`);
  if (usage.costUsd != null) parts.push(`$${usage.costUsd.toFixed(4)}`);
  return parts.length > 0 ? `tokens ${parts.join(' • ')}` : '';
}

interface MessageBubbleProps {
  message: Message;
  selected: boolean;
}

export function MessageBubble({ message, selected }: MessageBubbleProps): React.JSX.Element {
  const accent = getAccentColor(message);
  const isStreaming = message.status === 'streaming';
  const usageText = !isStreaming && message.usage ? formatUsage(message.usage) : '';

  return (
    <Box
      flexDirection="column"
      borderStyle={selected ? 'round' : undefined}
      borderColor={selected ? accent : undefined}
      paddingX={selected ? 1 : 0}
      marginBottom={1}
    >
      <Box justifyContent="space-between">
        <Text color={accent} bold>
          {selected ? '▶' : '•'} {senderLabel(message.sender)}
        </Text>
        <Text dimColor>
          {formatTimestamp(message.timestamp)} {renderStatusLabel(message)}
        </Text>
      </Box>
      <Box flexDirection="column" marginLeft={2}>
        {message.content.length === 0 ? <Text dimColor>Waiting for output…</Text> : null}
        {message.content.map((content, index) => (
          <ContentBlock key={index} content={content} />
        ))}
        {usageText ? <Text dimColor>{usageText}</Text> : null}
      </Box>
    </Box>
  );
}

function ContentBlock({ content }: { content: MessageContent }): React.JSX.Element {
  switch (content.type) {
    case 'text':
      return <MarkdownText text={content.text} />;
    case 'thinking':
      return (
        <Text dimColor>
          · {content.text}
        </Text>
      );
    case 'tool_use':
      return (
        <ToolBlock
          color="magenta"
          icon={content.collapsed ? '▸' : '▾'}
          label={`tool ${content.tool}`}
          summary={summarizeValue(content.input)}
          collapsed={content.collapsed}
          body={JSON.stringify(content.input, null, 2)}
        />
      );
    case 'tool_result':
      return (
        <ToolBlock
          color="green"
          icon={content.collapsed ? '▸' : '▾'}
          label={`result ${content.tool}`}
          summary={summarizeText(content.output)}
          collapsed={content.collapsed}
          body={content.output}
        />
      );
    case 'delegate':
      return (
        <Text color="cyan">
          → delegated to {content.target}: {content.message}
        </Text>
      );
    case 'system':
      return (
        <Text color={content.tone === 'error' ? 'red' : 'blue'}>
          {content.tone === 'error' ? '!' : 'i'} {content.text}
        </Text>
      );
  }
}

function ToolBlock({
  body,
  collapsed,
  color,
  icon,
  label,
  summary
}: {
  body: string;
  collapsed: boolean;
  color: string;
  icon: string;
  label: string;
  summary: string;
}): React.JSX.Element {
  return (
    <Box flexDirection="column">
      <Text color={color}>
        {icon} {label}
        {summary ? <Text dimColor>{` • ${summary}`}</Text> : null}
      </Text>
      {!collapsed ? (
        <Box marginLeft={2} flexDirection="column">
          {body.split('\n').map((line, index) => (
            <Text key={index}>{line}</Text>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}

function renderStatusLabel(message: Message): string {
  if (message.status === 'streaming') {
    return 'live';
  }

  if (message.status === 'error') {
    return 'error';
  }

  return 'done';
}

function getAccentColor(message: Message): string {
  if (message.status === 'error') {
    return 'red';
  }

  switch (message.sender) {
    case 'human':
      return 'yellow';
    case 'system':
      return 'blue';
    case 'claude':
      return 'magenta';
    case 'codex':
      return 'cyan';
    case 'kimi':
      return 'green';
  }
}

function summarizeValue(value: unknown): string {
  if (value == null) {
    return '';
  }

  if (typeof value === 'string') {
    return summarizeText(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    return `${value.length} item${value.length === 1 ? '' : 's'}`;
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>);
    return keys.length === 0 ? 'empty object' : keys.slice(0, 3).join(', ');
  }

  return String(value);
}

function summarizeText(value: string): string {
  const singleLine = value.replace(/\s+/g, ' ').trim();
  if (!singleLine) {
    return '';
  }

  return singleLine.length > 72 ? `${singleLine.slice(0, 69)}...` : singleLine;
}
