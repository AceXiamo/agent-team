import React from 'react';
import { Box, Text } from 'ink';

import type { AgentName, AgentState } from '../types.js';
import { AGENT_LABELS } from '../core/utils.js';
import { describeDraft } from './insights.js';
import { frame, sweep, useAnimationBeat } from './motion.js';

interface InputBoxProps {
  input: string;
  cursor: number;
  suggestions: AgentName[];
  selectedSuggestion: number;
  activeSuggestion: AgentName | null;
  submitting: boolean;
  targetAgent: AgentName | null;
  agentStates: Record<AgentName, AgentState>;
  shouldAnimate: boolean;
}

export const InputBox = React.memo(function InputBox({
  input,
  cursor,
  suggestions,
  selectedSuggestion,
  activeSuggestion,
  submitting,
  targetAgent,
  agentStates,
  shouldAnimate
}: InputBoxProps): React.JSX.Element {
  const uiBeat = useAnimationBeat(shouldAnimate);
  const targetInfo = targetAgent ? getTargetInfo(targetAgent, agentStates) : null;
  const draft = describeDraft(input, agentStates);
  const borderColor = draft.state === 'error'
    ? 'red'
    : draft.state === 'ready'
      ? 'green'
      : targetInfo?.color ?? 'yellow';
  const titleColor = draft.state === 'error'
    ? 'red'
    : draft.state === 'ready'
      ? 'green'
      : targetInfo?.color ?? 'yellow';
  const prompt = submitting ? sweep(uiBeat) : '>';
  const placeholder = frame(uiBeat, ['type a request for one agent', 'type a request for one agent.', 'type a request for one agent..']);
  const routeLabel = targetInfo
    ? `route ${targetInfo.label} • ${targetInfo.statusText}`
    : 'route command center';

  const hintText = suggestions.length > 0
    ? suggestions.map((agent, index) =>
        index === selectedSuggestion ? `[${shortLabel(agent)}]` : shortLabel(agent)
      ).join(' ') + '  Tab to complete'
    : draft.state === 'neutral' && !input
      ? '↑↓ navigate  Tab @mention  /new /sessions /reset'
      : routeLabel;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={borderColor} paddingX={1} flexShrink={0} overflow="hidden">
      <Text>
        <Text color={titleColor} bold>{`${prompt} `}</Text>
        {input ? renderInputWithCursor(input, cursor, titleColor) : <Text dimColor>{placeholder}</Text>}
        {input.length > 0 ? <Text dimColor>{` ${draft.title}`}</Text> : null}
      </Text>
      <Text dimColor wrap="truncate">{hintText}</Text>
    </Box>
  );
});

function renderInputWithCursor(input: string, cursor: number, cursorColor: string): React.JSX.Element {
  const safeCursor = Math.min(cursor, input.length);
  const before = input.slice(0, safeCursor);
  const atCursor = input[safeCursor] ?? ' ';
  const after = input.slice(safeCursor + 1);

  return (
    <Text>
      {before}
      <Text backgroundColor={cursorColor} color="black">{atCursor}</Text>
      {after}
    </Text>
  );
}

function getTargetInfo(agent: AgentName, states: Record<AgentName, AgentState>): { label: string; color: string; statusText: string } {
  const state = states[agent];
  const label = shortLabel(agent);

  if (!state?.enabled) return { label, color: 'yellow', statusText: 'disabled' };
  if (!state?.available) return { label, color: 'gray', statusText: 'offline' };
  if (state.activeMode === 'review_handoff') return { label, color: 'magenta', statusText: 'reviewing' };
  if (state.status === 'running') return { label, color: 'green', statusText: 'busy' };
  if (state.status === 'error') return { label, color: 'red', statusText: 'error' };
  return {
    label,
    color: 'cyan',
    statusText: state.pendingReviewCount > 0 ? `${state.pendingReviewCount} review queued` : 'ready'
  };
}

function shortLabel(agent: AgentName): string {
  return AGENT_LABELS[agent].split(' ')[0];
}
