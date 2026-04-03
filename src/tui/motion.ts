import { useEffect, useState } from 'react';

let globalBeat = 0;
let globalTimer: ReturnType<typeof setInterval> | null = null;
const beatSubscribers = new Set<() => void>();

function subscribeBeat(callback: () => void): () => void {
  beatSubscribers.add(callback);
  if (!globalTimer) {
    globalTimer = setInterval(() => {
      globalBeat = (globalBeat + 1) % 240;
      for (const sub of beatSubscribers) {
        sub();
      }
    }, 700);
  }
  return () => {
    beatSubscribers.delete(callback);
    if (beatSubscribers.size === 0 && globalTimer) {
      clearInterval(globalTimer);
      globalTimer = null;
      globalBeat = 0;
    }
  };
}

export function useAnimationBeat(active: boolean): number {
  const [beat, setBeat] = useState(0);

  useEffect(() => {
    if (!active) {
      setBeat(0);
      return;
    }
    setBeat(globalBeat);
    return subscribeBeat(() => {
      setBeat(globalBeat);
    });
  }, [active]);

  return beat;
}

export function frame(beat: number, frames: readonly string[]): string {
  if (frames.length === 0) {
    return '';
  }

  const index = Math.abs(beat) % frames.length;
  return frames[index] ?? frames[0] ?? '';
}

export function pulse(beat: number): string {
  return frame(beat, ['·', '•', '●', '•']);
}

export function sweep(beat: number): string {
  return frame(beat, ['◜', '◠', '◝', '◞', '◡', '◟']);
}

export function orbit(beat: number): string {
  return frame(beat, ['◐', '◓', '◑', '◒']);
}

export function meter(active: number, total: number, beat: number): string {
  const safeTotal = Math.max(total, 1);
  const width = Math.min(10, safeTotal + 2);
  const filled = Math.max(0, Math.min(width, active));
  const highlightIndex = active > 0 ? Math.min(width - 1, beat % width) : -1;
  let output = '';

  for (let index = 0; index < width; index += 1) {
    if (index < filled) {
      output += index === highlightIndex ? '■' : '▪';
      continue;
    }

    output += index === highlightIndex ? '·' : ' ';
  }

  return output.trimEnd();
}
