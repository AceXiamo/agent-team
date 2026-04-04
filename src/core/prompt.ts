import type { AgentName, CollaborationMode, Message, Sender } from '../types.js';
import { AGENT_LABELS, summarizeText } from './utils.js';

const DEFAULT_SUMMARY_MAX_CHARS = 2000;
const AGENT_TEXT_LIMIT = 300;
const HUMAN_TEXT_LIMIT = 500;
const TOOL_LIST_LIMIT = 120;

interface PromptOptions {
  target: AgentName;
  source: Sender;
  body: string;
  workdir: string;
  mode: CollaborationMode;
  contextSummary?: string | null;
}

export function buildAgentPrompt(options: PromptOptions): string {
  const sourceLabel = options.source === 'human' ? 'Human user' : options.source === 'system' ? 'System' : AGENT_LABELS[options.source];

  const lines = [
    `You are ${AGENT_LABELS[options.target]} participating in the local "agent-team" CLI.`,
    'Respond in normal prose unless you intentionally delegate.',
    '',
    'Default collaboration mindset:',
    ...buildCollaborationInstructions(options, sourceLabel),
    '',
    'If you need another agent to do work, emit a fenced block with info string "agent-team" and valid JSON only:',
    '```agent-team',
    '{"action":"delegate","target":"claude|codex|kimi|copilot","message":"clear task for the other agent"}',
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
    ''
  ];

  if (options.contextSummary) {
    lines.push(
      'Recent activity from other participants (while you were idle):',
      '---',
      options.contextSummary,
      '---',
      'Use this context to stay informed, but focus on the incoming message.',
      ''
    );
  }

  lines.push('Incoming message:', options.body);
  return lines.join('\n');
}

// --- Context summary ---

interface ContextSummaryOptions {
  target: AgentName;
  messages: Message[];
  maxChars?: number;
}

export function buildContextSummary(options: ContextSummaryOptions): string | null {
  const { target, messages, maxChars = DEFAULT_SUMMARY_MAX_CHARS } = options;

  // Skip streaming placeholders from the target when finding the boundary.
  // The router calls buildContextSummary before appending, but this makes the
  // function safe to call at any point.
  const lastTargetIndex = findLastIndex(messages, (m) => m.sender === target && m.status !== 'streaming');
  const startIndex = lastTargetIndex === -1 ? 0 : lastTargetIndex + 1;

  const summaryLines: string[] = [];
  for (let i = startIndex; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.sender === target) {
      continue;
    }
    const line = summarizeMessage(msg);
    if (line) {
      summaryLines.push(line);
    }
  }

  if (summaryLines.length === 0) {
    return null;
  }

  return truncateFromHead(summaryLines, maxChars);
}

function summarizeMessage(message: Message): string | null {
  const { sender } = message;

  if (sender === 'system') {
    return summarizeSystemMessage(message);
  }

  const label = sender === 'human' ? 'Human' : AGENT_LABELS[sender as AgentName] ?? sender;
  const parts: string[] = [];

  for (const block of message.content) {
    switch (block.type) {
      case 'text': {
        const text = sender === 'human'
          ? summarizeText(block.text, HUMAN_TEXT_LIMIT)
          : summarizeText(block.text, AGENT_TEXT_LIMIT);
        if (text) {
          parts.push(text);
        }
        break;
      }
      case 'tool_use':
        parts.push(`[tool: ${block.tool}]`);
        break;
      case 'delegate':
        parts.push(`[delegated to ${block.target}: ${summarizeText(block.message, TOOL_LIST_LIMIT)}]`);
        break;
      // skip thinking, tool_result, system within agent messages
    }
  }

  if (parts.length === 0) {
    return null;
  }

  return `[${label}] ${parts.join(' ')}`;
}

function summarizeSystemMessage(message: Message): string | null {
  for (const block of message.content) {
    if (block.type === 'delegate') {
      return `[System] ${summarizeText(block.message, AGENT_TEXT_LIMIT)}`;
    }
  }
  return null;
}

function truncateFromHead(lines: string[], maxChars: number): string {
  let total = 0;
  let startLine = lines.length;

  for (let i = lines.length - 1; i >= 0; i--) {
    const added = lines[i].length + (i < lines.length - 1 ? 1 : 0);
    if (total + added > maxChars) {
      break;
    }
    total += added;
    startLine = i;
  }

  const kept = lines.slice(startLine);
  if (startLine > 0) {
    kept.unshift(`... (${startLine} earlier message${startLine === 1 ? '' : 's'} omitted)`);
  }

  return kept.join('\n');
}

function findLastIndex<T>(arr: T[], predicate: (item: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (predicate(arr[i])) {
      return i;
    }
  }
  return -1;
}

function buildCollaborationInstructions(options: PromptOptions, sourceLabel: string): string[] {
  switch (options.mode) {
    case 'delegated_work':
      return [
        `${sourceLabel} remains the main owner of the user task; you are handling a delegated slice.`,
        'Complete ONLY the specific slice assigned to you — do not expand scope or take over unrelated parts.',
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
        'You are the owner of this user request, operating inside a multi-agent team.',
        'You may delegate slices of work to other agents, and you remain responsible for the final outcome.',
        '',
        'BEFORE you start working, assess the task scope:',
        '',
        'Handle it YOURSELF if:',
        '- It is a simple question, lookup, or explanation',
        '- It only touches 1-2 files with straightforward changes',
        '- It is a quick fix, rename, or small config tweak',
        '',
        'DELEGATE to teammates if ANY of these apply:',
        '- The task spans 3+ files or involves multiple independent concerns (e.g. frontend + backend, logic + config + tests)',
        '- The human explicitly requests collaboration or mentions other agents',
        '- The task involves a multi-step plan where different steps can be done independently',
        '- You estimate the work would produce more than ~150 lines of code changes in total',
        '',
        'When you delegate:',
        '1. Plan first — break the task into focused, independent slices.',
        '2. Delegate ONE slice at a time (one delegation block per response, no more).',
        '3. STOP after emitting the delegation block. Do NOT continue working while the delegate is busy.',
        '4. When the result comes back, review it for correctness before proceeding.',
        '5. Then delegate the next slice, or conclude to the human if everything is done.',
        '',
        'Your value as owner: planning, coordination, quality review. Let teammates do the implementation.'
      ];
  }
}
