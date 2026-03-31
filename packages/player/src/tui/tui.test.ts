import { describe, expect, test } from 'vitest';
import { PlayerTui } from './tui.ts';

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '');
}

const PLAY_PROGRESS_HEAD_MARKER = '\u001b[38;2;255;186;54m┃\u001b[0m';
const PLAY_PROGRESS_GROOVE_MARKER = '\u001b[38;2;18;18;18m┃\u001b[0m';

function renderOutputRaw(
  notes: Array<{ channel: string; beat: number; seconds: number; endBeat?: number }>,
  options: {
    currentBeat?: number;
    currentSeconds?: number;
    totalSeconds?: number;
    invisibleNotes?: Array<{ channel: string; beat: number; seconds: number; endBeat?: number }>;
    lanes?: Array<{ channel: string; key: string; isScratch?: boolean }>;
    laneDisplayMode?: string;
    splitAfterIndex?: number;
    highSpeed?: number;
    visibleNotesLimit?: number;
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
      highSpeed: options.highSpeed ?? 1,
      visibleNotesLimit: options.visibleNotesLimit,
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
      invisibleNotes: options.invisibleNotes?.map((note) => ({
        ...note,
        judged: false,
        invisible: true,
      })),
    });
    tui.stop();
  } finally {
    process.stdout.write = originalWrite;
  }

  return chunks.join('').split('\n');
}

function renderOutput(
  notes: Array<{ channel: string; beat: number; seconds: number; endBeat?: number }>,
  options: {
    currentBeat?: number;
    currentSeconds?: number;
    totalSeconds?: number;
    invisibleNotes?: Array<{ channel: string; beat: number; seconds: number; endBeat?: number }>;
    lanes?: Array<{ channel: string; key: string; isScratch?: boolean }>;
    laneDisplayMode?: string;
    splitAfterIndex?: number;
    highSpeed?: number;
    visibleNotesLimit?: number;
    scrollTimeline?: Array<{ beat: number; speed: number }>;
    speedTimeline?: Array<{ beat: number; speed: number }>;
  } = {},
): string[] {
  return stripAnsi(renderOutputRaw(notes, options).join('\n')).split('\n');
}

function renderRowsContaining(
  notes: Array<{ channel: string; beat: number; seconds: number; endBeat?: number }>,
  fragment: string,
  currentBeat = 0,
  options: {
    invisibleNotes?: Array<{ channel: string; beat: number; seconds: number; endBeat?: number }>;
    highSpeed?: number;
    lanes?: Array<{ channel: string; key: string; isScratch?: boolean }>;
    visibleNotesLimit?: number;
    scrollTimeline?: Array<{ beat: number; speed: number }>;
    speedTimeline?: Array<{ beat: number; speed: number }>;
  } = {},
): number[] {
  return renderOutput(notes, {
    currentBeat,
    currentSeconds: currentBeat / 2,
    totalSeconds: 10,
    invisibleNotes: options.invisibleNotes,
    highSpeed: options.highSpeed,
    lanes: options.lanes,
    visibleNotesLimit: options.visibleNotesLimit,
    scrollTimeline: options.scrollTimeline,
    speedTimeline: options.speedTimeline,
  })
    .map((line, index) => [index, line] as const)
    .filter(([, line]) => line.includes(fragment))
    .map(([index]) => index);
}

function isLeftProgressRailLine(line: string): boolean {
  return line.startsWith('┃');
}

function isRightProgressRailLine(line: string): boolean {
  return line.trimEnd().endsWith('┃');
}

function isLeftProgressRailLineRaw(line: string): boolean {
  return line.startsWith(PLAY_PROGRESS_HEAD_MARKER) || line.startsWith(PLAY_PROGRESS_GROOVE_MARKER);
}

function createKittyTestImage(token: string, color: { r: number; g: number; b: number }) {
  const rgb = new Uint8Array(4 * 4 * 3);
  for (let index = 0; index < rgb.length; index += 3) {
    rgb[index] = color.r;
    rgb[index + 1] = color.g;
    rgb[index + 2] = color.b;
  }
  return {
    pixelWidth: 4,
    pixelHeight: 4,
    cellWidth: 1,
    cellHeight: 1,
    rgb,
    token,
  };
}

function createSummary(score = 0) {
  return {
    total: 1,
    perfect: 0,
    fast: 0,
    slow: 0,
    great: 0,
    good: 0,
    bad: 0,
    poor: 0,
    exScore: 0,
    score,
  };
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

  test('renders notes that re-enter the visible window under bidirectional scroll', () => {
    const oscillatingScrollTimeline = Array.from({ length: 16 }, (_, index) => ({
      beat: index * 0.5,
      speed: index % 2 === 0 ? 1 : -1,
    }));

    const rows = renderRowsContaining(
      [{ channel: '11', beat: 8, seconds: 4 }],
      '███',
      0,
      {
        highSpeed: 3.5,
        scrollTimeline: oscillatingScrollTimeline,
      },
    );

    expect(rows.length).toBeGreaterThan(0);
  });

  test('keeps rendering visible notes when invisible notes saturate their own window', () => {
    const invisibleNotes = Array.from({ length: 64 }, (_, index) => ({
      channel: '12',
      beat: 0.05 + index * 0.05,
      seconds: 0.025 + index * 0.025,
    }));

    const rows = renderRowsContaining(
      [{ channel: '11', beat: 1, seconds: 0.5 }],
      '███',
      0,
      {
        invisibleNotes,
        visibleNotesLimit: 8,
        lanes: [
          { channel: '11', key: 'z' },
          { channel: '12', key: 's' },
        ],
      },
    );

    expect(rows.length).toBeGreaterThan(0);
  });

  test('does not render future long note bodies at the top edge under bidirectional scroll', () => {
    const bidirectionalScrollTimeline = [
      { beat: 0, speed: 1 },
      { beat: 0.5, speed: -1 },
      { beat: 1, speed: 1 },
    ];

    const bodyRows = renderRowsContaining(
      [{ channel: '11', beat: 8, endBeat: 8.5, seconds: 4 }],
      '▓▓▓',
      0,
      {
        highSpeed: 3.5,
        scrollTimeline: bidirectionalScrollTimeline,
      },
    );

    expect(bodyRows).toHaveLength(0);
  });

  test('renders play progress indicator on the left side of a single playfield', () => {
    const lines = renderOutput([]);
    const playfieldLines = lines.filter((line) => isLeftProgressRailLine(line));

    expect(playfieldLines.length).toBeGreaterThan(0);
    expect(playfieldLines.every((line) => isLeftProgressRailLine(line))).toBe(true);
  });

  test('moves the play progress marker from top to bottom over time', () => {
    const openingLines = renderOutputRaw([], { currentSeconds: 0, totalSeconds: 10 }).filter(
      (line) => isLeftProgressRailLineRaw(line),
    );
    const endingLines = renderOutputRaw([], { currentSeconds: 10, totalSeconds: 10 }).filter(
      (line) => isLeftProgressRailLineRaw(line),
    );

    expect(openingLines.findIndex((line) => line.includes(PLAY_PROGRESS_HEAD_MARKER))).toBe(0);
    expect(endingLines.findIndex((line) => line.includes(PLAY_PROGRESS_HEAD_MARKER))).toBe(endingLines.length - 1);
  });

  test('stops the play progress rail at the judge line', () => {
    const lines = renderOutput([], { currentSeconds: 10, totalSeconds: 10 });
    const playfieldLineIndices = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => isLeftProgressRailLine(line))
      .map(({ index }) => index);
    const postPlayfieldLines = lines.slice((playfieldLineIndices.at(-1) ?? -1) + 1);

    expect(playfieldLineIndices.length).toBeGreaterThan(0);
    expect(postPlayfieldLines.some((line) => isLeftProgressRailLine(line))).toBe(false);
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
      .filter((line) => isLeftProgressRailLine(line));

    expect(playfieldLines.length).toBeGreaterThan(0);
    expect(playfieldLines.every((line) => isRightProgressRailLine(line))).toBe(true);
  });

  test('updates kitty BGA by double-buffering image ids instead of overwriting the visible image', () => {
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
        terminalImageProtocol: 'kitty',
      });
      tui.setTerminalSize(40, 24);
      tui.start();
      chunks.length = 0;

      tui.render({
        currentBeat: 0,
        currentSeconds: 0,
        totalSeconds: 10,
        summary: createSummary(),
        notes: [],
        bgaKittyImage: createKittyTestImage('frame-1', { r: 255, g: 0, b: 0 }),
      });
      const firstRender = chunks.join('');
      chunks.length = 0;

      tui.render({
        currentBeat: 1,
        currentSeconds: 1,
        totalSeconds: 10,
        summary: createSummary(),
        notes: [],
        bgaKittyImage: createKittyTestImage('frame-2', { r: 0, g: 255, b: 0 }),
      });
      const secondRender = chunks.join('');
      tui.stop();

      expect(firstRender).toContain('i=1337');
      expect(firstRender).toContain('a=T');
      expect(secondRender).toContain('i=1338');
      expect(secondRender).toContain('a=T');
      expect(secondRender).toContain('a=d,d=I,i=1337');
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  test('updates only changed rows after the first frame render', () => {
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
      chunks.length = 0;

      tui.render({
        currentBeat: 0,
        currentSeconds: 0,
        totalSeconds: 10,
        summary: createSummary(),
        notes: [],
      });
      const firstRender = chunks.join('');
      chunks.length = 0;

      tui.render({
        currentBeat: 0.5,
        currentSeconds: 0.25,
        totalSeconds: 10,
        summary: createSummary(),
        notes: [],
      });
      const secondRender = chunks.join('');
      tui.stop();

      expect(firstRender).toContain('\u001b[H');
      expect(firstRender).toContain('\n');
      expect(secondRender).not.toContain('\u001b[2J');
      expect(secondRender).not.toContain('\u001b[H');
      expect(secondRender).toMatch(/\u001b\[\d+;1H/);
      expect(secondRender).not.toContain('\n');
      expect(secondRender.length).toBeLessThan(firstRender.length);
    } finally {
      process.stdout.write = originalWrite;
    }
  });
});
