import React from 'react';
import { Box, Text } from 'ink';

import type { AgentState } from '../types.js';
import { senderLabel } from '../core/utils.js';

interface HeaderProps {
  workdir: string;
  agents: Record<'claude' | 'codex' | 'kimi', AgentState>;
}

export function Header({ workdir, agents }: HeaderProps): React.JSX.Element {
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      <Text bold>agent-team • {workdir}</Text>
      <Box gap={2}>
        {Object.values(agents).map((agent) => {
          const color = !agent.available ? 'gray' : agent.status === 'running' ? 'green' : agent.status === 'error' ? 'red' : 'blue';
          const status = !agent.available ? 'unavailable' : agent.status;
          return (
            <Text key={agent.name} color={color}>
              {senderLabel(agent.name)} [{status}{agent.queueLength > 0 ? ` q:${agent.queueLength}` : ''}]
            </Text>
          );
        })}
      </Box>
    </Box>
  );
}
