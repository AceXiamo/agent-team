import React from 'react';
import { Box, Text } from 'ink';

import type { AgentName } from '../types.js';

interface InputBoxProps {
  input: string;
  suggestions: AgentName[];
  selectedSuggestion: number;
}

export function InputBox({ input, suggestions, selectedSuggestion }: InputBoxProps): React.JSX.Element {
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      <Text>{`> ${input || '_'}`}</Text>
      {suggestions.length > 0 ? (
        <Text dimColor>
          mention: {suggestions.map((agent, index) => (index === selectedSuggestion ? `[${capitalize(agent)}]` : capitalize(agent))).join(' ')}
        </Text>
      ) : (
        <Text dimColor>Enter sends. Tab completes mention. Up/Down selects message. Enter on empty input toggles tool details.</Text>
      )}
    </Box>
  );
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
