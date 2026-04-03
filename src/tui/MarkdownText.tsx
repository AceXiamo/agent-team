import React from 'react';
import { Box, Text } from 'ink';

interface MarkdownTextProps {
  text: string;
}

export function MarkdownText({ text }: MarkdownTextProps): React.JSX.Element {
  const blocks = parseBlocks(text);

  return (
    <Box flexDirection="column">
      {blocks.map((block, index) => {
        if (block.type === 'code') {
          return (
            <Box key={index} marginLeft={2} flexDirection="column">
              <Text color="cyan">{block.language ? `\`\`\`${block.language}` : '```'}</Text>
              {block.lines.map((line, lineIndex) => (
                <Text key={lineIndex} color="cyan">
                  {line}
                </Text>
              ))}
              <Text color="cyan">```</Text>
            </Box>
          );
        }

        return <LineBlock key={index} line={block.line} />;
      })}
    </Box>
  );
}

function LineBlock({ line }: { line: string }): React.JSX.Element {
  if (!line.trim()) {
    return <Text> </Text>;
  }

  if (line.startsWith('#')) {
    const level = line.match(/^#+/)?.[0].length ?? 1;
    return (
      <Text bold color={level === 1 ? 'cyan' : 'blue'}>
        {line.replace(/^#+\s*/, '')}
      </Text>
    );
  }

  if (line.startsWith('> ')) {
    return (
      <Text color="gray">
        │ {renderInline(line.slice(2))}
      </Text>
    );
  }

  if (/^(\-|\*)\s+/.test(line)) {
    return <Text>{['• ', ...renderInline(line.replace(/^(\-|\*)\s+/, ''))]}</Text>;
  }

  if (/^\d+\.\s+/.test(line)) {
    const marker = line.match(/^\d+\./)?.[0] ?? '1.';
    return <Text>{[`${marker} `, ...renderInline(line.replace(/^\d+\.\s+/, ''))]}</Text>;
  }

  return <Text>{renderInline(line)}</Text>;
}

type Block =
  | { type: 'text'; line: string }
  | { type: 'code'; language: string; lines: string[] };

function parseBlocks(text: string): Block[] {
  const lines = text.split('\n');
  const blocks: Block[] = [];
  let inCode = false;
  let codeLanguage = '';
  let codeLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (!inCode) {
        inCode = true;
        codeLanguage = line.slice(3).trim();
        codeLines = [];
      } else {
        blocks.push({ type: 'code', language: codeLanguage, lines: [...codeLines] });
        inCode = false;
        codeLanguage = '';
        codeLines = [];
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
    } else {
      blocks.push({ type: 'text', line });
    }
  }

  if (inCode) {
    blocks.push({ type: 'code', language: codeLanguage, lines: [...codeLines] });
  }

  return blocks;
}

function renderInline(line: string): React.ReactNode[] {
  const tokens = line.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g).filter(Boolean);

  return tokens.map((token, index) => {
    if (token.startsWith('`') && token.endsWith('`')) {
      return (
        <Text key={index} color="yellow">
          {token.slice(1, -1)}
        </Text>
      );
    }

    if (token.startsWith('**') && token.endsWith('**')) {
      return (
        <Text key={index} bold>
          {token.slice(2, -2)}
        </Text>
      );
    }

    if (token.startsWith('*') && token.endsWith('*')) {
      return (
        <Text key={index} italic>
          {token.slice(1, -1)}
        </Text>
      );
    }

    return <Text key={index}>{token}</Text>;
  });
}
