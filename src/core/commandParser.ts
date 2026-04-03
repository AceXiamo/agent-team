import { AGENTS } from './utils.js';

import type { AgentName } from '../types.js';

export type ParsedInput =
  | { type: 'send'; target: AgentName; prompt: string }
  | { type: 'reset'; target: AgentName }
  | { type: 'sessions' }
  | { type: 'new_session'; title?: string }
  | { type: 'switch_session'; sessionId: string }
  | { type: 'error'; message: string };

const AGENT_PATTERN = /@([A-Za-z]+)/g;

export function parseUserInput(input: string): ParsedInput {
  const trimmed = input.trim();

  if (!trimmed) {
    return { type: 'error', message: 'Message cannot be empty.' };
  }

  if (trimmed.startsWith('/reset')) {
    return parseResetCommand(trimmed);
  }

  if (trimmed === '/sessions') {
    return { type: 'sessions' };
  }

  if (trimmed.startsWith('/new')) {
    return parseNewSessionCommand(trimmed);
  }

  if (trimmed.startsWith('/switch')) {
    return parseSwitchSessionCommand(trimmed);
  }

  const mentions = [...trimmed.matchAll(AGENT_PATTERN)];

  if (mentions.length === 0) {
    return { type: 'error', message: 'Message must include exactly one target @Agent.' };
  }

  if (mentions.length > 1) {
    return { type: 'error', message: 'Only one target @Agent is allowed per message.' };
  }

  const rawTarget = mentions[0]?.[1]?.toLowerCase();
  if (!rawTarget || !isAgentName(rawTarget)) {
    return { type: 'error', message: `Unknown target agent: @${mentions[0]?.[1] ?? ''}.` };
  }

  const prompt = trimmed.replace(mentions[0][0], '').trim();
  if (!prompt) {
    return { type: 'error', message: 'Message body cannot be empty after the @Agent mention.' };
  }

  return { type: 'send', target: rawTarget, prompt };
}

function parseResetCommand(input: string): ParsedInput {
  const match = input.match(/^\/reset\s+@([A-Za-z]+)\s*$/);
  if (!match) {
    return { type: 'error', message: 'Usage: /reset @Claude' };
  }

  const agent = match[1].toLowerCase();
  if (!isAgentName(agent)) {
    return { type: 'error', message: `Unknown target agent: @${match[1]}.` };
  }

  return { type: 'reset', target: agent };
}

export function extractMentionCandidates(input: string): AgentName[] {
  const triggerIndex = input.lastIndexOf('@');
  if (triggerIndex === -1) {
    return [];
  }

  const fragment = input.slice(triggerIndex + 1).toLowerCase();
  if (fragment.includes(' ')) {
    return [];
  }

  return AGENTS.filter((agent) => agent.startsWith(fragment));
}

function isAgentName(value: string): value is AgentName {
  return AGENTS.includes(value as AgentName);
}

function parseNewSessionCommand(input: string): ParsedInput {
  const match = input.match(/^\/new(?:\s+(.+))?\s*$/);
  if (!match) {
    return { type: 'error', message: 'Usage: /new [title]' };
  }

  return {
    type: 'new_session',
    title: match[1]?.trim() || undefined
  };
}

function parseSwitchSessionCommand(input: string): ParsedInput {
  const match = input.match(/^\/switch\s+(\S+)\s*$/);
  if (!match) {
    return { type: 'error', message: 'Usage: /switch <sessionId>' };
  }

  return {
    type: 'switch_session',
    sessionId: match[1]
  };
}
