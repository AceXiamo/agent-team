import { describe, expect, it } from 'vitest';

import { buildAgentPrompt } from '../src/core/prompt.js';

describe('buildAgentPrompt', () => {
  it('marks human-originated tasks as owner-led collaboration', () => {
    const prompt = buildAgentPrompt({
      target: 'codex',
      source: 'human',
      mode: 'user_request',
      body: 'Implement the requested feature',
      workdir: '/tmp/agent-team-spec'
    });

    expect(prompt).toContain('You are the main owner of this user request.');
    expect(prompt).toContain('If you delegate, review or synthesize the returned work instead of forwarding it blindly.');
  });

  it('marks delegated work as a supporting slice for the owner', () => {
    const prompt = buildAgentPrompt({
      target: 'claude',
      source: 'codex',
      mode: 'delegated_work',
      body: 'Message from codex: inspect the patch',
      workdir: '/tmp/agent-team-spec'
    });

    expect(prompt).toContain('Codex remains the main owner of the user task; you are handling a delegated slice.');
    expect(prompt).toContain('Make your result easy to review: call out changed files, validation, remaining risks, and what the owner should inspect.');
  });

  it('marks review handoffs as owner review work', () => {
    const prompt = buildAgentPrompt({
      target: 'codex',
      source: 'claude',
      mode: 'review_handoff',
      body: 'Delegated work from claude has completed.',
      workdir: '/tmp/agent-team-spec'
    });

    expect(prompt).toContain('You are receiving delegated work back from Claude Code.');
    expect(prompt).toContain('Review the returned work for completeness and correctness before answering the human user.');
  });
});
