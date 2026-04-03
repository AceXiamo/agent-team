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
  const helper = targetInfo
    ? `${targetInfo.label} is ${targetInfo.statusText}. Enter follows the parsed route.`
    : 'Use /agent @Claude off|on to control who can receive direct work and delegation.';

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={borderColor} paddingX={1}>
      <Box justifyContent="space-between">
        <Text color={titleColor} bold>
          {prompt} {draft.title}
        </Text>
        <Text dimColor>{input.length > 0 ? `${cursor}/${input.length}` : ''}</Text>
      </Box>
      <Text>
        <Text color={titleColor}>{`${prompt} `}</Text>
        {input ? renderInputWithCursor(input, cursor, titleColor) : <Text dimColor>{placeholder}</Text>}
      </Text>
      <Text dimColor>{draft.detail}</Text>
      <Text dimColor>{routeLabel}</Text>

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
      ) : (
        <Text dimColor>{helper}</Text>
      )}
      {suggestions.length > 0 ? (
        <Text dimColor>{`Tab completes mention • current pick ${activeSuggestion ? shortLabel(activeSuggestion) : shortLabel(suggestions[0] ?? 'codex')}`}</Text>
      ) : (
        <Text dimColor>Quick routes: `/new`, `/sessions`, `/switch session-id`, `/reset @Agent`.</Text>
      )}
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
