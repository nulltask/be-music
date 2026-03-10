import { describe, expect, test } from 'vitest';
import { PlayerTui } from './player-tui.ts';

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '');
}

function renderRowsContaining(
  notes: Array<{ channel: string; beat: number; seconds: number; endBeat?: number }>,
  fragment: string,
  currentBeat = 0,
): number[] {
  const chunks: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  }) as typeof process.stdout.write;

  try {
    const tui = new PlayerTui({
      mode: 'AUTO',
      laneDisplayMode: '5 KEY SP',
      title: 'test',
      lanes: [{ channel: '11', key: 'z' }],
      speed: 1,
      highSpeed: 1,
      judgeWindowMs: 100,
      stdoutIsTTY: true,
      stdinIsTTY: true,
    });
    tui.setTerminalSize(40, 24);
    tui.start();
    tui.render({
      currentBeat,
      currentSeconds: currentBeat / 2,
      totalSeconds: 10,
      summary: {
        total: 1,
        perfect: 0,
        fast: 0,
        slow: 0,
        great: 0,
        good: 0,
        bad: 0,
        poor: 0,
        exScore: 0,
        score: 0,
      },
      notes: notes.map((note) => ({
        ...note,
        judged: false,
      })),
    });
    tui.stop();
  } finally {
    process.stdout.write = originalWrite;
  }

  return stripAnsi(chunks.join(''))
    .split('\n')
    .map((line, index) => [index, line] as const)
    .filter(([, line]) => line.includes(fragment))
    .map(([index]) => index);
}

describe('player-tui', () => {
  test('long note head stays on the same row as a regular note at the same beat', () => {
    const regularHeadRows = renderRowsContaining([{ channel: '11', beat: 1, seconds: 0.5 }], '███');
    const longNoteHeadRows = renderRowsContaining([{ channel: '11', beat: 1, endBeat: 2, seconds: 0.5 }], '███');

    expect(regularHeadRows.length).toBeGreaterThanOrEqual(2);
    expect(longNoteHeadRows.length).toBeGreaterThanOrEqual(2);
    expect(longNoteHeadRows[0]).toBe(regularHeadRows[0]);
  });

  test('long note tail stays on the same row as a regular note at the same beat', () => {
    const regularHeadRows = renderRowsContaining([{ channel: '11', beat: 2, seconds: 1 }], '███', 0.5);
    const longNoteTailRows = renderRowsContaining([{ channel: '11', beat: 1, endBeat: 2, seconds: 0.5 }], '▒▒▒', 0.5);

    expect(regularHeadRows.length).toBeGreaterThanOrEqual(2);
    expect(longNoteTailRows.length).toBeGreaterThanOrEqual(1);
    expect(longNoteTailRows[0]).toBe(regularHeadRows[0]);
  });
});
