import React, { useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { Box, Text } from 'ink';
import { ScrollView, type ScrollViewRef } from 'ink-scroll-view';

import type { Message } from '../types.js';
import { MessageBubble } from './MessageBubble.js';
import { pulse, useAnimationBeat } from './motion.js';

export interface MessageStreamHandle {
  scrollBy: (delta: number) => void;
}

interface MessageStreamProps {
  messages: Message[];
  selectedMessageId: string | null;
  shouldAnimate: boolean;
  searchMode?: boolean;
  searchQuery?: string;
  totalMessages?: number;
}

export const MessageStream = React.forwardRef<MessageStreamHandle, MessageStreamProps>(
  function MessageStream({ messages, selectedMessageId, shouldAnimate, searchMode, searchQuery, totalMessages }, ref) {
  const scrollRef = useRef<ScrollViewRef>(null);
  const liveCount = messages.filter((message) => message.status === 'streaming').length;
  const uiBeat = useAnimationBeat(shouldAnimate && liveCount > 0);
  const selectedIndex = selectedMessageId
    ? messages.findIndex((message) => message.id === selectedMessageId)
    : messages.length - 1;

  const focusLabel =
    selectedIndex === -1 || messages.length === 0 ? 'focus tail' : `focus ${selectedIndex + 1}/${messages.length}`;

  const headerRight = searchMode && searchQuery
    ? `filter "${searchQuery}" • ${messages.length}/${totalMessages ?? messages.length} match${messages.length !== 1 ? 'es' : ''} • ${focusLabel}`
    : `${totalMessages ?? messages.length} msgs • ${focusLabel} • ${liveCount > 0 ? `${liveCount} live` : 'idle'}`;

  const autoScrollRef = useRef(true);

  const handleScroll = useCallback((offset: number) => {
    const sv = scrollRef.current;
    if (!sv) return;
    autoScrollRef.current = offset >= sv.getBottomOffset() - 1;
  }, []);

  useEffect(() => {
    const sv = scrollRef.current;
    if (!sv) return;
    if (autoScrollRef.current) {
      sv.scrollToBottom();
    }
  }, [messages]);

  useEffect(() => {
    const sv = scrollRef.current;
    if (!sv || selectedIndex < 0) return;
    const pos = sv.getItemPosition(selectedIndex);
    if (!pos) return;
    const offset = sv.getScrollOffset();
    const vpHeight = sv.getViewportHeight();
    if (pos.top < offset) {
      sv.scrollTo(pos.top);
      autoScrollRef.current = false;
    } else if (pos.top + pos.height > offset + vpHeight) {
      sv.scrollTo(pos.top + pos.height - vpHeight);
      autoScrollRef.current = pos.top + pos.height >= sv.getContentHeight();
    }
  }, [selectedIndex]);

  useEffect(() => {
    const onResize = () => scrollRef.current?.remeasure();
    process.stdout.on('resize', onResize);
    return () => { process.stdout.off('resize', onResize); };
  }, []);

  useImperativeHandle(ref, () => ({
    scrollBy(delta: number) {
      const sv = scrollRef.current;
      if (!sv) return;
      sv.scrollBy(delta);
      autoScrollRef.current = sv.getScrollOffset() >= sv.getBottomOffset() - 1;
    }
  }), []);

  return (
    <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor={searchMode ? 'yellow' : 'blue'} paddingX={1} overflow="hidden">
      <Box justifyContent="space-between">
        <Text bold color={searchMode ? 'yellow' : 'blue'}>
          {searchMode ? '/' : pulse(uiBeat)} {searchMode ? 'Search' : 'Conversation'}
        </Text>
        <Text dimColor wrap="truncate">
          {headerRight}
        </Text>
      </Box>
      {messages.length === 0 && searchMode ? (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>No messages match the current filter.</Text>
        </Box>
      ) : messages.length === 0 ? (
        <EmptyState />
      ) : (
        <ScrollView ref={scrollRef} flexGrow={1} flexDirection="column" onScroll={handleScroll}>
          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              selected={message.id === selectedMessageId}
              shouldAnimate={shouldAnimate}
            />
          ))}
        </ScrollView>
      )}
    </Box>
  );
});

function EmptyState(): React.JSX.Element {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>No messages yet.</Text>
      <Text dimColor>Send one targeted message like `@Codex inspect src/` to start the thread.</Text>
      <Text dimColor>Delegations, tool activity, queueing, and agent replies will stream here.</Text>
    </Box>
  );
}
