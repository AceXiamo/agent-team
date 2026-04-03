import type { AgentName, Sender } from '../types.js';
import { AGENT_LABELS } from './utils.js';

interface PromptOptions {
  target: AgentName;
  source: Sender;
  body: string;
  workdir: string;
}

export function buildAgentPrompt(options: PromptOptions): string {
  const sourceLabel = options.source === 'human' ? 'Human user' : options.source === 'system' ? 'System' : AGENT_LABELS[options.source];

  return [
    `You are ${AGENT_LABELS[options.target]} participating in the local "agent-team" CLI.`,
    'Respond in normal prose unless you intentionally delegate.',
    'If you need another agent to do work, emit a fenced block with info string "agent-team" and valid JSON only:',
    '```agent-team',
    '{"action":"delegate","target":"claude|codex|kimi","message":"clear task for the other agent"}',
    '```',
    'Do not use plain-text @mentions for delegation. The app only parses the fenced control block.',
    `Workspace: ${options.workdir}`,
    `Incoming sender: ${sourceLabel}`,
    '',
    'Incoming message:',
    options.body
  ].join('\n');
}
