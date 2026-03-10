import { describe, expect, test } from 'vitest';
import { PlayerTui } from './player-tui.ts';

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '');
}

function renderOutput(
  notes: Array<{ channel: string; beat: number; seconds: number; endBeat?: number }>,
  options: {
    currentBeat?: number;
    currentSeconds?: number;
    totalSeconds?: number;
    lanes?: Array<{ channel: string; key: string; isScratch?: boolean }>;
    laneDisplayMode?: string;
    splitAfterIndex?: number;
    scrollTimeline?: Array<{ beat: number; speed: number }>;
    speedTimeline?: Array<{ beat: number; speed: number }>;
  } = {},
): string[] {
  const chunks: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  }) as typeof process.stdout.write;

  try {
    const tui = new PlayerTui({
      mode: 'AUTO',
      laneDisplayMode: options.laneDisplayMode ?? '5 KEY SP',
      title: 'test',
      lanes: options.lanes ?? [{ channel: '11', key: 'z' }],
      speed: 1,
      highSpeed: 1,
      judgeWindowMs: 100,
      splitAfterIndex: options.splitAfterIndex,
      scrollTimeline: options.scrollTimeline,
      speedTimeline: options.speedTimeline,
      stdoutIsTTY: true,
      stdinIsTTY: true,
    });
    tui.setTerminalSize(40, 24);
    tui.start();
    tui.render({
      currentBeat: options.currentBeat ?? 0,
      currentSeconds: options.currentSeconds ?? ((options.currentBeat ?? 0) / 2),
      totalSeconds: options.totalSeconds ?? 10,
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

  return stripAnsi(chunks.join('')).split('\n');
}

function renderRowsContaining(
  notes: Array<{ channel: string; beat: number; seconds: number; endBeat?: number }>,
  fragment: string,
  currentBeat = 0,
  options: {
    scrollTimeline?: Array<{ beat: number; speed: number }>;
    speedTimeline?: Array<{ beat: number; speed: number }>;
  } = {},
): number[] {
  return renderOutput(notes, {
    currentBeat,
    currentSeconds: currentBeat / 2,
    totalSeconds: 10,
    scrollTimeline: options.scrollTimeline,
    speedTimeline: options.speedTimeline,
  })
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

  test('speed timeline increases note spacing by interpolated keyframes', () => {
    const baselineRows = renderRowsContaining([{ channel: '11', beat: 0.5, seconds: 0.25 }], '███');
    const acceleratedRows = renderRowsContaining(
      [{ channel: '11', beat: 0.5, seconds: 0.25 }],
      '███',
      0,
      {
        speedTimeline: [
          { beat: 0, speed: 1 },
          { beat: 0.5, speed: 4 },
        ],
      },
    );

    expect(baselineRows.length).toBeGreaterThanOrEqual(1);
    expect(acceleratedRows.length).toBeGreaterThanOrEqual(1);
    expect(acceleratedRows[0]).toBeLessThan(baselineRows[0]);
  });

  test('renders play progress indicator on the left side of a single playfield', () => {
    const lines = renderOutput([]);
    const playfieldLines = lines.filter((line) => line.startsWith('● ') || line.startsWith('╎ '));

    expect(playfieldLines.length).toBeGreaterThan(0);
    expect(playfieldLines.every((line) => line.startsWith('● ') || line.startsWith('╎ '))).toBe(true);
  });

  test('moves the play progress marker from top to bottom over time', () => {
    const openingLines = renderOutput([], { currentSeconds: 0, totalSeconds: 10 }).filter(
      (line) => line.startsWith('● ') || line.startsWith('╎ '),
    );
    const endingLines = renderOutput([], { currentSeconds: 10, totalSeconds: 10 }).filter(
      (line) => line.startsWith('● ') || line.startsWith('╎ '),
    );

    expect(openingLines.findIndex((line) => line.startsWith('● '))).toBe(0);
    expect(endingLines.findIndex((line) => line.startsWith('● '))).toBe(endingLines.length - 1);
  });

  test('stops the play progress rail at the judge line', () => {
    const lines = renderOutput([], { currentSeconds: 10, totalSeconds: 10 });
    const playfieldLineIndices = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => line.startsWith('● ') || line.startsWith('╎ '))
      .map(({ index }) => index);
    const postPlayfieldLines = lines.slice((playfieldLineIndices.at(-1) ?? -1) + 1);

    expect(playfieldLineIndices.length).toBeGreaterThan(0);
    expect(postPlayfieldLines.some((line) => line.startsWith('● ') || line.startsWith('╎ '))).toBe(false);
  });

  test('renders the 2P play progress indicator on the right side of split lanes', () => {
    const lines = renderOutput([], {
      laneDisplayMode: '5 KEY DP',
      lanes: [
        { channel: '16', key: 'LShift', isScratch: true },
        { channel: '26', key: 'RShift', isScratch: true },
      ],
      splitAfterIndex: 0,
    });
    const playfieldLines = lines
      .map((line) => line.trimEnd())
      .filter((line) => line.startsWith('● ') || line.startsWith('╎ '));

    expect(playfieldLines.length).toBeGreaterThan(0);
    expect(playfieldLines.every((line) => line.endsWith(' ●') || line.endsWith(' ╎'))).toBe(true);
  });
});
