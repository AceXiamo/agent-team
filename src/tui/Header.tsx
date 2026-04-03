import path from 'node:path';

import React from 'react';
import { Box, Text } from 'ink';

import type { AgentState } from '../types.js';
import { AGENT_LABELS } from '../core/utils.js';

interface HeaderProps {
  workdir: string;
  agents: Record<'claude' | 'codex' | 'kimi', AgentState>;
  activeSessionId: string | null;
  activeSessionTitle: string | null;
  sessionCount: number;
}

const AGENT_ORDER: Array<'claude' | 'codex' | 'kimi'> = ['claude', 'codex', 'kimi'];

export function Header({ workdir, agents, activeSessionId, activeSessionTitle, sessionCount }: HeaderProps): React.JSX.Element {
  const entries = Object.values(agents);
  const usableCount = entries.filter((agent) => agent.available && agent.enabled).length;
  const reviewCount = entries.reduce((sum, agent) => sum + agent.pendingReviewCount, 0);

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
      <Box gap={1}>
        <Text bold color="cyan">agent-team</Text>
        <Text dimColor>│</Text>
        <Text dimColor>{usableCount}/{entries.length} enabled</Text>
        <Text dimColor>│</Text>
        <Text dimColor>{reviewCount > 0 ? `${reviewCount} review pending` : 'review clear'}</Text>
      </Box>

      <Box gap={2}>
        <Text>
          <Text color="gray">ws </Text>
          <Text bold>{formatWorkdir(workdir)}</Text>
        </Text>
        <Text dimColor>│</Text>
        <Text>
          <Text color="gray">ses </Text>
          <Text bold>{activeSessionTitle ?? '—'}</Text>
          {activeSessionId ? <Text dimColor>{` (${shortId(activeSessionId)})`}</Text> : null}
          <Text dimColor>{` • ${sessionCount}`}</Text>
        </Text>
      </Box>

      <Box gap={1} flexWrap="wrap">
        {AGENT_ORDER.map((name) => (
          <AgentPill key={name} agent={agents[name]} />
        ))}
      </Box>
    </Box>
  );
}

function AgentPill({ agent }: { agent: AgentState }): React.JSX.Element {
  const color = getAgentColor(agent);
  const dot = getStatusDot(agent);
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

  return (
    <Box>
      <Text color={color}>{`${dot}${shortName}`}</Text>
      <Text dimColor>{` ${stateLabel}`}</Text>
    </Box>
  );
}

function formatWorkdir(workdir: string): string {
  const base = path.basename(workdir);
  const parent = path.basename(path.dirname(workdir));
  return `${parent}/${base}`;
}

function shortId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 8)}…` : value;
}

function getAgentColor(agent: AgentState): string {
  if (!agent.enabled) return 'yellow';
  if (!agent.available) return 'gray';
  if (agent.activeMode === 'review_handoff') return 'magenta';
  if (agent.status === 'running') return 'green';
  if (agent.status === 'error') return 'red';
  return 'cyan';
}

function getStatusDot(agent: AgentState): string {
  if (!agent.enabled) return '×';
  if (!agent.available) return '○';
  if (agent.activeMode === 'review_handoff') return '↺';
  if (agent.status === 'running') return '●';
  if (agent.status === 'error') return '▲';
  return '◦';
}
