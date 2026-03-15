import { describe, expect, test } from 'vitest';
import type readline from 'node:readline';
import {
  applyPersistedPlayerConfigToArgs,
  createPlayLoadingProgressScreenOutput,
  createPlayLoadingProgressScreenLines,
  createMusicSelectControlLines,
  createMusicSelectSelectedMetadataLines,
  cyclePlayMode,
  formatPlayModeLabel,
  parseArgs,
  resolveCliConfigOverrideFlags,
  resolveDefaultPlayerLogPath,
  resolvePlayLoadingStageFileDisplaySize,
  resolvePersistedPlayerConfigFromArgs,
  resolveCircularSelectableIndex,
  resolvePageSelectableIndex,
  resolvePlayModeFromArgs,
  resolveResultScreenActionFromKey,
  resolveMusicSelectDifficultyFilter,
  resolveMusicSelectInitialFocusKey,
  resolveMusicSelectNavigationAction,
  resolveVisibleEntryRange,
} from './cli.ts';
import {
  createSelectionColumnLayout,
  formatDifficultyLabel,
  formatPlayLevelLabel,
  formatRankLabel,
  formatSelectionColumnHeader,
  formatSelectionEntryLabel,
  truncateForDisplay,
} from './cli/selection-format.ts';

function measureMusicSelectTestDisplayWidth(value: string): number {
  let width = 0;
  let escape = false;
  for (const char of value) {
    if (escape) {
      if (char === 'm') {
        escape = false;
      }
      continue;
    }
    if (char === '\u001b') {
      escape = true;
      continue;
    }
    width += measureMusicSelectTestCharacterWidth(char);
  }
  return width;
}

function measureMusicSelectTestCharacterWidth(char: string): number {
  const codePoint = char.codePointAt(0);
  if (codePoint === undefined) {
    return 0;
  }
  if (
    codePoint === 0 ||
    codePoint < 32 ||
    (codePoint >= 0x7f && codePoint < 0xa0) ||
    codePoint === 0x200d ||
    codePoint === 0xfe0e ||
    codePoint === 0xfe0f ||
    /\p{Mark}/u.test(char)
  ) {
    return 0;
  }
  if (codePoint < 0x1100) {
    return 1;
  }
  return codePoint <= 0x115f ||
    codePoint === 0x2329 ||
    codePoint === 0x232a ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1f64f) ||
    (codePoint >= 0x1f680 && codePoint <= 0x1f6ff) ||
    (codePoint >= 0x1f900 && codePoint <= 0x1f9ff) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
    ? 2
    : 1;
}

describe('player cli', () => {
  test('cli: parses --auto-scratch mode', () => {
    const parsed = parseArgs(['chart.bms', '--auto-scratch']);
    expect(parsed.auto).toBe(false);
    expect(parsed.autoScratch).toBe(true);
    expect(resolvePlayModeFromArgs(parsed)).toBe('auto-scratch');
  });

  test('cli: keeps BMS LN type auto-detection enabled by default and lets the user disable it', () => {
    expect(parseArgs(['chart.bms']).inferBmsLnTypeWhenMissing).toBe(true);
    const parsed = parseArgs(['chart.bms', '--no-ln-type-auto']);
    expect(parsed.inferBmsLnTypeWhenMissing).toBe(false);
    expect(parseArgs(['chart.bms', '--no-ln-type-auto', '--ln-type-auto']).inferBmsLnTypeWhenMissing).toBe(true);
  });

  test('cli: accepts --ln-type-auto explicitly', () => {
    const parsed = parseArgs(['chart.bms', '--ln-type-auto']);
    expect(parsed.inferBmsLnTypeWhenMissing).toBe(true);
  });

  test('cli: keeps kitty graphics enabled by default and lets the user disable it', () => {
    expect(parseArgs(['chart.bms']).kittyGraphics).toBe(true);
    expect(parseArgs(['chart.bms', '--no-kitty-graphics']).kittyGraphics).toBe(false);
    expect(parseArgs(['chart.bms', '--no-kitty-graphics', '--kitty-graphics']).kittyGraphics).toBe(true);
  });

  test('cli: enables video BGA streaming by default and lets the user switch back to legacy decode', () => {
    expect(parseArgs(['chart.bms']).videoBgaStreaming).toBe(true);
    expect(parseArgs(['chart.bms', '--no-video-bga-streaming']).videoBgaStreaming).toBe(false);
    expect(parseArgs(['chart.bms', '--no-video-bga-streaming', '--video-bga-streaming']).videoBgaStreaming).toBe(
      true,
    );
  });

  test('cli: defaults TUI rendering to 60fps and accepts custom fps', () => {
    expect(parseArgs(['chart.bms']).uiFps).toBe(60);
    expect(parseArgs(['chart.bms', '--tui-fps', '120']).uiFps).toBe(120);
    expect(parseArgs(['chart.bms', '--tui-fps', '59.94']).uiFps).toBe(59.94);
  });

  test('cli: accepts --log-file for structured file logging', () => {
    expect(parseArgs(['chart.bms', '--log-file', '/tmp/be-music.log']).logFile).toBe('/tmp/be-music.log');
    expect(() => parseArgs(['chart.bms', '--log-file'])).toThrow('--log-file expects a path');
  });

  test('cli: resolves the default structured log path under ~/.be-music/logs', () => {
    expect(resolveDefaultPlayerLogPath()).toMatch(/\.be-music\/logs\/player\.ndjson$/);
  });

  test('cli: rejects invalid --tui-fps values', () => {
    expect(() => parseArgs(['chart.bms', '--tui-fps', '0'])).toThrow('--tui-fps must be greater than 0');
    expect(() => parseArgs(['chart.bms', '--tui-fps', 'abc'])).toThrow('--tui-fps expects a numeric value');
  });

  test('cli: last explicit mode flag wins', () => {
    const parsedAuto = parseArgs(['chart.bms', '--auto-scratch', '--auto']);
    expect(resolvePlayModeFromArgs(parsedAuto)).toBe('auto');

    const parsedAutoScratch = parseArgs(['chart.bms', '--auto', '--auto-scratch']);
    expect(resolvePlayModeFromArgs(parsedAutoScratch)).toBe('auto-scratch');
  });

  test('cli: detects explicit play-mode and high-speed override flags', () => {
    expect(resolveCliConfigOverrideFlags(['chart.bms'])).toEqual({
      playMode: false,
      highSpeed: false,
    });
    expect(resolveCliConfigOverrideFlags(['chart.bms', '--auto', '--high-speed', '2.5'])).toEqual({
      playMode: true,
      highSpeed: true,
    });
  });

  test('cli: applies persisted mode/high-speed when CLI flags are omitted', () => {
    const parsed = parseArgs(['chart.bms']);
    const merged = applyPersistedPlayerConfigToArgs(
      parsed,
      { playMode: 'auto-scratch', highSpeed: 3.5 },
      { playMode: false, highSpeed: false },
    );
    expect(resolvePlayModeFromArgs(merged)).toBe('auto-scratch');
    expect(merged.highSpeed).toBe(3.5);
  });

  test('cli: keeps explicit mode/high-speed over persisted settings', () => {
    const rawArgs = ['chart.bms', '--auto', '--high-speed', '2.0'];
    const parsed = parseArgs(rawArgs);
    const merged = applyPersistedPlayerConfigToArgs(
      parsed,
      { playMode: 'manual', highSpeed: 5 },
      resolveCliConfigOverrideFlags(rawArgs),
    );
    expect(resolvePlayModeFromArgs(merged)).toBe('auto');
    expect(merged.highSpeed).toBe(2);
  });

  test('cli: preserves per-directory selected chart files when resolving persisted config from args', () => {
    const parsed = parseArgs(['chart.bms']);
    const resolved = resolvePersistedPlayerConfigFromArgs(parsed, {
      playMode: 'manual',
      highSpeed: 1,
      lastSelectedChartFileByDirectory: {
        '/songs/a': '/songs/a/alpha.bms',
        '/songs/b': '/songs/b/beta.bms',
      },
    });
    expect(resolved.lastSelectedChartFileByDirectory).toEqual({
      '/songs/a': '/songs/a/alpha.bms',
      '/songs/b': '/songs/b/beta.bms',
    });
  });

  test('cli: preserves per-directory music-select focus keys when resolving persisted config from args', () => {
    const parsed = parseArgs(['chart.bms']);
    const resolved = resolvePersistedPlayerConfigFromArgs(parsed, {
      playMode: 'manual',
      highSpeed: 1,
      lastMusicSelectFocusKeyByDirectory: {
        '/songs/a': 'random',
        '/songs/b': 'chart:/songs/b/beta.bms',
      },
    });
    expect(resolved.lastMusicSelectFocusKeyByDirectory).toEqual({
      '/songs/a': 'random',
      '/songs/b': 'chart:/songs/b/beta.bms',
    });
  });

  test('cli: restores music-select focus by persisted chart filename when available', () => {
    const files = ['/charts/a.bms', '/charts/b.bms', '/charts/c.bms'];
    expect(resolveMusicSelectInitialFocusKey(files, '/charts/b.bms')).toBe('chart:/charts/b.bms');
    expect(resolveMusicSelectInitialFocusKey(files, '/charts/missing.bms')).toBeUndefined();
    expect(resolveMusicSelectInitialFocusKey(files, undefined)).toBeUndefined();
  });

  test('cli: restores music-select focus by persisted focus key including random', () => {
    const files = ['/charts/a.bms', '/charts/b.bms', '/charts/c.bms'];
    expect(resolveMusicSelectInitialFocusKey(files, '/charts/a.bms', 'random')).toBe('random');
    expect(resolveMusicSelectInitialFocusKey(files, undefined, 'chart:/charts/b.bms')).toBe('chart:/charts/b.bms');
    expect(resolveMusicSelectInitialFocusKey(files, '/charts/a.bms', 'chart:/charts/missing.bms')).toBe('chart:/charts/a.bms');
  });

  test('cli: cycles music-select mode by a key in three states', () => {
    expect(cyclePlayMode('manual')).toBe('auto-scratch');
    expect(cyclePlayMode('auto-scratch')).toBe('auto');
    expect(cyclePlayMode('auto')).toBe('manual');
  });

  test('cli: formats play mode labels for music-select', () => {
    expect(formatPlayModeLabel('manual')).toBe('MANUAL');
    expect(formatPlayModeLabel('auto-scratch')).toBe('AUTO SCRATCH');
    expect(formatPlayModeLabel('auto')).toBe('AUTO');
  });

  test('cli: renders selected chart metadata lines for music-select', () => {
    const lines = createMusicSelectSelectedMetadataLines(
      {
        kind: 'chart',
        filePath: '/charts/sample.bms',
        fileLabel: 'sample.bms',
        title: 'Four-Measure Command Combo Test',
        subtitle: 'Visual 4-Bar Command Blocks',
        artist: 'Codex',
        subartist: 'Alice, Bob',
        genre: 'TEST',
        comment: 'Each 4-measure block targets a different command combination set.',
      },
      96,
    );

    expect(lines[0]).toContain('TITLE Four-Measure Command Combo Test');
    expect(lines[0]).toContain('\u001b[38;2;160;160;160mVisual 4-Bar Command Blocks\u001b[0m');
    expect(lines[1]).toContain('ARTIST Codex');
    expect(lines[1]).toContain('\u001b[38;2;160;160;160mAlice, Bob\u001b[0m');
    expect(lines[2]).toContain('GENRE TEST');
    expect(lines[3]).toContain('COMMENT Each 4-measure block targets a different command combination set.');
  });

  test('cli: right-aligns music-select banner lines beside metadata text', () => {
    const lines = createMusicSelectSelectedMetadataLines(
      {
        kind: 'chart',
        filePath: '/charts/sample.bms',
        fileLabel: 'sample.bms',
        title: 'Sample',
        artist: 'Codex',
        genre: 'TEST',
        comment: 'Ready',
      },
      64,
      {
        bannerLines: ['[01]', '[02]', '[03]', '[04]'],
      },
    );

    expect(lines[0]).toMatch(/TITLE Sample\s+\[01\]$/);
    expect(lines[1]).toMatch(/ARTIST Codex\s+\[02\]$/);
    expect(lines[2]).toMatch(/GENRE TEST\s+\[03\]$/);
    expect(lines[3]).toMatch(/COMMENT Ready\s+\[04\]$/);
  });

  test('cli: reserves music-select metadata space for kitty banner overlays', () => {
    const lines = createMusicSelectSelectedMetadataLines(
      {
        kind: 'chart',
        filePath: '/charts/sample.bms',
        fileLabel: 'sample.bms',
        title: 'Sample',
        artist: 'Codex',
        genre: 'TEST',
        comment: 'Ready',
      },
      64,
      {
        bannerWidth: 12,
      },
    );

    expect(lines[0]).toMatch(/TITLE Sample\s{12,}$/);
    expect(lines[1]).toMatch(/ARTIST Codex\s{12,}$/);
    expect(lines[2]).toMatch(/GENRE TEST\s{12,}$/);
    expect(lines[3]).toMatch(/COMMENT Ready\s{12,}$/);
  });

  test('cli: keeps colorized music-select metadata within the reserved block width', () => {
    const lineWidth = 48;
    const lines = createMusicSelectSelectedMetadataLines(
      {
        kind: 'chart',
        filePath: '/charts/sample.bms',
        fileLabel: 'sample.bms',
        title: 'Four-Measure Command Combo Test',
        subtitle: 'Visual 4-Bar Command Blocks',
        artist: 'Codex',
        subartist: 'Alice, Bob',
        genre: 'TEST',
        comment: 'Each 4-measure block targets a different command combination set.',
      },
      lineWidth,
      {
        bannerWidth: 12,
      },
    );

    expect(lines.every((line) => measureMusicSelectTestDisplayWidth(line) <= lineWidth)).toBe(true);
  });

  test('cli: renders music-select control block for below-list placement', () => {
    const lines = createMusicSelectControlLines({
      rootDir: '/charts',
      lineWidth: 120,
      playModeLabel: 'MANUAL',
      highSpeedLabel: '2.5',
      difficultyFilterLabel: 'ALL',
      audioBackendLabel: 'CoreAudio',
    });

    expect(lines[0]).toContain('Select chart');
    expect(lines[1]).toBe('Directory: /charts');
    expect(lines[2]).toBe('Mode: MANUAL  HIGH-SPEED: x2.5  DIFFICULTY: ALL');
    expect(lines[3]).toBe('Audio backend: CoreAudio');
  });

  test('cli: formats DEFEXRANK values without dropping decimals', () => {
    expect(formatRankLabel(4)).toBe('VERY EASY');
    expect(formatRankLabel(199.97)).toBe('199.97');
  });

  test('cli: formats DIFFICULTY values as 1-5 only', () => {
    expect(formatDifficultyLabel(3)).toBe('3');
    expect(formatDifficultyLabel(0)).toBe('-');
    expect(formatDifficultyLabel(6)).toBe('-');
    expect(formatDifficultyLabel(undefined)).toBe('-');
  });

  test('cli: renders loading overlay lines with opaque styling', () => {
    const lines = createPlayLoadingProgressScreenLines(
      '/charts/stagefile-test.bms',
      {
        ratio: 0.5,
        message: 'Preparing audio...',
        detail: 'sample.wav',
        audioStatus: {
          state: 'ready',
          message: 'Ready',
        },
        graphicsStatus: {
          state: 'pending',
          message: 'Preparing BGA...',
          detail: 'intro.mpg',
        },
      },
      { columns: 48 },
    );

    expect(lines[0]).toContain('Loading selected chart...');
    expect(lines.some((line) => line.includes('Step: Loading playback resources...'))).toBe(true);
    expect(lines.some((line) => line.includes('Step: Preparing audio...'))).toBe(false);
    expect(lines.some((line) => line.includes('Sound: Ready'))).toBe(true);
    expect(lines.some((line) => line.includes('Visual: Loading... (intro.mpg)'))).toBe(true);
    expect(lines.some((line) => line.includes('/charts/stagefile-test.bms'))).toBe(true);
    expect(lines.some((line) => line.includes('Detail:'))).toBe(false);
    expect(lines.every((line) => line.startsWith('\u001b[38;2;255;255;255;48;2;0;0;0m'))).toBe(true);
  });

  test('cli: summarizes chart parsing under chart resource loading step', () => {
    const lines = createPlayLoadingProgressScreenLines(
      '/charts/stagefile-test.bms',
      {
        ratio: 0.12,
        message: 'Loading stage image...',
      },
      { columns: 48 },
    );

    expect(lines.some((line) => line.includes('Step: Loading chart resources...'))).toBe(true);
    expect(lines.some((line) => line.includes('Step: Loading stage image...'))).toBe(false);
  });

  test('cli: chooses black text on bright stage pixels and white text on dark stage pixels', () => {
    const whiteRow = new Uint8Array(Array.from({ length: 48 * 3 }, () => 255));
    const blackRow = new Uint8Array(48 * 3);
    const rgb = new Uint8Array([...whiteRow, ...blackRow]);
    const lines = createPlayLoadingProgressScreenLines(
      '/charts/stagefile-test.bms',
      {
        ratio: 0.5,
        message: 'Preparing audio...',
      },
      {
        columns: 48,
        stageFileImage: {
          width: 48,
          height: 2,
          rgb,
          lines: ['IMG1', 'IMG2'],
        },
      },
    );

    expect(lines[0]).toContain('\u001b[38;2;0;0;0;48;2;255;255;255mL');
    expect(lines[1]).toContain('\u001b[38;2;255;255;255;48;2;0;0;0m[');
  });

  test('cli: overlays loading text onto full-screen STAGEFILE output', () => {
    const output = createPlayLoadingProgressScreenOutput(
      '/charts/stagefile-test.bms',
      {
        ratio: 0.5,
        message: 'Preparing audio...',
      },
      {
        columns: 48,
        stageFileImage: {
          width: 48,
          height: 2,
          rgb: new Uint8Array(48 * 2 * 3),
          lines: ['ANSI_STAGE_LINE_1', 'ANSI_STAGE_LINE_2'],
        },
      },
    );

    expect(output).toContain('\u001b[2J\u001b[HANSI_STAGE_LINE_1\nANSI_STAGE_LINE_2\u001b[H');
    expect(output).toContain('Loading selected chart...');
  });

  test('cli: emits kitty graphics stagefile output when requested', () => {
    const output = createPlayLoadingProgressScreenOutput(
      '/charts/stagefile-test.bms',
      {
        ratio: 0.5,
        message: 'Preparing audio...',
      },
      {
        columns: 48,
        useKittyGraphics: true,
        stageFileImage: {
          width: 48,
          height: 2,
          rgb: new Uint8Array(48 * 2 * 3),
          lines: ['ANSI_STAGE_LINE_1', 'ANSI_STAGE_LINE_2'],
          kittyImage: {
            pixelWidth: 4,
            pixelHeight: 2,
            cellWidth: 48,
            cellHeight: 2,
            rgb: new Uint8Array(4 * 2 * 3),
          },
        },
      },
    );

    expect(output).toContain('\u001b_Ga=T,t=d,f=24,s=4,v=2,c=48,r=2,i=7331,q=2,p=1,z=-1,C=1,m=0;');
    expect(output).toContain('Loading selected chart...');
    expect(output).not.toContain('ANSI_STAGE_LINE_1');
  });

  test('cli: updates loading overlay without redrawing the STAGEFILE background', () => {
    const output = createPlayLoadingProgressScreenOutput(
      '/charts/stagefile-test.bms',
      {
        ratio: 0.75,
        message: 'Preparing audio...',
        detail: 'sample.wav',
        audioStatus: {
          state: 'pending',
          message: 'Loading key sounds... (3/24)',
          detail: 'sample.wav',
        },
      },
      {
        columns: 48,
        stageFileImage: {
          width: 48,
          height: 2,
          rgb: new Uint8Array(48 * 2 * 3),
          lines: ['ANSI_STAGE_LINE_1', 'ANSI_STAGE_LINE_2'],
        },
        resetScreen: false,
        includeStageFileImage: false,
      },
    );

    expect(output.startsWith('\u001b[H')).toBe(true);
    expect(output).not.toContain('\u001b[2J');
    expect(output).not.toContain('ANSI_STAGE_LINE_1');
    expect(output).toContain('Sound: Loading... (3/24, sample.wav)');
    expect(output).not.toContain('Detail: sample.wav');
  });

  test('cli: expands STAGEFILE splash bounds to the available loading screen area', () => {
    expect(resolvePlayLoadingStageFileDisplaySize(120, 40)).toEqual({ width: 120, height: 40 });
    expect(resolvePlayLoadingStageFileDisplaySize(24, 10)).toEqual({ width: 24, height: 10 });
  });

  test('cli: keeps RANDOM rank labels in selection rows', () => {
    const entries = [
      {
        kind: 'chart' as const,
        fileLabel: 'dynamic.bms',
        player: 1,
        rank: 2,
        rankLabel: 'RANDOM',
        playLevel: 7,
        bpmInitial: 180,
        bpmMin: 180,
        bpmMax: 180,
        totalNotes: 500,
      },
    ];
    const layout = createSelectionColumnLayout(64, entries);
    expect(formatSelectionEntryLabel(entries[0], layout)).toContain('RANDOM');
  });

  test('cli: uses PLEVEL header and keeps NOTES visible', () => {
    const entries = [
      {
        kind: 'chart' as const,
        fileLabel: 'sample.bms',
        player: 1,
        difficulty: 3,
        rank: 2,
        playLevel: 12.4,
        bpmInitial: 180,
        bpmMin: 180,
        bpmMax: 180,
        totalNotes: 1234,
      },
    ];
    const layout = createSelectionColumnLayout(48, entries);
    expect(formatSelectionColumnHeader(layout)).toContain('PLEVEL');
    expect(formatSelectionColumnHeader(layout)).toContain('NOTES');
  });

  test('cli: shrinks file column before dropping NOTES in narrow music-select layouts', () => {
    const entries = [
      {
        kind: 'chart' as const,
        fileLabel: 'very-long-chart-file-name-that-should-be-truncated.bms',
        player: 1,
        difficulty: 4,
        rank: 2,
        playLevel: 12.4,
        bpmInitial: 180,
        bpmMin: 180,
        bpmMax: 180,
        totalNotes: 1234,
      },
    ];
    const layout = createSelectionColumnLayout(43, entries);
    expect(layout.fileWidth).toBe(1);
    expect(formatSelectionColumnHeader(layout)).toMatch(/NOTES$/);
    expect(formatSelectionEntryLabel(entries[0], layout)).toMatch(/1234$/);
  });

  test('cli: keeps NOTES visible when wide filename characters are truncated', () => {
    const entries = [
      {
        kind: 'chart' as const,
        fileLabel: 'なんでも吸い込むピンク色のためのロングファイル名.bms',
        player: 1,
        difficulty: 4,
        rank: 3,
        playLevel: 12,
        bpmInitial: 180,
        bpmMin: 180,
        bpmMax: 180,
        totalNotes: 2048,
      },
    ];
    const itemLabelWidth = 48;
    const layout = createSelectionColumnLayout(itemLabelWidth, entries);
    const rendered = truncateForDisplay(formatSelectionEntryLabel(entries[0], layout), itemLabelWidth);
    expect(rendered).toMatch(/2048$/);
  });

  test('cli: formats PLAYLEVEL 0 as question mark and preserves strings/decimals', () => {
    expect(formatPlayLevelLabel(0)).toBe('?');
    expect(formatPlayLevelLabel(12.4)).toBe('12.4');
    expect(formatPlayLevelLabel('安心')).toBe('安心');
  });

  test('cli: caps textual PLEVEL cells to 4 columns with ellipsis', () => {
    const entries = [
      {
        kind: 'chart' as const,
        fileLabel: 'sample.bms',
        player: 1,
        difficulty: 3,
        rank: 2,
        playLevel: 'HYPER',
        bpmInitial: 180,
        bpmMin: 180,
        bpmMax: 180,
        totalNotes: 1234,
      },
    ];

    const layout = createSelectionColumnLayout(48, entries);

    expect(layout.playLevelWidth).toBe(6);
    expect(formatSelectionEntryLabel(entries[0], layout)).toContain('HYP…');
  });

  test('cli: right-aligns numeric PLEVEL cells', () => {
    const entries = [
      {
        kind: 'chart' as const,
        fileLabel: 'sample.bms',
        player: 1,
        difficulty: 3,
        rank: 2,
        playLevel: 12.4,
        bpmInitial: 180,
        bpmMin: 180,
        bpmMax: 180,
        totalNotes: 1234,
      },
    ];

    const layout = createSelectionColumnLayout(48, entries);

    expect(layout.playLevelWidth).toBe(6);
    expect(formatSelectionEntryLabel(entries[0], layout)).toContain('NORMAL    12.4');
  });

  test('cli: resolves DIFFICULTY filter keys in music-select', () => {
    expect(resolveMusicSelectDifficultyFilter('1')).toBe(1);
    expect(resolveMusicSelectDifficultyFilter('5')).toBe(5);
    expect(resolveMusicSelectDifficultyFilter('0')).toBeNull();
    expect(resolveMusicSelectDifficultyFilter('6')).toBeUndefined();
    expect(resolveMusicSelectDifficultyFilter(undefined)).toBeUndefined();
  });

  test('cli: parses invisible-note display flag', () => {
    const parsed = parseArgs(['chart.bms', '--show-invisible-notes']);
    expect(parsed.showInvisibleNotes).toBe(true);
  });

  test('cli: parses --high-speed in 0.5 increments', () => {
    const parsed = parseArgs(['chart.bms', '--high-speed', '3.5']);
    expect(parsed.highSpeed).toBe(3.5);
  });

  test('cli: rejects out-of-range --high-speed', () => {
    expect(() => parseArgs(['chart.bms', '--high-speed', '0.25'])).toThrow('--high-speed must be between 0.5 and 10');
    expect(() => parseArgs(['chart.bms', '--high-speed', '10.5'])).toThrow('--high-speed must be between 0.5 and 10');
  });

  test('cli: rejects --high-speed values outside 0.5 increments', () => {
    expect(() => parseArgs(['chart.bms', '--high-speed', '1.3'])).toThrow('--high-speed must be in 0.5 increments');
  });

  test('cli: uses limiter on and compressor on by default', () => {
    const parsed = parseArgs(['chart.bms']);
    expect(parsed.limiter).toBe(true);
    expect(parsed.compressor).toBe(true);
  });

  test('cli: parses compressor and limiter tuning options', () => {
    const parsed = parseArgs([
      'chart.bms',
      '--no-compressor',
      '--compressor',
      '--compressor-threshold-db',
      '-10',
      '--compressor-ratio',
      '3',
      '--compressor-attack-ms',
      '6',
      '--compressor-release-ms',
      '140',
      '--compressor-makeup-db',
      '1.5',
      '--no-limiter',
      '--limiter-ceiling-db',
      '-1',
      '--limiter-release-ms',
      '90',
    ]);
    expect(parsed.compressor).toBe(true);
    expect(parsed.compressorThresholdDb).toBe(-10);
    expect(parsed.compressorRatio).toBe(3);
    expect(parsed.compressorAttackMs).toBe(6);
    expect(parsed.compressorReleaseMs).toBe(140);
    expect(parsed.compressorMakeupDb).toBe(1.5);
    expect(parsed.limiter).toBe(false);
    expect(parsed.limiterCeilingDb).toBe(-1);
    expect(parsed.limiterReleaseMs).toBe(90);
  });

  test('cli: rejects removed --audio-backend flag', () => {
    expect(() => parseArgs(['chart.bms', '--audio-backend', 'webaudio'])).toThrow(
      '--audio-backend is no longer supported; node-web-audio-api is always used',
    );
  });

  test('cli: rejects removed audio-io tuning flags', () => {
    expect(() => parseArgs(['chart.bms', '--audio-io-buffer-ms', '12'])).toThrow(
      '--audio-io-buffer-ms is no longer supported; audio-io backend has been removed',
    );
  });

  test('cli: accepts --preview as a no-op and keeps preview always enabled', () => {
    const parsed = parseArgs(['chart.bms', '--preview']);
    expect(parsed.input).toBe('chart.bms');
  });

  test('cli: rejects --no-preview because preview is always enabled', () => {
    expect(() => parseArgs(['chart.bms', '--no-preview'])).toThrow(
      '--no-preview is no longer supported; music preview is always enabled',
    );
  });

  test('cli: parses --debug-judge-window', () => {
    const parsed = parseArgs(['chart.bms', '--debug-judge-window', '280']);
    expect(parsed.judgeWindowMs).toBe(280);
    expect(parsed.judgeWindowSource).toBe('debug');
  });

  test('cli: enables active audio debug overlay', () => {
    const parsed = parseArgs(['chart.bms', '--debug-active-audio']);
    expect(parsed.debugActiveAudio).toBe(true);
  });

  test('cli: parses global and per-playable volume options', () => {
    const parsed = parseArgs([
      'chart.bms',
      '--volume',
      '0.6',
      '--key-volume',
      '0.75',
      '--audio-lead-ms',
      '9.5',
      '--audio-lead-max-ms',
      '20',
      '--audio-lead-step-up-ms',
      '2.0',
      '--audio-lead-step-down-ms',
      '0.8',
    ]);
    expect(parsed.volume).toBe(0.6);
    expect(parsed.playVolume).toBe(0.75);
    expect(parsed.audioLeadMs).toBe(9.5);
    expect(parsed.audioLeadMaxMs).toBe(20);
    expect(parsed.audioLeadStepUpMs).toBe(2);
    expect(parsed.audioLeadStepDownMs).toBe(0.8);
  });

  test('cli: rejects removed audify tuning flags', () => {
    expect(() => parseArgs(['chart.bms', '--audify-high-water-ms', '28'])).toThrow(
      '--audify-high-water-ms is no longer supported; audify backend has been removed',
    );
    expect(() => parseArgs(['chart.bms', '--audify-low-water-ms', '14'])).toThrow(
      '--audify-low-water-ms is no longer supported; audify backend has been removed',
    );
  });

  test('cli: ignores legacy --judge-window without affecting positional args', () => {
    const parsed = parseArgs(['--judge-window', '260', 'chart.bms']);
    expect(parsed.input).toBe('chart.bms');
    expect(parsed.judgeWindowMs).toBeUndefined();
  });

  test('cli: ignores legacy --audio-offset-ms without affecting positional args', () => {
    const parsed = parseArgs(['--audio-offset-ms', '12', 'chart.bms']);
    expect(parsed.input).toBe('chart.bms');
  });

  test('cli: interprets r as replay on result screen', () => {
    const action = resolveResultScreenActionFromKey('r', createKey());
    expect(action).toBe('replay');
  });

  test('cli: interprets Enter as return-to-select on result screen', () => {
    const action = resolveResultScreenActionFromKey(undefined, createKey('enter'));
    expect(action).toBe('enter');
  });

  test('cli: interprets Esc as return-to-select on result screen', () => {
    const action = resolveResultScreenActionFromKey(undefined, createKey('escape', '\u001b'));
    expect(action).toBe('enter');
  });

  test('cli: interprets Ctrl+C as exit on result screen', () => {
    const action = resolveResultScreenActionFromKey(undefined, createKey(undefined, '\u0003'));
    expect(action).toBe('ctrl-c');
  });

  test('cli: interprets Right as music-select next page', () => {
    const action = resolveMusicSelectNavigationAction(undefined, createKey('right'));
    expect(action).toBe('page-down');
  });

  test('cli: interprets Left as music-select previous page', () => {
    const action = resolveMusicSelectNavigationAction(undefined, createKey('left'));
    expect(action).toBe('page-up');
  });

  test('cli: interprets vim h/l as music-select page keys', () => {
    expect(resolveMusicSelectNavigationAction('h', createKey())).toBe('page-up');
    expect(resolveMusicSelectNavigationAction('l', createKey())).toBe('page-down');
  });

  test('cli: interprets Ctrl+b/Ctrl+f as music-select page keys', () => {
    expect(resolveMusicSelectNavigationAction(undefined, createKey('b', undefined, true))).toBe('page-up');
    expect(resolveMusicSelectNavigationAction(undefined, createKey('f', undefined, true))).toBe('page-down');
  });

  test('cli: interprets s/S as music-select HIGH-SPEED controls', () => {
    expect(resolveMusicSelectNavigationAction('s', createKey('s'))).toBe('increase-high-speed');
    expect(resolveMusicSelectNavigationAction('S', createKey('s', 'S', false))).toBe('decrease-high-speed');
  });

  test('cli: resolves circular selectable index', () => {
    expect(resolveCircularSelectableIndex(0, -1, 5)).toBe(4);
    expect(resolveCircularSelectableIndex(4, 1, 5)).toBe(0);
    expect(resolveCircularSelectableIndex(2, 6, 5)).toBe(3);
  });

  test('cli: resolves visible entry range based on viewport rows', () => {
    expect(resolveVisibleEntryRange(9, 20, 6)).toEqual({ start: 6, end: 12 });
    expect(resolveVisibleEntryRange(0, 20, 6)).toEqual({ start: 0, end: 6 });
    expect(resolveVisibleEntryRange(19, 20, 6)).toEqual({ start: 18, end: 20 });
  });

  test('cli: resolves page selection using visible row range', () => {
    const selectableIndexes = [0, 2, 4, 7, 9, 11, 14, 16, 19];
    expect(resolvePageSelectableIndex(selectableIndexes, 9, 20, 6, 'down')).toBe(14);
    expect(resolvePageSelectableIndex(selectableIndexes, 9, 20, 6, 'up')).toBe(4);
  });

  test('cli: wraps page selection as circular list', () => {
    const selectableIndexes = [0, 2, 4, 7, 9, 11, 14, 16, 19];
    expect(resolvePageSelectableIndex(selectableIndexes, 19, 20, 6, 'down')).toBe(0);
    expect(resolvePageSelectableIndex(selectableIndexes, 0, 20, 6, 'up')).toBe(19);
    expect(resolvePageSelectableIndex(selectableIndexes, 19, 20, 6, 'up')).toBe(16);
  });

  function createKey(name?: string, sequence?: string, ctrl = false): readline.Key {
    return {
      name,
      sequence,
      ctrl,
      meta: false,
      shift: false,
    };
  }
});
