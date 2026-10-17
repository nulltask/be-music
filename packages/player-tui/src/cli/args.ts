import {
  DEFAULT_IMAGE_RESIZE_ALGORITHM,
  isImageResizeAlgorithm,
  type ImageResizeAlgorithm,
} from '@be-music/player/image-resize-algorithm';
import { JUDGE_WINDOW_RULESETS } from '@be-music/player/core/judge-window';
import type { GaugeType, PlaylogRulesetId } from '@be-music/player/ruleset';
import {
  DEFAULT_TUI_NOTE_HEIGHT,
  MAX_TUI_NOTE_HEIGHT,
  MIN_TUI_NOTE_HEIGHT,
  TUI_NOTE_HEIGHT_HALF,
  type TuiNoteHeight,
} from '@be-music/player/core/ui-options';
import { HIGH_SPEED_STEP, MAX_HIGH_SPEED, MIN_HIGH_SPEED } from './config.ts';

export interface CliArgs {
  input?: string;
  logFile?: string;
  auto: boolean;
  autoScratch: boolean;
  kittyGraphics: boolean;
  videoBgaStreaming: boolean;
  inferBmsLnTypeWhenMissing: boolean;
  showInvisibleNotes: boolean;
  compressor: boolean;
  compressorThresholdDb?: number;
  compressorRatio?: number;
  compressorAttackMs?: number;
  compressorReleaseMs?: number;
  compressorMakeupDb?: number;
  limiter: boolean;
  limiterCeilingDb?: number;
  limiterReleaseMs?: number;
  speed?: number;
  uiFps: number;
  tuiVisibleNotesLimit: number;
  tuiNoteHeight: TuiNoteHeight;
  imageResizeAlgorithm: ImageResizeAlgorithm;
  highSpeed?: number;
  judgeWindowMs?: number;
  /** Compat ruleset the engine judges under (`PlayerOptions.judgeRuleset`). Defaults to LR2. */
  judgeRuleset?: PlaylogRulesetId;
  /** Gauge pick, in LR2's names; each ruleset maps it onto its own line-up. Defaults to `GROOVE`. */
  gauge?: GaugeType;
  debugActiveAudio: boolean;
  renderAudioPath?: string;
  audio: boolean;
  volume?: number;
  bgmVolume?: number;
  playVolume?: number;
  audioTailSeconds?: number;
  audioHeadPaddingMs?: number;
  audioLeadMs?: number;
  audioLeadMaxMs?: number;
  audioLeadStepUpMs?: number;
  audioLeadStepDownMs?: number;
  tui: boolean;
}

const DEFAULT_TUI_FPS = 60;
const DEFAULT_TUI_VISIBLE_NOTES_LIMIT = 8192;

export function parseArgs(rawArgs: string[]): CliArgs {
  const args = createDefaultCliArgs();
  const positional: string[] = [];

  for (let index = 0; index < rawArgs.length; index += 1) {
    const token = rawArgs[index];
    if (applyCliToggleArg(args, token)) {
      continue;
    }
    const nextIndex = consumeCliValueArg(args, rawArgs, index);
    if (nextIndex !== undefined) {
      index = nextIndex;
      continue;
    }
    if (consumeDeprecatedCliArg(token)) {
      if ((token === '--judge-window' || token === '--audio-offset-ms') && index + 1 < rawArgs.length) {
        index += 1;
      }
      continue;
    }
    positional.push(token);
  }

  args.input = positional[0];
  return args;
}

/** The gauge types, in the order the CLI lists them. */
const CLI_GAUGES: readonly GaugeType[] = ['GROOVE', 'EASY', 'HARD', 'DEATH'];

function parseCliRuleset(rawValue: string): PlaylogRulesetId {
  const value = rawValue.trim().toLowerCase();
  const match = JUDGE_WINDOW_RULESETS.find((ruleset) => ruleset === value);
  if (!match) {
    throw new Error(`Unknown --ruleset "${rawValue}". Expected one of: ${JUDGE_WINDOW_RULESETS.join(', ')}.`);
  }
  return match;
}

function parseCliGauge(rawValue: string): GaugeType {
  const value = rawValue.trim().toUpperCase();
  const match = CLI_GAUGES.find((gauge) => gauge === value);
  if (!match) {
    throw new Error(`Unknown --gauge "${rawValue}". Expected one of: ${CLI_GAUGES.join(', ')}.`);
  }
  return match;
}

function createDefaultCliArgs(): CliArgs {
  return {
    auto: false,
    autoScratch: false,
    kittyGraphics: true,
    videoBgaStreaming: true,
    imageResizeAlgorithm: DEFAULT_IMAGE_RESIZE_ALGORITHM,
    inferBmsLnTypeWhenMissing: true,
    showInvisibleNotes: false,
    compressor: true,
    limiter: true,
    audio: true,
    volume: undefined,
    tui: true,
    uiFps: DEFAULT_TUI_FPS,
    tuiVisibleNotesLimit: DEFAULT_TUI_VISIBLE_NOTES_LIMIT,
    tuiNoteHeight: DEFAULT_TUI_NOTE_HEIGHT,
    debugActiveAudio: false,
  };
}

function applyCliToggleArg(args: CliArgs, token: string): boolean {
  switch (token) {
    case '--auto':
      args.auto = true;
      args.autoScratch = false;
      return true;
    case '--auto-scratch':
      args.auto = false;
      args.autoScratch = true;
      return true;
    case '--ln-type-auto':
      args.inferBmsLnTypeWhenMissing = true;
      return true;
    case '--no-ln-type-auto':
      args.inferBmsLnTypeWhenMissing = false;
      return true;
    case '--show-invisible-notes':
      args.showInvisibleNotes = true;
      return true;
    case '--no-show-invisible-notes':
      args.showInvisibleNotes = false;
      return true;
    case '--compressor':
      args.compressor = true;
      return true;
    case '--no-compressor':
      args.compressor = false;
      return true;
    case '--limiter':
      args.limiter = true;
      return true;
    case '--no-limiter':
      args.limiter = false;
      return true;
    case '--debug-active-audio':
      args.debugActiveAudio = true;
      return true;
    case '--no-audio':
      args.audio = false;
      return true;
    case '--audio':
      args.audio = true;
      return true;
    case '--tui':
      args.tui = true;
      return true;
    case '--no-tui':
      args.tui = false;
      return true;
    case '--kitty-graphics':
      args.kittyGraphics = true;
      return true;
    case '--no-kitty-graphics':
      args.kittyGraphics = false;
      return true;
    case '--video-bga-streaming':
      args.videoBgaStreaming = true;
      return true;
    case '--no-video-bga-streaming':
      args.videoBgaStreaming = false;
      return true;
    default:
      return false;
  }
}

function consumeCliValueArg(args: CliArgs, rawArgs: string[], index: number): number | undefined {
  const token = rawArgs[index];
  const rawValue = rawArgs[index + 1];

  switch (token) {
    case '--speed':
      args.speed = Number.parseFloat(rawValue);
      return index + 1;
    case '--high-speed':
      args.highSpeed = parseHighSpeedArg(rawValue);
      return index + 1;
    case '--tui-fps':
      args.uiFps = parseTuiFpsArg(rawValue);
      return index + 1;
    case '--tui-visible-notes-limit':
      args.tuiVisibleNotesLimit = parseTuiVisibleNotesLimitArg(rawValue);
      return index + 1;
    case '--tui-note-height':
      args.tuiNoteHeight = parseTuiNoteHeightArg(rawValue);
      return index + 1;
    case '--image-resize-algorithm':
      args.imageResizeAlgorithm = parseImageResizeAlgorithmArg(rawValue);
      return index + 1;
    case '--log-file':
      args.logFile = readRequiredCliPathArg(rawValue, '--log-file');
      return index + 1;
    case '--compressor-threshold-db':
      args.compressorThresholdDb = Number.parseFloat(rawValue);
      return index + 1;
    case '--compressor-ratio':
      args.compressorRatio = Number.parseFloat(rawValue);
      return index + 1;
    case '--compressor-attack-ms':
      args.compressorAttackMs = Number.parseFloat(rawValue);
      return index + 1;
    case '--compressor-release-ms':
      args.compressorReleaseMs = Number.parseFloat(rawValue);
      return index + 1;
    case '--compressor-makeup-db':
      args.compressorMakeupDb = Number.parseFloat(rawValue);
      return index + 1;
    case '--limiter-ceiling-db':
      args.limiterCeilingDb = Number.parseFloat(rawValue);
      return index + 1;
    case '--limiter-release-ms':
      args.limiterReleaseMs = Number.parseFloat(rawValue);
      return index + 1;
    case '--debug-judge-window':
      args.judgeWindowMs = Number.parseInt(rawValue, 10);
      return index + 1;
    case '--ruleset':
      args.judgeRuleset = parseCliRuleset(rawValue);
      return index + 1;
    case '--gauge':
      args.gauge = parseCliGauge(rawValue);
      return index + 1;
    case '--render-audio':
      args.renderAudioPath = rawValue;
      return index + 1;
    case '--audio-tail':
      args.audioTailSeconds = Number.parseFloat(rawValue);
      return index + 1;
    case '--bgm-volume':
      args.bgmVolume = Number.parseFloat(rawValue);
      return index + 1;
    case '--volume':
      args.volume = Number.parseFloat(rawValue);
      return index + 1;
    case '--play-volume':
    case '--key-volume':
      args.playVolume = Number.parseFloat(rawValue);
      return index + 1;
    case '--audio-head-padding-ms':
      args.audioHeadPaddingMs = Number.parseInt(rawValue, 10);
      return index + 1;
    case '--audio-lead-ms':
      args.audioLeadMs = Number.parseFloat(rawValue);
      return index + 1;
    case '--audio-lead-max-ms':
      args.audioLeadMaxMs = Number.parseFloat(rawValue);
      return index + 1;
    case '--audio-lead-step-up-ms':
      args.audioLeadStepUpMs = Number.parseFloat(rawValue);
      return index + 1;
    case '--audio-lead-step-down-ms':
      args.audioLeadStepDownMs = Number.parseFloat(rawValue);
      return index + 1;
    default:
      return undefined;
  }
}

function consumeDeprecatedCliArg(token: string): boolean {
  if (token === '--audio-io-buffer-ms' || token === '--audio-io-high-water-ms' || token === '--audio-io-low-water-ms') {
    throw new Error(`${token} is no longer supported; audio-io backend has been removed`);
  }
  if (token === '--audio-backend') {
    throw new Error('--audio-backend is no longer supported; node-web-audio-api is always used');
  }
  if (token === '--audify-high-water-ms' || token === '--audify-low-water-ms') {
    throw new Error(`${token} is no longer supported; audify backend has been removed`);
  }
  if (token === '--speaker-buffer-size' || token === '--speaker-samples-per-frame') {
    throw new Error(`${token} is no longer supported; speaker backend has been removed`);
  }
  if (token === '--preview' || token === '--preview-audio') {
    return true;
  }
  if (token === '--no-preview' || token === '--no-preview-audio') {
    throw new Error(`${token} is no longer supported; music preview is always enabled`);
  }
  if (token === '--judge-window' || token === '--audio-offset-ms') {
    return true;
  }
  if (token.startsWith('--audio-backend=')) {
    throw new Error('--audio-backend is no longer supported; node-web-audio-api is always used');
  }
  if (token.startsWith('--judge-window=')) {
    return true;
  }
  if (token.startsWith('--audio-offset-ms=')) {
    return true;
  }
  if (token.startsWith('--audify-')) {
    throw new Error(`${token.split('=')[0]} is no longer supported; audify backend has been removed`);
  }
  if (token.startsWith('--speaker-')) {
    throw new Error(`${token.split('=')[0]} is no longer supported; speaker backend has been removed`);
  }
  return false;
}

function readRequiredCliPathArg(raw: string | undefined, option: string): string {
  if (typeof raw === 'string' && raw.length > 0) {
    return raw;
  }
  throw new Error(`${option} expects a path`);
}

function parseHighSpeedArg(raw: string | undefined): number {
  const parsed = Number.parseFloat(raw ?? '');
  if (!Number.isFinite(parsed)) {
    throw new Error('--high-speed expects a numeric value');
  }
  if (parsed < MIN_HIGH_SPEED || parsed > MAX_HIGH_SPEED) {
    throw new Error(`--high-speed must be between ${MIN_HIGH_SPEED} and ${MAX_HIGH_SPEED}`);
  }
  const steps = parsed / HIGH_SPEED_STEP;
  const roundedSteps = Math.round(steps);
  if (Math.abs(steps - roundedSteps) > 1e-9) {
    throw new Error(`--high-speed must be in ${HIGH_SPEED_STEP} increments`);
  }
  return roundedSteps * HIGH_SPEED_STEP;
}

function parseTuiFpsArg(raw: string | undefined): number {
  const parsed = Number.parseFloat(raw ?? '');
  if (!Number.isFinite(parsed)) {
    throw new Error('--tui-fps expects a numeric value');
  }
  if (parsed <= 0) {
    throw new Error('--tui-fps must be greater than 0');
  }
  return parsed;
}

function parseTuiVisibleNotesLimitArg(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed)) {
    throw new Error('--tui-visible-notes-limit expects an integer value');
  }
  if (parsed <= 0) {
    throw new Error('--tui-visible-notes-limit must be greater than 0');
  }
  return parsed;
}

function parseTuiNoteHeightArg(raw: string | undefined): TuiNoteHeight {
  if (raw === 'full') {
    return MAX_TUI_NOTE_HEIGHT;
  }
  if (raw === 'half') {
    return TUI_NOTE_HEIGHT_HALF;
  }
  const parsed = Number.parseInt(raw ?? '', 10);
  if (
    Number.isFinite(parsed) &&
    parsed >= MIN_TUI_NOTE_HEIGHT &&
    parsed <= MAX_TUI_NOTE_HEIGHT &&
    Number.isInteger(parsed)
  ) {
    return parsed as TuiNoteHeight;
  }
  throw new Error('--tui-note-height must be an integer from 1 to 8, or the alias full or half');
}

function parseImageResizeAlgorithmArg(raw: string | undefined): ImageResizeAlgorithm {
  if (typeof raw === 'string' && isImageResizeAlgorithm(raw)) {
    return raw;
  }
  throw new Error('--image-resize-algorithm must be one of: nearest, lanczos');
}

export function printUsage(): void {
  process.stdout.write(
    [
      'Usage: bms-player <input.(bms|bme|bml|pms|bmson|json)|directory> [options]',
      '',
      'Essential options:',
      '  --auto                    Enable auto play mode (default: off)',
      '  --auto-scratch            Enable scratch auto mode (16ch/26ch only)',
      '  --speed <rate>            Playback speed multiplier (default: 1)',
      `  --tui-fps <value>        Target TUI refresh rate while playing (default: ${DEFAULT_TUI_FPS})`,
      `  --tui-visible-notes-limit <count>  Max notes considered in the visible render window (default: ${DEFAULT_TUI_VISIBLE_NOTES_LIMIT})`,
      `  --tui-note-height <level> Height of regular notes and judge line: 1-8, or full/half aliases (default: ${DEFAULT_TUI_NOTE_HEIGHT})`,
      '  --high-speed <rate>       TUI note fall speed multiplier, 0.5-10.0 in 0.5 steps (default: 1.0)',
      '  --audio / --no-audio      Enable or disable in-game audio playback (default: on)',
      '                           Audio backend: node-web-audio-api (fixed)',
      '  --tui / --no-tui          Enable or disable TUI play screen (default: on in TTY)',
      '                           When disabled, playback runs in AUTO mode and prints realtime trigger logs',
      '  --kitty-graphics          Enable Kitty graphics protocol BGA rendering when supported (default: on)',
      '  --no-kitty-graphics       Disable Kitty graphics protocol BGA rendering',
      '  --video-bga-streaming     Stream video BGA frames progressively (default: on)',
      '  --no-video-bga-streaming  Decode full video BGA before playback (legacy behavior)',
      `  --image-resize-algorithm <nearest|lanczos>  Resize algorithm for BGA/BANNER/STAGEFILE images (default: ${DEFAULT_IMAGE_RESIZE_ALGORITHM})`,
      '  --log-file <path>         Write structured NDJSON logs to a file',
      '                           Default: ~/.be-music/logs/player.ndjson',
      '',
      'Advanced tuning:',
      '  --show-invisible-notes    Show invisible channels (31-39/41-49) in TUI as green notes',
      '  --ln-type-auto            Auto-detect BMS #LNTYPE when omitted (default: on)',
      '  --no-ln-type-auto         Disable BMS #LNTYPE auto-detection when omitted',
      '  --render-audio <path>     Render audio preview before playing',
      '  --volume <value>          Global volume multiplier applied before bus-specific volumes (default: 1)',
      '  --bgm-volume <value>      Volume multiplier for non-play lanes (default: 1, 0 disables BGM)',
      '  --key-volume <value>      Volume multiplier for playable/key sounds (alias: --play-volume, default: 1)',
      '  --audio-tail <seconds>    Audio tail length when rendering playback buffer (default: 1.5)',
      '  --compressor / --no-compressor',
      '                            Enable or disable output compressor (default: on)',
      '  --compressor-threshold-db Compressor threshold in dBFS (default: -12)',
      '  --compressor-ratio        Compressor ratio (default: 2.5)',
      '  --compressor-attack-ms    Compressor attack time in ms (default: 8)',
      '  --compressor-release-ms   Compressor release time in ms (default: 120)',
      '  --compressor-makeup-db    Compressor makeup gain in dB (default: 0)',
      '  --limiter / --no-limiter  Enable or disable output limiter (default: on)',
      '  --limiter-ceiling-db      Limiter ceiling in dBFS (default: -0.3)',
      '  --limiter-release-ms      Limiter release time in ms (default: 80)',
      '  --audio-head-padding-ms   Silent head padding before chart start (default: 0)',
      '  --audio-lead-ms <ms>      Base lead time for real-time mixer scheduling (default: 10)',
      '  --audio-lead-max-ms <ms>  Maximum adaptive lead time under heavy load (default: 32)',
      '  --audio-lead-step-up-ms   Adaptive lead increment step (default: 1.5)',
      '  --audio-lead-step-down-ms Adaptive lead decrement step (default: 0.5)',
      '',
      'Developer/debug:',
      '  --debug-active-audio      Show currently sounding key-sound filenames on play screen (default: off)',
      '  --ruleset <name>       Compat ruleset: lr2 (default) | beatoraja | iidx',
      '  --gauge <name>         Gauge: GROOVE (default) | EASY | HARD | DEATH',
      '  --debug-judge-window <ms> Override BAD window for debugging',
    ].join('\n') + '\n',
  );
}
