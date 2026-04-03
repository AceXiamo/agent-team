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
