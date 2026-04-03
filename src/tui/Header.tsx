import path from 'node:path';

import React from 'react';
import { Box, Text } from 'ink';

import type { AgentState } from '../types.js';
import { senderLabel } from '../core/utils.js';

interface HeaderProps {
  workdir: string;
  agents: Record<'claude' | 'codex' | 'kimi', AgentState>;
  activeSessionId: string | null;
  activeSessionTitle: string | null;
  sessionCount: number;
}

export function Header({ workdir, agents, activeSessionId, activeSessionTitle, sessionCount }: HeaderProps): React.JSX.Element {
  const entries = Object.values(agents);
  const runningCount = entries.filter((agent) => agent.status === 'running').length;
  const queuedCount = entries.reduce((sum, agent) => sum + agent.queueLength, 0);
  const availableCount = entries.filter((agent) => agent.available).length;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold color="cyan">
          agent-team
        </Text>
        <Text dimColor>
          {availableCount}/{entries.length} agents ready
        </Text>
      </Box>
      <Text>
        <Text color="gray">workspace </Text>
        <Text bold>{formatWorkdir(workdir)}</Text>
        <Text dimColor>{`  (${workdir})`}</Text>
      </Text>
      <Text>
        <Text color="gray">session </Text>
        <Text bold>{activeSessionTitle ?? 'none selected'}</Text>
        <Text dimColor>
          {activeSessionId ? `  (${shortId(activeSessionId)})` : '  use /new to start'}
        </Text>
        <Text dimColor>{`  • ${sessionCount} total`}</Text>
      </Text>
      <Box gap={2} flexWrap="wrap">
        {entries.map((agent) => (
          <AgentChip key={agent.name} agent={agent} />
        ))}
      </Box>
      <Text dimColor>
        {`${runningCount > 0 ? `${runningCount} running` : 'idle'} • ${queuedCount > 0 ? `${queuedCount} queued` : 'queue clear'} • /sessions • /new • /switch <id> • Tab mention • ↑↓ focus • Enter send/toggle`}
      </Text>
    </Box>
  );
}

function AgentChip({ agent }: { agent: AgentState }): React.JSX.Element {
  const color = getAgentColor(agent);
  const status = !agent.available
    ? 'offline'
    : agent.status === 'running'
      ? 'working'
      : agent.status === 'error'
        ? 'error'
        : 'ready';
  const detail = !agent.available
    ? 'cli missing'
    : agent.queueLength > 0
      ? `queue ${agent.queueLength}`
      : agent.sessionId
        ? `driver ${shortId(agent.sessionId)}`
        : 'new driver session';

  return (
    <Box>
      <Text color={color}>
        {getStatusDot(agent)} {senderLabel(agent.name)}
      </Text>
      <Text dimColor>{` ${status} • ${detail}`}</Text>
    </Box>
  );
}

function formatWorkdir(workdir: string): string {
  const base = path.basename(workdir);
  const parent = path.basename(path.dirname(workdir));
  return `${parent}/${base}`;
}

function shortId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 8)}...` : value;
}

function getAgentColor(agent: AgentState): string {
  if (!agent.available) {
    return 'gray';
  }
  if (agent.status === 'running') {
    return 'green';
  }
  if (agent.status === 'error') {
    return 'red';
  }
  return 'cyan';
}

function getStatusDot(agent: AgentState): string {
  if (!agent.available) {
    return '○';
  }
  if (agent.status === 'running') {
    return '●';
  }
  if (agent.status === 'error') {
    return '▲';
  }
  return '◦';
}
