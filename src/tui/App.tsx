import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, useApp, useInput } from 'ink';

import { extractMentionCandidates } from '../core/commandParser.js';
import { senderLabel } from '../core/utils.js';
import type { AgentName, AppState } from '../types.js';
import { Header } from './Header.js';
import { InputBox } from './InputBox.js';
import { MessageStream } from './MessageStream.js';
import { StatusBar } from './StatusBar.js';
import { MessageRouter } from '../core/router.js';

interface AppProps {
  router: MessageRouter;
}

export function App({ router }: AppProps): React.JSX.Element {
  const { exit } = useApp();
  const [state, setState] = useState<AppState>(router.getState());
  const [input, setInput] = useState('');
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(state.messages.at(-1)?.id ?? null);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const previousLastMessageId = useRef<string | null>(state.messages.at(-1)?.id ?? null);

  useEffect(() => router.subscribe(setState), [router]);

  useEffect(() => {
    const currentLastId = state.messages.at(-1)?.id ?? null;
    const shouldFollowTail =
      !selectedMessageId ||
      selectedMessageId === previousLastMessageId.current ||
      (selectedMessageId && !state.messages.some((message) => message.id === selectedMessageId));

    if (shouldFollowTail) {
      setSelectedMessageId(currentLastId);
    }

    previousLastMessageId.current = currentLastId;
  }, [selectedMessageId, state.messages]);

  const suggestions = useMemo(() => extractMentionCandidates(input), [input]);
  const activeSuggestion = suggestions[selectedSuggestion] ?? suggestions[0] ?? null;

  useEffect(() => {
    if (selectedSuggestion >= suggestions.length) {
      setSelectedSuggestion(0);
    }
  }, [selectedSuggestion, suggestions.length]);

  // Derive the target agent from input (last @mention) for display
  const targetAgent = useMemo<AgentName | null>(() => {
    if (suggestions.length > 0) return activeSuggestion;
    const match = input.match(/@(\w+)/);
    if (match) {
      const name = match[1].toLowerCase();
      if (name in state.agents) return name as AgentName;
    }
    return null;
  }, [input, suggestions, activeSuggestion, state.agents]);

  // Derive running agents for StatusBar
  const runningAgents = useMemo(() =>
    Object.values(state.agents)
      .filter((a) => a.status === 'running')
      .map((a) => senderLabel(a.name)),
    [state.agents]
  );

  const queuedCount = useMemo(() =>
    Object.values(state.agents).reduce((sum, a) => sum + a.queueLength, 0),
    [state.agents]
  );

  const selectedIndex = selectedMessageId
    ? state.messages.findIndex((m) => m.id === selectedMessageId)
    : -1;

  useInput((value, key) => {
    if (key.ctrl && value === 'c') {
      void router.dispose().finally(exit);
      return;
    }

    if (key.tab) {
      if (suggestions.length === 0) {
        return;
      }

      const agent = suggestions[selectedSuggestion] ?? suggestions[0];
      setInput((current) => applyMentionCompletion(current, agent));
      setSelectedSuggestion((current) => (suggestions.length === 0 ? 0 : (current + 1) % suggestions.length));
      return;
    }

    if (key.upArrow || key.downArrow) {
      navigateSelection(key.upArrow ? -1 : 1);
      return;
    }

    if (key.return) {
      if (input.trim()) {
        void submitInput();
      } else if (selectedMessageId) {
        router.toggleMessageExpansion(selectedMessageId);
      }
      return;
    }

    if (key.backspace || key.delete) {
      setInput((current) => current.slice(0, -1));
      return;
    }

    if (!key.ctrl && !key.meta && value) {
      setInput((current) => current + value);
    }
  });

  return (
    <Box flexDirection="column">
      <Header
        workdir={state.workdir}
        agents={state.agents}
        activeSessionId={state.activeSessionId}
        activeSessionTitle={state.activeSessionTitle}
        sessionCount={state.sessionCount}
      />
      <MessageStream messages={state.messages} selectedMessageId={selectedMessageId} />
      <StatusBar
        messageCount={state.messages.length}
        selectedIndex={selectedIndex}
        runningAgents={runningAgents}
        queuedCount={queuedCount}
        submitting={submitting}
      />
      <InputBox
        input={input}
        suggestions={suggestions}
        selectedSuggestion={selectedSuggestion}
        activeSuggestion={activeSuggestion}
        submitting={submitting}
        targetAgent={targetAgent}
        agentStates={state.agents}
      />
    </Box>
  );

  function navigateSelection(delta: number): void {
    if (state.messages.length === 0) {
      return;
    }

    const currentIndex = selectedMessageId
      ? state.messages.findIndex((message) => message.id === selectedMessageId)
      : state.messages.length - 1;
    const nextIndex = Math.min(state.messages.length - 1, Math.max(0, currentIndex + delta));
    setSelectedMessageId(state.messages[nextIndex]?.id ?? null);
  }

  async function submitInput(): Promise<void> {
    if (submitting) {
      return;
    }

    setSubmitting(true);
    try {
      const nextInput = input;
      setInput('');
      setSelectedSuggestion(0);
      await router.handleInput(nextInput);
      setSelectedMessageId(router.getState().messages.at(-1)?.id ?? selectedMessageId);
    } finally {
      setSubmitting(false);
    }
  }
}

function applyMentionCompletion(input: string, agent: AgentName): string {
  const mention = `@${agent.slice(0, 1).toUpperCase()}${agent.slice(1)}`;
  const index = input.lastIndexOf('@');
  if (index === -1) {
    return `${input}${mention} `;
  }

  return `${input.slice(0, index)}${mention} `;
}
