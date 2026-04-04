import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, useApp, useInput, useStdin } from 'ink';

import { extractMentionCandidates } from '../core/commandParser.js';
import { senderLabel } from '../core/utils.js';
import type { AgentName, AppState } from '../types.js';
import { ContextPanel } from './ContextPanel.js';
import { Header } from './Header.js';
import { InputBox } from './InputBox.js';
import { MessageStream, type MessageStreamHandle } from './MessageStream.js';
import { SearchBar } from './SearchBar.js';
import { StatusBar } from './StatusBar.js';
import { messageMatchesQuery } from './search.js';
import { MessageRouter } from '../core/router.js';

const SCROLL_LINES = 3;

interface AppProps {
  router: MessageRouter;
}

export function App({ router }: AppProps): React.JSX.Element {
  const { exit } = useApp();
  const { stdin } = useStdin();
  const [state, setState] = useState<AppState>(router.getState());
  const [input, setInput] = useState('');
  const [cursor, setCursor] = useState(0);
  const [terminalFocused, setTerminalFocused] = useState(true);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(state.messages.at(-1)?.id ?? null);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [searchMode, setSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchCursor, setSearchCursor] = useState(0);
  const previousLastMessageId = useRef<string | null>(state.messages.at(-1)?.id ?? null);
  const messageStreamRef = useRef<MessageStreamHandle>(null);

  useEffect(() => router.subscribe(setState), [router]);

  const activeAgentCount = useMemo(() =>
    Object.values(state.agents).filter((agent) => agent.status === 'running' || agent.activeMode === 'review_handoff').length,
    [state.agents]
  );

  useEffect(() => {
    if (!process.stdout.isTTY || !stdin) {
      return;
    }

    const handleFocusChange = (chunk: string | Buffer): void => {
      const raw = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk;
      if (raw.includes('\u001b[I')) {
        setTerminalFocused(true);
      }
      if (raw.includes('\u001b[O')) {
        setTerminalFocused(false);
      }
    };

    process.stdout.write('\u001b[?1004h');
    stdin.on('data', handleFocusChange);

    return () => {
      stdin.off('data', handleFocusChange);
      process.stdout.write('\u001b[?1004l');
    };
  }, [stdin]);

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

  const liveCount = useMemo(() =>
    state.messages.filter((message) => message.status === 'streaming').length,
    [state.messages]
  );

  const filteredMessages = useMemo(() => {
    if (!searchMode || !searchQuery.trim()) return state.messages;
    return state.messages.filter((msg) => messageMatchesQuery(msg, searchQuery));
  }, [state.messages, searchMode, searchQuery]);

  useEffect(() => {
    if (!searchMode) {
      return;
    }

    if (filteredMessages.length === 0) {
      if (selectedMessageId !== null) {
        setSelectedMessageId(null);
      }
      return;
    }

    if (!selectedMessageId || !filteredMessages.some((message) => message.id === selectedMessageId)) {
      setSelectedMessageId(filteredMessages[0]?.id ?? null);
    }
  }, [filteredMessages, searchMode, selectedMessageId]);

  const shouldAnimate = terminalFocused && (submitting || liveCount > 0 || activeAgentCount > 0);

  const pendingReviewCount = useMemo(() =>
    Object.values(state.agents).reduce((sum, agent) => sum + agent.pendingReviewCount, 0),
    [state.agents]
  );

  const disabledAgents = useMemo(() =>
    Object.values(state.agents)
      .filter((agent) => !agent.enabled)
      .map((agent) => senderLabel(agent.name)),
    [state.agents]
  );

  const selectedIndex = selectedMessageId
    ? filteredMessages.findIndex((m) => m.id === selectedMessageId)
    : -1;

  useInput((value, key) => {
    if (value === '[I' || value === '[O') {
      return;
    }

    if (key.ctrl && value === 'c') {
      if (activeAgentCount > 0) {
        void router.interruptActiveWork();
        return;
      }
      void router.dispose().finally(exit);
      return;
    }

    // Enter / exit search mode
    if (key.ctrl && value === 'f') {
      if (!searchMode) {
        setSearchMode(true);
        setSearchQuery('');
        setSearchCursor(0);
      }
      return;
    }

    // ── Search mode key handling ──────────────────────────────────────────
    if (searchMode) {
      if (key.escape) {
        setSearchMode(false);
        setSearchQuery('');
        setSearchCursor(0);
        setSelectedMessageId((current) => current ?? state.messages.at(-1)?.id ?? null);
        return;
      }

      if (key.upArrow || key.downArrow) {
        messageStreamRef.current?.scrollBy(key.upArrow ? -SCROLL_LINES : SCROLL_LINES);
        return;
      }

      if (key.ctrl && value === 'p') { navigateSelection(-1); return; }
      if (key.ctrl && value === 'n') { navigateSelection(1); return; }
      if (key.ctrl && value === 'l') {
        setSelectedMessageId(filteredMessages.at(-1)?.id ?? null);
        return;
      }

      if (key.return) {
        if (selectedMessageId) {
          router.toggleMessageExpansion(selectedMessageId);
        }
        return;
      }

      if (key.leftArrow) {
        if (key.meta || key.ctrl) {
          setSearchCursor(0);
        } else {
          setSearchCursor((c) => Math.max(0, c - 1));
        }
        return;
      }
      if (key.rightArrow) {
        if (key.meta || key.ctrl) {
          setSearchCursor(searchQuery.length);
        } else {
          setSearchCursor((c) => Math.min(searchQuery.length, c + 1));
        }
        return;
      }
      if (key.ctrl && value === 'a') { setSearchCursor(0); return; }
      if (key.ctrl && value === 'e') { setSearchCursor(searchQuery.length); return; }
      if (key.ctrl && value === 'u') {
        setSearchQuery((q) => { const next = q.slice(searchCursor); setSearchCursor(0); return next; });
        return;
      }
      if (key.ctrl && value === 'k') {
        setSearchQuery((q) => q.slice(0, searchCursor));
        return;
      }
      if (key.ctrl && value === 'w') {
        setSearchQuery((q) => {
          const before = q.slice(0, searchCursor);
          const after = q.slice(searchCursor);
          const trimmed = before.replace(/\S+\s*$/, '');
          setSearchCursor(trimmed.length);
          return trimmed + after;
        });
        return;
      }
      if (key.backspace || key.delete) {
        if (searchCursor <= 0) return;
        setSearchQuery((q) => q.slice(0, searchCursor - 1) + q.slice(searchCursor));
        setSearchCursor((c) => c - 1);
        return;
      }
      if (!key.ctrl && !key.meta && value) {
        setSearchQuery((q) => {
          const next = q.slice(0, searchCursor) + value + q.slice(searchCursor);
          setSearchCursor((c) => c + value.length);
          return next;
        });
        return;
      }
      return;
    }

    // ── Normal mode key handling ──────────────────────────────────────────
    if (key.ctrl && value === 'p') { navigateSelection(-1); return; }
    if (key.ctrl && value === 'n') { navigateSelection(1); return; }
    if (key.ctrl && value === 'l') { setSelectedMessageId(state.messages.at(-1)?.id ?? null); return; }

    if (key.escape) {
      setInput('');
      setCursor(0);
      setSelectedSuggestion(0);
      return;
    }

    if (key.tab) {
      if (suggestions.length === 0) return;
      const agent = suggestions[selectedSuggestion] ?? suggestions[0];
      setInput((current) => {
        const next = applyMentionCompletion(current, agent);
        setCursor(next.length);
        return next;
      });
      setSelectedSuggestion((current) => (suggestions.length === 0 ? 0 : (current + 1) % suggestions.length));
      return;
    }

    if (key.upArrow || key.downArrow) {
      messageStreamRef.current?.scrollBy(key.upArrow ? -SCROLL_LINES : SCROLL_LINES);
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

    if (key.leftArrow) {
      if (key.meta || key.ctrl) {
        setCursor(0);
      } else {
        setCursor((c) => Math.max(0, c - 1));
      }
      return;
    }

    if (key.rightArrow) {
      if (key.meta || key.ctrl) {
        setCursor(input.length);
      } else {
        setCursor((c) => Math.min(input.length, c + 1));
      }
      return;
    }

    // Ctrl+A: move to start
    if (key.ctrl && value === 'a') { setCursor(0); return; }
    // Ctrl+E: move to end
    if (key.ctrl && value === 'e') { setCursor(input.length); return; }
    // Ctrl+U: delete from cursor to start
    if (key.ctrl && value === 'u') {
      setInput((current) => { const next = current.slice(cursor); setCursor(0); return next; });
      return;
    }
    // Ctrl+K: delete from cursor to end
    if (key.ctrl && value === 'k') {
      setInput((current) => current.slice(0, cursor));
      return;
    }
    // Ctrl+W: delete word backwards
    if (key.ctrl && value === 'w') {
      setInput((current) => {
        const before = current.slice(0, cursor);
        const after = current.slice(cursor);
        const trimmed = before.replace(/\S+\s*$/, '');
        setCursor(trimmed.length);
        return trimmed + after;
      });
      return;
    }

    if (key.backspace || key.delete) {
      setInput((current) => {
        if (cursor <= 0) return current;
        const next = current.slice(0, cursor - 1) + current.slice(cursor);
        setCursor((c) => c - 1);
        return next;
      });
      return;
    }

    if (!key.ctrl && !key.meta && value) {
      setInput((current) => {
        const next = current.slice(0, cursor) + value + current.slice(cursor);
        setCursor((c) => c + value.length);
        return next;
      });
    }
  });

  const cols = process.stdout.columns ?? 80;
  const rows = process.stdout.rows ?? 24;
  const sidebarWidth = Math.max(30, Math.min(44, Math.floor(cols * 0.3)));

  return (
    <Box flexDirection="row" width={cols} height={rows} overflow="hidden">
      <Box flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden">
        <MessageStream
          ref={messageStreamRef}
          messages={filteredMessages}
          selectedMessageId={selectedMessageId}
          shouldAnimate={shouldAnimate}
          searchMode={searchMode}
          searchQuery={searchQuery}
          totalMessages={state.messages.length}
        />
        <StatusBar
          messageCount={filteredMessages.length}
          selectedIndex={selectedIndex}
          runningAgents={runningAgents}
          queuedCount={queuedCount}
          pendingReviewCount={pendingReviewCount}
          disabledAgents={disabledAgents}
          submitting={submitting}
          liveCount={liveCount}
          shouldAnimate={shouldAnimate}
        />
        {searchMode ? (
          <SearchBar
            query={searchQuery}
            cursor={searchCursor}
            matchCount={filteredMessages.length}
            totalCount={state.messages.length}
          />
        ) : (
          <InputBox
            input={input}
            cursor={cursor}
            suggestions={suggestions}
            selectedSuggestion={selectedSuggestion}
            activeSuggestion={activeSuggestion}
            submitting={submitting}
            targetAgent={targetAgent}
            agentStates={state.agents}
            shouldAnimate={shouldAnimate}
          />
        )}
      </Box>
      <Box flexDirection="column" width={sidebarWidth} flexShrink={0} overflow="hidden">
        <Header
          workdir={state.workdir}
          agents={state.agents}
          activeSessionId={state.activeSessionId}
          activeSessionTitle={state.activeSessionTitle}
          sessionCount={state.sessionCount}
          messageCount={state.messages.length}
          liveCount={liveCount}
          shouldAnimate={shouldAnimate}
        />
        <ContextPanel messages={state.messages} selectedMessageId={selectedMessageId} shouldAnimate={shouldAnimate} />
      </Box>
    </Box>
  );

  function navigateSelection(delta: number): void {
    const pool = searchMode ? filteredMessages : state.messages;
    if (pool.length === 0) {
      return;
    }

    const currentIndex = selectedMessageId
      ? pool.findIndex((message) => message.id === selectedMessageId)
      : pool.length - 1;
    const nextIndex = Math.min(pool.length - 1, Math.max(0, currentIndex + delta));
    setSelectedMessageId(pool[nextIndex]?.id ?? null);
  }

  async function submitInput(): Promise<void> {
    if (submitting) {
      return;
    }

    setSubmitting(true);
    try {
      const nextInput = input;
      setInput('');
      setCursor(0);
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
