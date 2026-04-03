import React from 'react';
import { Box, Text } from 'ink';

import type { AgentName, AgentState } from '../types.js';
import { AGENT_LABELS } from '../core/utils.js';

interface InputBoxProps {
  input: string;
  suggestions: AgentName[];
  selectedSuggestion: number;
  activeSuggestion: AgentName | null;
  submitting: boolean;
  targetAgent: AgentName | null;
  agentStates: Record<AgentName, AgentState>;
}

export function InputBox({
  input,
  suggestions,
  selectedSuggestion,
  activeSuggestion,
  submitting,
  targetAgent,
  agentStates
}: InputBoxProps): React.JSX.Element {
  const targetInfo = targetAgent ? getTargetInfo(targetAgent, agentStates) : null;

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="yellow" paddingX={1}>
      {/* Row 1: target + input + char count */}
      <Box justifyContent="space-between">
        <Box gap={1}>
          {targetInfo ? (
            <>
              <Text color={targetInfo.color}>@{targetInfo.label}</Text>
              <Text dimColor>{targetInfo.statusText}</Text>
              <Text dimColor>│</Text>
            </>
          ) : null}
          <Text>{`> ${input || '_'}`}</Text>
        </Box>
        <Text dimColor>{submitting ? '…' : `${input.length}`}</Text>
      </Box>

      {/* Row 2: mention candidates (only when typing @) */}
      {suggestions.length > 0 ? (
        <Text dimColor>
          {suggestions.map((agent, index) =>
            index === selectedSuggestion
              ? <Text key={agent} color="cyan" bold>{`[${shortLabel(agent)}]`}</Text>
              : <Text key={agent}>{shortLabel(agent)}</Text>
          ).reduce<React.ReactNode[]>((acc, node, i) => {
            if (i > 0) acc.push(<Text key={`sp-${i}`}> </Text>);
            acc.push(node);
            return acc;
          }, [])}
        </Text>
      ) : null}
    </Box>
  );
}

function getTargetInfo(agent: AgentName, states: Record<AgentName, AgentState>): { label: string; color: string; statusText: string } {
  const state = states[agent];
  const label = shortLabel(agent);

  if (!state?.available) return { label, color: 'gray', statusText: 'offline' };
  if (state.status === 'running') return { label, color: 'green', statusText: 'busy' };
  if (state.status === 'error') return { label, color: 'red', statusText: 'error' };
  return { label, color: 'cyan', statusText: 'ready' };
}

function shortLabel(agent: AgentName): string {
  return AGENT_LABELS[agent].split(' ')[0];
}
