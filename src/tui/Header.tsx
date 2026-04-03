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
  const availableCount = entries.filter((agent) => agent.available).length;

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
      {/* Row 1: title + compact agent indicators + ready count */}
      <Box gap={1}>
        <Text bold color="cyan">agent-team</Text>
        <Text dimColor>│</Text>
        {AGENT_ORDER.map((name) => (
          <AgentDot key={name} agent={agents[name]} />
        ))}
        <Text dimColor>{availableCount}/{entries.length} ready</Text>
      </Box>

      {/* Row 2: workspace + session */}
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
    </Box>
  );
}

function AgentDot({ agent }: { agent: AgentState }): React.JSX.Element {
  const color = getAgentColor(agent);
  const dot = getStatusDot(agent);
  const shortName = AGENT_LABELS[agent.name].split(' ')[0]; // "Claude" from "Claude Code"

  return (
    <Text color={color}>
      {dot}{shortName}
    </Text>
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
  if (!agent.available) return 'gray';
  if (agent.status === 'running') return 'green';
  if (agent.status === 'error') return 'red';
  return 'cyan';
}

function getStatusDot(agent: AgentState): string {
  if (!agent.available) return '○';
  if (agent.status === 'running') return '●';
  if (agent.status === 'error') return '▲';
  return '◦';
}
