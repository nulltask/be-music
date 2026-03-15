import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';

export type PlayMode = 'manual' | 'auto-scratch' | 'auto';

export interface PlayModeArgs {
  auto: boolean;
  autoScratch: boolean;
}

export interface PlayerConfigArgs extends PlayModeArgs {
  highSpeed?: number;
}

export interface PersistedPlayerConfig {
  playMode: PlayMode;
  highSpeed: number;
  lastSelectedChartFileByDirectory?: Record<string, string>;
  lastMusicSelectFocusKeyByDirectory?: Record<string, string>;
}

export interface CliConfigOverrideFlags {
  playMode: boolean;
  highSpeed: boolean;
}

export const MIN_HIGH_SPEED = 0.5;
export const MAX_HIGH_SPEED = 10;
export const HIGH_SPEED_STEP = 0.5;
export const DEFAULT_PLAY_MODE: PlayMode = 'manual';
export const DEFAULT_HIGH_SPEED = 1;

export function resolvePlayModeFromArgs(args: PlayModeArgs): PlayMode {
  if (args.auto) {
    return 'auto';
  }
  if (args.autoScratch) {
    return 'auto-scratch';
  }
  return 'manual';
}

function applyPlayModeToArgs<T extends PlayModeArgs>(args: T, playMode: PlayMode): T {
  return {
    ...args,
    auto: playMode === 'auto',
    autoScratch: playMode === 'auto-scratch',
  };
}

export function applyMusicSelectConfigToArgs<T extends PlayerConfigArgs>(args: T, playMode: PlayMode, highSpeed: number): T {
  return {
    ...applyPlayModeToArgs(args, playMode),
    highSpeed: normalizeHighSpeedValue(highSpeed),
  } satisfies T;
}

export function cyclePlayMode(playMode: PlayMode): PlayMode {
  if (playMode === 'manual') {
    return 'auto-scratch';
  }
  if (playMode === 'auto-scratch') {
    return 'auto';
  }
  return 'manual';
}

export function formatPlayModeLabel(playMode: PlayMode): 'MANUAL' | 'AUTO SCRATCH' | 'AUTO' {
  if (playMode === 'auto-scratch') {
    return 'AUTO SCRATCH';
  }
  if (playMode === 'auto') {
    return 'AUTO';
  }
  return 'MANUAL';
}

export function normalizeHighSpeedValue(value: number | undefined): number {
  const base = Number.isFinite(value) ? Number(value) : 1;
  const clamped = Math.min(MAX_HIGH_SPEED, Math.max(MIN_HIGH_SPEED, base));
  return Math.round(clamped / HIGH_SPEED_STEP) * HIGH_SPEED_STEP;
}

export function increaseHighSpeed(value: number): number {
  return normalizeHighSpeedValue(value + HIGH_SPEED_STEP);
}

export function decreaseHighSpeed(value: number): number {
  return normalizeHighSpeedValue(value - HIGH_SPEED_STEP);
}

export function formatHighSpeedLabel(value: number): string {
  return normalizeHighSpeedValue(value).toFixed(1);
}

export function resolvePersistedPlayerConfigFromArgs(
  args: PlayerConfigArgs,
  previous?: PersistedPlayerConfig,
): PersistedPlayerConfig {
  const resolved: PersistedPlayerConfig = {
    playMode: resolvePlayModeFromArgs(args),
    highSpeed: normalizeHighSpeedValue(args.highSpeed),
  };
  if (previous?.lastSelectedChartFileByDirectory) {
    const copied = copyStringByDirectory(previous.lastSelectedChartFileByDirectory);
    if (copied) {
      resolved.lastSelectedChartFileByDirectory = copied;
    }
  }
  if (previous?.lastMusicSelectFocusKeyByDirectory) {
    const copied = copyStringByDirectory(previous.lastMusicSelectFocusKeyByDirectory);
    if (copied) {
      resolved.lastMusicSelectFocusKeyByDirectory = copied;
    }
  }
  return resolved;
}

export function createDefaultPersistedPlayerConfig(): PersistedPlayerConfig {
  return {
    playMode: DEFAULT_PLAY_MODE,
    highSpeed: DEFAULT_HIGH_SPEED,
  };
}

export function resolveCliConfigOverrideFlags(rawArgs: string[]): CliConfigOverrideFlags {
  let playMode = false;
  let highSpeed = false;
  for (const token of rawArgs) {
    if (token === '--auto' || token === '--auto-scratch') {
      playMode = true;
    }
    if (token === '--high-speed' || token.startsWith('--high-speed=')) {
      highSpeed = true;
    }
  }
  return {
    playMode,
    highSpeed,
  };
}

export function applyPersistedPlayerConfigToArgs<T extends PlayerConfigArgs>(
  args: T,
  persisted: PersistedPlayerConfig,
  overrides: CliConfigOverrideFlags,
): T {
  let merged = args;
  if (!overrides.playMode) {
    merged = applyPlayModeToArgs(merged, persisted.playMode);
  }
  if (!overrides.highSpeed && typeof merged.highSpeed !== 'number') {
    merged = {
      ...merged,
      highSpeed: normalizeHighSpeedValue(persisted.highSpeed),
    } satisfies T;
  }
  return merged;
}

function resolvePlayerConfigPath(): string {
  return resolve(homedir(), '.be-music', 'player.json');
}

export function resolveDefaultPlayerLogPath(): string {
  return resolve(homedir(), '.be-music', 'logs', 'player.ndjson');
}

function parsePersistedPlayMode(value: unknown): PlayMode | undefined {
  if (value === 'manual' || value === 'auto-scratch' || value === 'auto') {
    return value;
  }
  return undefined;
}

function parsePersistedHighSpeed(value: unknown): number | undefined {
  if (!Number.isFinite(value)) {
    return undefined;
  }
  return normalizeHighSpeedValue(Number(value));
}

function parsePersistedPlayerConfig(value: unknown): PersistedPlayerConfig {
  const defaults = createDefaultPersistedPlayerConfig();
  if (typeof value !== 'object' || value === null) {
    return defaults;
  }
  const objectValue = value as {
    playMode?: unknown;
    highSpeed?: unknown;
    lastSelectedChartFileByDirectory?: unknown;
    lastMusicSelectFocusKeyByDirectory?: unknown;
  };
  const legacyMusicSelectFocusKeys = (value as Record<string, unknown>)['lastSongSelectFocusKeyByDirectory'];
  const resolved: PersistedPlayerConfig = {
    playMode: parsePersistedPlayMode(objectValue.playMode) ?? defaults.playMode,
    highSpeed: parsePersistedHighSpeed(objectValue.highSpeed) ?? defaults.highSpeed,
  };
  if (typeof objectValue.lastSelectedChartFileByDirectory === 'object' && objectValue.lastSelectedChartFileByDirectory) {
    const copied = copyStringByDirectory(objectValue.lastSelectedChartFileByDirectory);
    if (copied) {
      resolved.lastSelectedChartFileByDirectory = copied;
    }
  }
  const rawMusicSelectFocusKeys =
    typeof objectValue.lastMusicSelectFocusKeyByDirectory === 'object' && objectValue.lastMusicSelectFocusKeyByDirectory
      ? objectValue.lastMusicSelectFocusKeyByDirectory
      : typeof legacyMusicSelectFocusKeys === 'object' && legacyMusicSelectFocusKeys
        ? legacyMusicSelectFocusKeys
        : undefined;
  if (rawMusicSelectFocusKeys) {
    const copied = copyStringByDirectory(rawMusicSelectFocusKeys);
    if (copied) {
      resolved.lastMusicSelectFocusKeyByDirectory = copied;
    }
  }
  return resolved;
}

export async function loadPersistedPlayerConfig(): Promise<PersistedPlayerConfig> {
  const configPath = resolvePlayerConfigPath();
  let content: string;
  try {
    content = await readFile(configPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
      return createDefaultPersistedPlayerConfig();
    }
    throw error;
  }
  return parsePersistedPlayerConfig(JSON.parse(content));
}

export async function savePersistedPlayerConfig(config: PersistedPlayerConfig): Promise<void> {
  const configPath = resolvePlayerConfigPath();
  await mkdir(dirname(configPath), { recursive: true });
  const normalized: PersistedPlayerConfig = {
    playMode: config.playMode,
    highSpeed: normalizeHighSpeedValue(config.highSpeed),
  };
  if (config.lastSelectedChartFileByDirectory) {
    const copied = copyStringByDirectory(config.lastSelectedChartFileByDirectory);
    if (copied) {
      normalized.lastSelectedChartFileByDirectory = copied;
    }
  }
  if (config.lastMusicSelectFocusKeyByDirectory) {
    const copied = copyStringByDirectory(config.lastMusicSelectFocusKeyByDirectory);
    if (copied) {
      normalized.lastMusicSelectFocusKeyByDirectory = copied;
    }
  }
  await writeFile(configPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
}

function copyStringByDirectory(value: unknown): Record<string, string> | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  const copied: Record<string, string> = {};
  for (const [directory, filePath] of entries) {
    const normalizedDirectory = directory.trim();
    if (normalizedDirectory.length === 0) {
      continue;
    }
    if (typeof filePath !== 'string') {
      continue;
    }
    const normalizedFilePath = filePath.trim();
    if (normalizedFilePath.length === 0) {
      continue;
    }
    copied[normalizedDirectory] = normalizedFilePath;
  }
  if (Object.keys(copied).length === 0) {
    return undefined;
  }
  return copied;
}
