import type { AgentName, CollaborationMode, Sender } from '../types.js';
import { AGENT_LABELS } from './utils.js';

interface PromptOptions {
  target: AgentName;
  source: Sender;
  body: string;
  workdir: string;
  mode: CollaborationMode;
}

export function buildAgentPrompt(options: PromptOptions): string {
  const sourceLabel = options.source === 'human' ? 'Human user' : options.source === 'system' ? 'System' : AGENT_LABELS[options.source];

  return [
    `You are ${AGENT_LABELS[options.target]} participating in the local "agent-team" CLI.`,
    'Respond in normal prose unless you intentionally delegate.',
    '',
    'Default collaboration mindset:',
    ...buildCollaborationInstructions(options, sourceLabel),
    '',
    'If you need another agent to do work, emit a fenced block with info string "agent-team" and valid JSON only:',
    '```agent-team',
    '{"action":"delegate","target":"claude|codex|kimi","message":"clear task for the other agent"}',
    '```',
    'Do not use plain-text @mentions for delegation. The app only parses the fenced control block.',
    '',
    `CRITICAL RULE: Your workspace is ${options.workdir}.`,
    `You MUST only read and write files within this workspace directory.`,
    `Any file operation targeting paths outside ${options.workdir} is STRICTLY FORBIDDEN.`,
    `Always use relative paths or absolute paths under ${options.workdir}.`,
    '',
    `Workspace: ${options.workdir}`,
    `Incoming sender: ${sourceLabel}`,
    '',
    'Incoming message:',
    options.body
  ].join('\n');
}

function buildCollaborationInstructions(options: PromptOptions, sourceLabel: string): string[] {
  switch (options.mode) {
    case 'delegated_work':
      return [
        `${sourceLabel} remains the main owner of the user task; you are handling a delegated slice.`,
        'Complete the requested work, but do not treat your output as the final user-facing answer.',
        'Make your result easy to review: call out changed files, validation, remaining risks, and what the owner should inspect.',
        'If you need help from another agent, keep the delegation scoped and relevant to this slice.'
      ];
    case 'review_handoff':
      return [
        `You are receiving delegated work back from ${sourceLabel}.`,
        'You remain accountable for the user-facing outcome.',
        'Review the returned work for completeness and correctness before answering the human user.',
        'If gaps remain, delegate follow-up work or fix them yourself instead of forwarding raw output.'
      ];
    case 'user_request':
      return [
        'You are the main owner of this user request.',
        'You may delegate to other agents, but you remain responsible for completeness and correctness.',
        'If you delegate, review or synthesize the returned work instead of forwarding it blindly.',
        'Only conclude to the human user once delegated work has been checked or incorporated.'
      ];
  }
}
