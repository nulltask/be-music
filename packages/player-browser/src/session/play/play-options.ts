/**
 * The options of a play session (`PlaySession`) and of its disposal: everything a host sets for a play, whichever family
 * draws it. `createPlayScene` takes them as its `settings`, `course`, `replay`, `preResolved`, `audio` and `on`.
 */

import type { CourseView, PlayResult, HSFix, RandomMode } from '@be-music/player-scene-model';
import type { GameplayLayoutMode } from '@be-music/player-skin-sdk';
import type { NonstopStitchMap } from '@be-music/player-engine/course';
import type {
  BeMusicReplay,
  ReplayCourseStage,
  ReplayRecordingOptions,
  ReplayPlaybackOptions,
} from '@be-music/player-engine/replay';
import type { GaugeType, RulesetId } from '@be-music/player-engine/ruleset';
import type { ResolvedPlayChart } from '@be-music/player-engine';
import type { CompressorParams, TunableCompressor } from '../../runtime/audio-bus.ts';
import type { AudioService } from '../../runtime/audio-service.ts';
import type { TempoPitchMode, TimeStretchAlgorithm } from '../../runtime/play-tempo.ts';
import type { BeMusicEffectLevel } from '../../skin/be-music/types.ts';

/**
 * The options of a play: the play options it judges and scrolls with, the tempo, the audio mix, the BGA, the drawing
 * options its view reads, and the host's callbacks. Everything here reaches the same engine / audio / BGA pipeline
 * whichever family draws the play.
 */
export interface PlaySessionOptions {
  /** Selected source options to preserve in the replay, independently of score handling. */
  recordingOptionState?: import('@be-music/player-engine/replay').ReplayOptionState;
  /** Showmanship level for the be-music skin (count-ins, shakes, particles). Defaults to `'full'`. */
  beMusicEffects?: BeMusicEffectLevel;
  /**
   * Gameplay layout for the be-music skins. `'touch'` (for touch screens) spreads the lanes across most of the stage
   * with a low judgement line and (on a landscape stage) no BGA; the 24 / 48 KEY modes and LR2 skins keep the standard
   * layout regardless. On a portrait screen a skin with a portrait stage
   * plays 5 / 7 / 9 KEY charts on it, in either mode. Defaults to `'standard'`.
   */
  layoutMode?: GameplayLayoutMode;
  onExit?: () => void;
  /**
   * Restart hook. Fired when the player presses the restart hotkey (`R` by default) — host should dispose this view and
   * mount a fresh one with the same song. The view itself can't recreate its `Application` cleanly, so re-mount is the
   * host's job.
   */
  onRestart?: () => void;
  /**
   * Natural-end hook. Fires once when the chart has finished playing (every playable note judged + a small audio tail
   * buffer). The snapshot is the same payload `PlaySession.getResultData` returns — passed eagerly so the
   * host doesn't have to reach back into the soon-to-be-disposed gameplay view to read it. When this hook is supplied,
   * `onExit` is **not** called for natural completion; `onExit` is reserved for the user-initiated escape (ESC). Hosts
   * that don't want a result screen can leave this unset and rely on `onExit` for both paths (legacy behavior).
   */
  onChartFinished?: (result: PlayResult) => void;
  /** When true, every note is auto-judged as PERFECT at its scheduled time. */
  autoPlay?: boolean;
  /** Opt in to manual seeking; seeking turns the play into practice. */
  allowSeek?: 'practice';
  /** A previous course stage sought: keep this stage out of recording and records too. */
  practice?: boolean;
  /**
   * When true, the gameplay automatically pauses on tab visibility change (`document.hidden`) and window blur, and
   * auto-resumes on focus / `pageshow`. When false (the default), the play scene keeps running in the background —
   * convenient for capturing recordings while another window holds focus, and matches the "no surprise pauses"
   * behavior most rhythm-game hosts ship.
   */
  autoPauseOnBlur?: boolean;
  /**
   * Initial visual scroll-speed multiplier. Mirrors the live runtime hotkey (`ArrowUp` / `ArrowDown` adjusts this value
   * during play); the option lets the host seed it from the select-screen play-options panel so the user doesn't have
   * to re-dial their preferred HS at every song. Clamped to [`HISPEED_MIN`, `HISPEED_MAX`] internally; defaults to
   * `DEFAULT_HISPEED` (2.0).
   */
  initialHiSpeed?: number;
  /**
   * Fires when the player changes the hi-speed during play (`ArrowUp` / `ArrowDown`), with the new value on the same
   * scale as {@link initialHiSpeed} — before any HS-FIX rescaling — so a host can remember it and seed the next play
   * with it. Not fired for `PlaySession.setHiSpeed` writes, which come from the host.
   */
  onHiSpeedChange?: (hiSpeed: number, normalLevel?: number, floating?: boolean) => void;
  /**
   * BGA display mode picked from the LR2 panel-1 BGA toggle (`#SRC_BUTTON,type=72`). Defaults to `'ON'` so charts that
   * ship a BGA render it by default. With `'OFF'` the BGA layer stays empty for the entire play; with `'AUTOPLAY_ONLY'`
   * the BGA only shows when {@link autoPlay} is also true.
   */
  bga?: 'OFF' | 'ON' | 'AUTOPLAY_ONLY';
  /**
   * BGA frame size picked from `#SRC_BUTTON,type=73`. NORMAL uses the skin's default `#DST_BGA` rect (op 30); EXTEND
   * chooses the larger variant (op 31). Defaults to NORMAL.
   */
  bgaSize?: 'NORMAL' | 'EXTEND';
  /**
   * Score-graph display flag picked from `#SRC_BUTTON,type=70`. Drives ops 38 (off) / 39 (on) on the gameplay runtime
   * so the skin's score-prediction line chrome (gated on op 39) shows when enabled. Defaults to `false` to mirror the
   * LR2 default.
   */
  scoreGraph?: boolean;
  /**
   * HS-FIX mode picked from `#SRC_BUTTON,type=55`. Applied as a one-time multiplier on `initialHiSpeed` at
   * chart-prepare time so the user's chosen HS feels consistent across BPM changes. `'CONSTANT'` falls back to
   * `'AVERAGE'` for now — true per-frame BPM-aware scrolling needs a render-pipeline change that hasn't landed yet.
   */
  hsFix?: HSFix;
  classicHiSpeed?: boolean;
  floatingHiSpeed?: boolean;
  fixedDisplayArea?: boolean;
  normalHiSpeedLevel?: number;
  judgeTimingMs?: number;
  visualConstant?: boolean;
  lift1P?: number;
  lift2P?: number;
  liftOn1P?: boolean;
  liftOn2P?: boolean;
  noteDurationMs?: number;
  constantFadeMs?: number;
  onJudgeTimingChange?: (judgeTimingMs: number) => void;
  bpmGuide?: boolean;
  /**
   * HIDDEN / SUDDEN / HID+SUD effect picked from `#SRC_BUTTON,type=50/51`:
   *
   * - `OFF` — no mask
   * - `HIDDEN` — bottom of the playfield is masked (notes disappear before reaching the judge line)
   * - `SUDDEN` — top of the playfield is masked (notes appear suddenly partway down)
   * - `HID+SUD` — both
   *
   * Defaults to `'OFF'`.
   */
  hiddenSudden1P?: 'OFF' | 'HIDDEN' | 'SUDDEN' | 'HID+SUD';
  hiddenSudden2P?: 'OFF' | 'HIDDEN' | 'SUDDEN' | 'HID+SUD';
  /**
   * Shutter coverage (0..1) — how much of the playfield each active mask occupies. `0.25` covers the bottom 25 % for
   * HIDDEN, the top 25 % for SUDDEN, and 25 % at each end for HID+SUD. Drives slider `type=4 / 5` on the panel-1
   * shutter track. Defaults to `0.25`.
   */
  shutter?: number;
  /**
   * LANE COVER ON / OFF toggle (LR2 button_type 46). When true, the gameplay-side mask renders at `shutter`'s
   * configured height. When false, the mask is suppressed regardless of `shutter` — preserves the user's last height
   * across toggles so they don't have to redial it after re-enabling.
   */
  laneCover?: boolean;
  /**
   * Where the lane covers start: `'play-options'` (default) from {@link hiddenSudden1P} / {@link hiddenSudden2P},
   * {@link shutter} and {@link laneCover}; `'none'` with every cover at 0 and off.
   */
  coverStart?: 'play-options' | 'none';
  /**
   * The play takes the lane cover keys (`play-cover-keys.ts`): PageUp / PageDown move SUDDEN+, Home / End the LIFT, H
   * switches HIDDEN+ and J / K move it. The beatoraja play screen's keys; off by default.
   */
  coverKeys?: boolean;
  /** beatoraja's note-selection algorithm. */
  judgeAlgorithm?: 'combo' | 'duration' | 'lowest';
  longNoteModifier?: import('@be-music/player-scene-model').PlayOptions['longNoteModifier'];
  longNoteRate?: number;
  mineModifier?: import('@be-music/player-scene-model').PlayOptions['mineModifier'];
  gaugeAutoShift?: import('@be-music/player-scene-model').PlayOptions['gaugeAutoShift'];
  /**
   * 1P side auto-scratch flag — when true, the scratch lane (channel 16) auto-judges as PERFECT at every note's
   * scheduled time even when {@link autoPlay} is off. The player only has to play the keys.
   */
  autoScratch1P?: boolean;
  /** 2P side auto-scratch (channel 26). */
  autoScratch2P?: boolean;
  /**
   * DP FLIP — when true, swaps every note's 1P / 2P channel at chart-prepare time. Only DP charts have notes on both
   * sides so SP charts are unaffected. Mirrors LR2's `#SRC_BUTTON,type=54`.
   */
  dpFlip?: boolean;
  /**
   * Note-arrangement mode for the 1P keyboard lanes (`#SRC_BUTTON,type=42`). Applied at chart-prepare time so the
   * shuffle is consistent across the play session — pressing F5 (restart) reuses the same `random1P` value but draws a
   * fresh permutation. SCATTER is a legacy value; new requests are rejected until it is fully implemented.
   */
  hRandomThresholdBPM?: number;
  randomSeed1P?: string;
  randomSeed2P?: string;
  randomFixedLane1P?: number;
  randomFixedLane2P?: number;
  random1P?: RandomMode;
  /** 2P side note arrangement (`#SRC_BUTTON,type=43`). */
  random2P?: RandomMode;
  /**
   * Replay playback: a recorded replay to re-drive instead of live keyboard input. The chart prepare skips the
   * usual DP-flip / lane-shuffle passes and re-applies the RECORDED arrangement (`applyReplayArrangement`), the
   * engine consumes `replay.inputs` deterministically (`PlayerOptions.replayInputs`), live lane input is ignored,
   * and no new replay is recorded for the run. The chart's `#RANDOM` / `#SWITCH` lines take the log's
   * `play.randomDraws`, so the replay plays the recorded branches. `prepare` rejects when the loaded chart does not
   * match the log (draws that were not drawn for its control flow, a log without draws whose branches differ, or a
   * different chart file).
   */
  replay?: BeMusicReplay;
  /** Reuse the resolved chart layout while playing fresh input and recording a new replay. */
  fixedArrangement?: Pick<BeMusicReplay, 'chart' | 'play'>;
  /**
   * Which of the view a {@link replay} recorded (`play.view` / `play.viewChanges`) it shows over the viewer's own
   * settings: the hi-speed, SUDDEN+ / HIDDEN+, the lift (this scene has none to show) and the tempo. Defaults to all
   * (`DEFAULT_REPLAY_PLAYBACK_OPTIONS`).
   */
  replayView?: Readonly<ReplayPlaybackOptions>;
  /**
   * Judgment-window ruleset for the shared engine (`PlayerOptions.judgeRuleset`): `'lr2'` (default) / `'beatoraja'`
   * / `'____'`. Recorded into the replay; replays re-apply the log's own value instead.
   */
  judgeRuleset?: RulesetId;
  /**
   * SHA-256 (lowercase hex) of the source chart file bytes, when the host computed one. Stamped into the recorded
   * replay (`chart.sha256`) so a dropped log can be matched back to its chart by content.
   */
  chartSHA256?: string;
  /** MD5 (lowercase hex) of the same bytes, stamped as `chart.md5` (the key LR2 and LR2IR use). */
  chartMD5?: string;
  /** Host application stamped into the recorded replay's `recorder` (the engine adds its own version). */
  replayRecorder?: ReplayRecordingOptions['recorder'];
  /**
   * 1P gauge variant (`#SRC_BUTTON,type=40`). Selects the ruleset's gauge (the engine resolves the curve) and drives
   * the gauge-on-red-branch op flags (43 / 45). 2P-side gauge isn't yet separately wired — the engine
   * consumes the 1P value and applies it to the single shared gauge.
   */
  gauge?: GaugeType;
  /**
   * The play is one stage of a course (`PlayerOptions.course`): it runs on the ruleset's course gauge, from the state the
   * previous stage left. Recorded into the replay, which then replays on its own.
   */
  course?: ReplayCourseStage;
  /**
   * The running course as the skin shows it — its kind, title, stage list and the stage being played (LR2 ops 280-293,
   * texts 150-170; beatoraja's course strings). Display only; the judging follows {@link course}.
   */
  courseInfo?: CourseView;
  /**
   * The chart is a stitched NONSTOP course (`stitchNonstopCourse`'s map): each stage's samples play at its FIT rate
   * and its background sound fades at the stage seams.
   */
  nonstop?: NonstopStitchMap;
  /**
   * The play tempo, 0.5 to 1.5 (`clampPlayTempo`; default 1): the play clock, its audio, the scroll, the BGA and the
   * chart-time lead-out run `tempo` times as fast, while judging stays in chart time (the engine's `speed`). A replay
   * plays at the tempo its log recorded (`play.tempo`) instead. A NONSTOP FIT stage's rate multiplies with it. In `pitch`
   * mode it can change during the play (`PlaySession.setTempo`).
   */
  tempo?: number;
  /** Fires when the play tempo changed during the play (`setTempo`, or a replay following its log), with the new one. */
  onTempoChange?: (tempo: number) => void;
  /**
   * How a tempo change sounds, for {@link tempo} and NONSTOP FIT stages alike: `pitch` (default, as LR2) plays the
   * samples faster or slower, `keep-pitch` stretches them to the new tempo when they load and keeps their pitch.
   */
  tempoPitchMode?: TempoPitchMode;
  /** The time stretcher keep pitch uses: `signalsmith` (default, Signalsmith Stretch) or `wsola`. */
  tempoStretchAlgorithm?: TimeStretchAlgorithm;
  /** The hi-speed cannot be changed during play (a course's `no_speed` constraint). */
  hiSpeedLocked?: boolean;
  /**
   * When true, every decoded sample of the chart is scaled by one gain so the loudest peak sits near −3 dBFS. Off
   * when omitted: charts keep the level they were authored at. Applies as the samples load, so a change takes the
   * next play. `#VOLWAV` still multiplies on top at playback.
   */
  peakGain?: boolean;
  /**
   * When true (default), the audio bus runs through dynamics compressors that soften clipping when many BMS samples
   * fire simultaneously (jacks, dense BGM stacks). Set to `false` to bypass every compressor and feed sample sources
   * directly to `audioContext.destination`.
   *
   * Equivalent to `audioCompressorMode === 'off'` when `false`. When `true` (or omitted), the active mode comes from
   * `audioCompressorMode` (defaults to `'split'`).
   */
  audioCompressor?: boolean;
  /**
   * Compressor architecture when `audioCompressor` is enabled.
   *
   * - `'split'` (default) — separate compressors on the key / BGM buses plus a master limiter; key bus tuned
   *   aggressively for transient peaks, BGM bus tuned for musical glue, master for clip protection. Prevents BGM
   *   ducking under dense input bursts (a known failure mode of the legacy single-bus compressor).
   * - `'legacy'` — original single-compressor topology, kept for A/B comparison via the player's `?compressor=legacy` URL
   *   flag so behavior can be diff-tested directly.
   *
   * `'off'` is reachable via `audioCompressor: false` rather than being a valid value here — `audioCompressor` is the
   * user- facing toggle, this option only chooses **which** compressed topology to use when compression is on.
   */
  audioCompressorMode?: 'split' | 'legacy';
  /**
   * Initial per-stage on/off flags for the split-bus architecture. Defaults to all `true` (every stage engaged). Hosts
   * that surface a UI for per-stage bypass should pass the current UI state here so the bus comes up matching the
   * visible selection — otherwise the user's stage choices on the select screen would be silently reset every gameplay
   * re-mount.
   */
  audioCompressorStages?: { key?: boolean; bgm?: boolean; master?: boolean };
  /**
   * Initial user volume per source bus — `key` (player keysounds) and `bgm` (auto-triggered BGM) — as linear gains
   * (1 = unity, clamped to `0..2`). Hosts with volume sliders pass the current UI values so a re-mounted gameplay keeps
   * the user's balance; `PlaySession.setAudioVolume` changes them live.
   */
  audioVolumes?: { key?: number; bgm?: number };
  /**
   * Parameter overrides per compressor (`key` / `bgm` / `master` in split mode, `legacy`), merged over the factory
   * tuning. `PlaySession.setAudioCompressorParams` retunes them live.
   */
  audioCompressorParams?: Partial<Record<TunableCompressor, Partial<CompressorParams>>>;
  /**
   * When set to a positive integer, BGA videos that need the ffmpeg.wasm fallback (legacy `.mpg` / `.wmv` / `.avi` /
   * unsupported codecs) are downscaled during transcode so neither edge exceeds this many pixels. Aspect ratio is
   * preserved.
   *
   * Single-threaded libx264 cost scales linearly with pixel count, so capping at 720 / 480 / etc. is the biggest
   * single-threaded speed lever once `-preset ultrafast` is in effect. Visual parity holds well under nearest-filter
   * scaling because the BGA layer is rendered into a 256-px spec canvas.
   *
   * `undefined` / `0` / negative values disable the cap and the source resolution passes through unchanged (the default
   * behavior).
   */
  bgaTranscodeMaxLongEdgePx?: number;
  /**
   * When true, the BGA transcode fallback uses the browser's WebCodecs `VideoEncoder` API instead of libx264 in
   * ffmpeg.wasm. The decode step still goes through ffmpeg because WebCodecs' `VideoDecoder` doesn't speak the legacy
   * codecs (MPEG-1, VC-1, etc.) BMS BGA usually ships in.
   *
   * Hardware-accelerated where the browser exposes a platform encoder — typically a 5–20× encode-side speedup. Silently
   * falls back to the ffmpeg-only path when the browser doesn't support WebCodecs, the encoder rejects the configured
   * parameters, or the raw decoded frames would exceed the in-memory budget.
   */
  bgaTranscodeUseWebCodecs?: boolean;
  /**
   * Debug overlay — when true, the renderer paints a thin green bar at every invisible / keysound note's chart position
   * (BMS channels `3x` / `4x`, the chart author's hidden keysound layout). The bars never affect gameplay or judgement;
   * they're a chart-inspection aid for verifying which lane each `#WAV` sample is wired to. Defaults to `false` so the
   * regular play surface stays uncluttered.
   */
  showInvisibleNotes?: boolean;
  /**
   * Single-note visibility after judgement.
   *
   * - `'KEEP_SCROLLING'` (default) — a judged note stays on screen until its own time: one hit early keeps scrolling
   *   down to the judgement line and goes when it reaches it. This is what LR2 (`DrawNotes` draws a hit note until the
   *   playhead reaches it) and beatoraja (`LaneRenderer` draws a note while its time is ahead, judged or not) both do.
   * - `'HIDE'` — a judged note goes the moment it is judged, which neither player does; kept as a preference for a
   *   cleaner playfield in dense passages.
   *
   * Only tap notes are gated. Long notes stay until their end either way, so this option doesn't disturb them.
   */
  judgedNoteDisplay?: 'KEEP_SCROLLING' | 'HIDE';
  /**
   * The chart's `#RANDOM` / `#SWITCH` branches as the decide screen drew them (`DecideScene.resolved`), so the play
   * plays the branches the screen showed. Without it the play draws its own; a replay always plays its log's.
   */
  preResolved?: ResolvedPlayChart;
  /**
   * The host's audio service: the play opens its own context and bus through it (`openPlayGraph`). Without one the play
   * makes them itself.
   */
  audio?: AudioService;
}

export interface PlayDisposeOptions {
  /**
   * Natural chart end can transition visually to result while a long final sample still rings out. Keep the Web Audio
   * graph alive briefly in that path instead of closing the AudioContext as part of visual teardown.
   */
  preserveAudioTail?: boolean;
}
