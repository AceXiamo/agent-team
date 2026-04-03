import path from 'node:path';

import React from 'react';
import { Box, Text } from 'ink';

import type { AgentName, AgentState } from '../types.js';
import { AGENT_LABELS, AGENTS } from '../core/utils.js';
import { meter, orbit, pulse, sweep, useAnimationBeat } from './motion.js';

interface HeaderProps {
  workdir: string;
  agents: Record<AgentName, AgentState>;
  activeSessionId: string | null;
  activeSessionTitle: string | null;
  sessionCount: number;
  messageCount: number;
  liveCount: number;
  shouldAnimate: boolean;
}

const AGENT_ORDER = AGENTS;

export const Header = React.memo(function Header({
  workdir,
  agents,
  activeSessionId,
  activeSessionTitle,
  sessionCount,
  messageCount,
  liveCount,
  shouldAnimate
}: HeaderProps): React.JSX.Element {
  const entries = Object.values(agents);
  const usableCount = entries.filter((agent) => agent.available && agent.enabled).length;
  const runningCount = entries.filter((agent) => agent.status === 'running').length;
  const queuedCount = entries.reduce((sum, agent) => sum + agent.queueLength, 0);
  const reviewCount = entries.reduce((sum, agent) => sum + agent.pendingReviewCount, 0);
  const uiBeat = useAnimationBeat(shouldAnimate);
  const signal = runningCount > 0 || liveCount > 0 ? sweep(uiBeat) : pulse(uiBeat);
  const activityLabel = runningCount > 0
    ? `${runningCount} hot`
    : liveCount > 0
      ? `${liveCount} live`
      : 'standby';

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} flexShrink={0} overflow="hidden">
      <Text bold color="cyan">
        {signal} agent-team
      </Text>
      <Text dimColor>
        {activityLabel} • {usableCount}/{entries.length} online
      </Text>
      <Text wrap="truncate">
        <Text color="gray">ws </Text>
        <Text bold>{formatWorkdir(workdir)}</Text>
      </Text>
      <Text wrap="truncate">
        <Text color="gray">ses </Text>
        <Text bold>{activeSessionTitle ?? '—'}</Text>
        <Text dimColor>{` • ${sessionCount}`}</Text>
      </Text>
      <Text dimColor wrap="truncate">
        {meter(runningCount + liveCount, entries.length + 2, uiBeat) || 'clear'} {queuedCount > 0 ? `q${queuedCount}` : ''} {reviewCount > 0 ? `r${reviewCount}` : ''}
      </Text>
      <Box flexDirection="column">
        {AGENT_ORDER.map((name) => (
          <AgentPill key={name} agent={agents[name]} uiBeat={uiBeat} />
        ))}
      </Box>
    </Box>
  );
});

function AgentPill({ agent, uiBeat }: { agent: AgentState; uiBeat: number }): React.JSX.Element {
  const color = getAgentColor(agent);
  const dot = getStatusDot(agent, uiBeat);
  const shortName = AGENT_LABELS[agent.name].split(' ')[0];
  const stateLabel = !agent.enabled
    ? 'off'
    : !agent.available
      ? 'missing'
      : agent.activeMode === 'review_handoff'
        ? 'review'
        : agent.status === 'running'
          ? 'busy'
          : agent.pendingReviewCount > 0
            ? `${agent.pendingReviewCount} review`
            : 'ready';
  const extra = [
    agent.queueLength > 0 ? `q${agent.queueLength}` : null,
    agent.sessionId ? shortId(agent.sessionId) : null
  ].filter(Boolean).join(' • ');

  return (
    <Box>
      <Text color={color}>{`${dot}${shortName}`}</Text>
      <Text dimColor>{` ${stateLabel}`}</Text>
      {extra ? <Text dimColor>{` • ${extra}`}</Text> : null}
    </Box>
  );
}

function formatWorkdir(workdir: string): string {
  const base = path.basename(workdir);
  const parent = path.basename(path.dirname(workdir));
  return `${parent}/${base}`;
}

function shortId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 6)}…` : value;
}

function getAgentColor(agent: AgentState): string {
  if (!agent.enabled) return 'yellow';
  if (!agent.available) return 'gray';
  if (agent.activeMode === 'review_handoff') return 'magenta';
  if (agent.status === 'running') return 'green';
  if (agent.status === 'error') return 'red';
  return 'cyan';
}

function getStatusDot(agent: AgentState, uiBeat: number): string {
  if (!agent.enabled) return '×';
  if (!agent.available) return '○';
  if (agent.activeMode === 'review_handoff') return orbit(uiBeat);
  if (agent.status === 'running') return orbit(uiBeat);
  if (agent.status === 'error') return '▲';
  return '◦';
}
