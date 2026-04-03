import React from 'react';
import { Box, Text } from 'ink';

import type { AgentName } from '../types.js';

interface InputBoxProps {
  input: string;
  suggestions: AgentName[];
  selectedSuggestion: number;
  activeSuggestion: AgentName | null;
  submitting: boolean;
}

export function InputBox({
  input,
  suggestions,
  selectedSuggestion,
  activeSuggestion,
  submitting
}: InputBoxProps): React.JSX.Element {
  const hint =
    suggestions.length > 0
      ? `target preview: @${capitalize(activeSuggestion ?? suggestions[0]!)}`
      : 'Enter sends • /sessions • /new [title] • /switch <id> • Tab completes mention';

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold color="yellow">
          Composer
        </Text>
        <Text dimColor>{submitting ? 'dispatching...' : `${input.length} chars`}</Text>
      </Box>
      <Text>{`> ${input || '_'}`}</Text>
      {suggestions.length > 0 ? (
        <Text dimColor>
          mention {suggestions.map((agent, index) => (index === selectedSuggestion ? `[${capitalize(agent)}]` : capitalize(agent))).join(' ')}
        </Text>
      ) : null}
      <Text dimColor>{hint}</Text>
    </Box>
  );
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
