import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';

import { extractMentionCandidates } from '../core/commandParser.js';
import type { AgentName, AppState } from '../types.js';
import { Header } from './Header.js';
import { InputBox } from './InputBox.js';
import { MessageStream } from './MessageStream.js';
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

  useEffect(() => {
    if (selectedSuggestion >= suggestions.length) {
      setSelectedSuggestion(0);
    }
  }, [selectedSuggestion, suggestions.length]);

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
      <Header workdir={state.workdir} agents={state.agents} />
      <MessageStream messages={state.messages} selectedMessageId={selectedMessageId} />
      <InputBox input={input} suggestions={suggestions} selectedSuggestion={selectedSuggestion} />
      {submitting ? <Text dimColor>Sending...</Text> : null}
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
