import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

async function importConfigModule(homeDir: string) {
  vi.resetModules();
  vi.doMock('node:os', async () => {
    const actual = await vi.importActual<typeof import('node:os')>('node:os');
    return {
      ...actual,
      homedir: () => homeDir,
    };
  });
  return import('./config.ts');
}

describe.sequential('cli config', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('node:os');
  });

  test('play mode, high-speed, and override helpers normalize values', async () => {
    const config = await importConfigModule('/tmp/be-music-config-basic');

    expect(config.resolvePlayModeFromArgs({ auto: false, autoScratch: false })).toBe('manual');
    expect(config.resolvePlayModeFromArgs({ auto: false, autoScratch: true })).toBe('auto-scratch');
    expect(config.resolvePlayModeFromArgs({ auto: true, autoScratch: true })).toBe('auto');
    expect(config.cyclePlayMode('manual')).toBe('auto-scratch');
    expect(config.cyclePlayMode('auto-scratch')).toBe('auto');
    expect(config.cyclePlayMode('auto')).toBe('manual');

    expect(config.normalizeHighSpeedValue(undefined)).toBe(1);
    expect(config.normalizeHighSpeedValue(0.1)).toBe(0.5);
    expect(config.normalizeHighSpeedValue(10.4)).toBe(10);
    expect(config.increaseHighSpeed(1)).toBe(1.5);
    expect(config.decreaseHighSpeed(1)).toBe(0.5);
    expect(config.formatHighSpeedLabel(1.24)).toBe('1.0');

    expect(config.resolveCliConfigOverrideFlags(['chart.bms', '--auto-scratch', '--high-speed=2.0'])).toEqual({
      playMode: true,
      highSpeed: true,
    });

    expect(config.applyMusicSelectConfigToArgs({ auto: false, autoScratch: false, highSpeed: 11 }, 'auto', 2.74)).toEqual({
      auto: true,
      autoScratch: false,
      highSpeed: 2.5,
    });
  });

  test('persisted config helpers preserve copied directory maps and respect CLI overrides', async () => {
    const config = await importConfigModule('/tmp/be-music-config-persisted');

    const resolved = config.resolvePersistedPlayerConfigFromArgs(
      { auto: false, autoScratch: true, highSpeed: 2.24 },
      {
        playMode: 'manual',
        highSpeed: 1,
        lastSelectedChartFileByDirectory: { ' /songs ': ' chart.bms ' },
        lastMusicSelectFocusKeyByDirectory: { '/songs': ' random ' },
      },
    );
    expect(resolved).toEqual({
      playMode: 'auto-scratch',
      highSpeed: 2,
      lastSelectedChartFileByDirectory: { '/songs': 'chart.bms' },
      lastMusicSelectFocusKeyByDirectory: { '/songs': 'random' },
    });

    expect(
      config.applyPersistedPlayerConfigToArgs(
        { auto: false, autoScratch: false, highSpeed: undefined },
        { playMode: 'auto', highSpeed: 3.1 },
        { playMode: false, highSpeed: false },
      ),
    ).toEqual({ auto: true, autoScratch: false, highSpeed: 3 });

    expect(
      config.applyPersistedPlayerConfigToArgs(
        { auto: false, autoScratch: false, highSpeed: 5 },
        { playMode: 'auto', highSpeed: 3.1 },
        { playMode: true, highSpeed: true },
      ),
    ).toEqual({ auto: false, autoScratch: false, highSpeed: 5 });
  });

  test('load and save persisted config handle defaults, legacy keys, and normalization', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'be-music-config-'));
    const config = await importConfigModule(homeDir);

    expect(await config.loadPersistedPlayerConfig()).toEqual({
      playMode: 'manual',
      highSpeed: 1,
    });

    await config.savePersistedPlayerConfig({
      playMode: 'auto-scratch',
      highSpeed: 3.24,
      lastSelectedChartFileByDirectory: { ' /songs ': ' chart.bms ' },
      lastMusicSelectFocusKeyByDirectory: { '/songs': ' random ' },
    });

    const saved = JSON.parse(await readFile(join(homeDir, '.be-music', 'player.json'), 'utf8')) as Record<string, unknown>;
    expect(saved).toEqual({
      playMode: 'auto-scratch',
      highSpeed: 3,
      lastSelectedChartFileByDirectory: { '/songs': 'chart.bms' },
      lastMusicSelectFocusKeyByDirectory: { '/songs': 'random' },
    });

    await vi.dynamicImportSettled();
    vi.resetModules();
    vi.doMock('node:os', async () => {
      const actual = await vi.importActual<typeof import('node:os')>('node:os');
      return {
        ...actual,
        homedir: () => homeDir,
      };
    });
    const reloaded = await import('./config.ts');
    const loaded = await reloaded.loadPersistedPlayerConfig();
    expect(loaded).toEqual({
      playMode: 'auto-scratch',
      highSpeed: 3,
      lastSelectedChartFileByDirectory: { '/songs': 'chart.bms' },
      lastMusicSelectFocusKeyByDirectory: { '/songs': 'random' },
    });
  });

  test('load persisted config accepts legacy music select keys and ignores invalid values', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'be-music-config-legacy-'));
    const config = await importConfigModule(homeDir);
    await vi.dynamicImportSettled();

    await import('node:fs/promises').then(({ mkdir, writeFile }) =>
      mkdir(join(homeDir, '.be-music'), { recursive: true }).then(() =>
        writeFile(
          join(homeDir, '.be-music', 'player.json'),
          JSON.stringify({
            playMode: 'broken',
            highSpeed: 'oops',
            lastSelectedChartFileByDirectory: { '  ': 'ignored', '/songs': 123, '/valid': ' kept.bms ' },
            lastSongSelectFocusKeyByDirectory: { '/songs': ' random ' },
          }),
          'utf8',
        ),
      ),
    );

    const loaded = await config.loadPersistedPlayerConfig();
    expect(loaded).toEqual({
      playMode: 'manual',
      highSpeed: 1,
      lastSelectedChartFileByDirectory: { '/valid': 'kept.bms' },
      lastMusicSelectFocusKeyByDirectory: { '/songs': 'random' },
    });
    expect(config.resolveDefaultPlayerLogPath()).toBe(join(homeDir, '.be-music', 'logs', 'player.ndjson'));
  });
});
