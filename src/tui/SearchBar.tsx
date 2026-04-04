import React from 'react';
import { Box, Text } from 'ink';

interface SearchBarProps {
  query: string;
  cursor: number;
  matchCount: number;
  totalCount: number;
}

export function SearchBar({ query, cursor, matchCount, totalCount }: SearchBarProps): React.JSX.Element {
  const safeCursor = Math.min(cursor, query.length);
  const before = query.slice(0, safeCursor);
  const atCursor = query[safeCursor] ?? ' ';
  const after = query.slice(safeCursor + 1);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} flexShrink={0} overflow="hidden">
      <Box>
        <Text color="yellow" bold>{'/ '}</Text>
        {query ? (
          <Text>
            {before}
            <Text backgroundColor="yellow" color="black">{atCursor}</Text>
            {after}
          </Text>
        ) : (
          <Text dimColor>type to filter messages...</Text>
        )}
      </Box>
      <Text dimColor wrap="truncate">
        {matchCount}/{totalCount} match{matchCount !== 1 ? 'es' : ''}
        {'  '}Esc to exit search
        {'  '}↑↓ scroll
        {'  '}^P/N prev/next msg
      </Text>
    </Box>
  );
}
