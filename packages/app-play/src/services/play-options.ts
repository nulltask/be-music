import type { BeMusicReplay } from '@be-music/player-engine/replay';
// The play options the player hands to every screen and play: the full `PlayOptions`, kept here rather than read back
// from the select screen. The Debug Menu holds some of them itself (auto play, gauge, lane options, assists, sort and
// filters, hi-speed and covers); the rest (BGA, the score graph and the 2P gauge) are only
// changed on a select screen, and live here between screens, so a select screen made again (another skin system or
// theme) starts from them.

import { resolvePlayOptions, type PlayOptions } from '@be-music/player-scene-model';
import type { PlayerGUIState } from '../types.ts';

/** The play options the Debug Menu holds itself, under its own names (`gauge` is `gauge1P`). */
export type GUIPlayOptions = Pick<
  PlayerGUIState,
  | 'autoPlay'
  | 'gauge'
  | 'hRandomThresholdBPM'
  | 'randomSeed1P'
  | 'randomSeed2P'
  | 'randomFixedLane1P'
  | 'randomFixedLane2P'
  | 'random1P'
  | 'random2P'
  | 'dpFlip'
  | 'bpmGuide'
  | 'judgeTimingAutoAdjust'
  | 'visualConstant'
  | 'lift1P'
  | 'lift2P'
  | 'liftOn1P'
  | 'liftOn2P'
  | 'noteDurationMs'
  | 'constantFadeMs'
  | 'judgeTimingMs'
  | 'normalHiSpeedLevel'
  | 'classicHiSpeed'
  | 'floatingHiSpeed'
  | 'fixedDisplayArea'
  | 'judgeAlgorithm'
  | 'scrollSection'
  | 'scrollRate'
  | 'scrollModifier'
  | 'mineModifier'
  | 'gaugeAutoShift'
  | 'bottomShiftableGauge'
  | 'longNoteModifier'
  | 'longNoteRate'
  | 'sevenToNinePattern'
  | 'sevenToNineType'
  | 'battleMode'
  | 'lr2ExtraMode'
  | 'lr2ExtraLevel'
  | 'extraNoteDepth'
  | 'extraNoteScratch'
  | 'autoScratch1P'
  | 'autoScratch2P'
  | 'sort'
  | 'keysFilter'
  | 'difficultyFilter'
  | 'hiSpeed'
  | 'hsFix'
  | 'displayAreaInfo'
  | 'hiddenSudden1P'
  | 'hiddenSudden2P'
  | 'laneCover'
  | 'shutter'
>;

/** The Debug Menu's play options as `PlayOptions` fields. */
export function playOptionsFromGUI(state: Readonly<GUIPlayOptions>): Partial<PlayOptions> {
  return {
    autoPlay: state.autoPlay,
    gauge1P: state.gauge,
    random1P: state.random1P,
    hRandomThresholdBPM: state.hRandomThresholdBPM,
    randomSeed1P: state.randomSeed1P,
    randomSeed2P: state.randomSeed2P,
    randomFixedLane1P: state.randomFixedLane1P,
    randomFixedLane2P: state.randomFixedLane2P,
    random2P: state.random2P,
    dpFlip: state.dpFlip,
    bpmGuide: state.bpmGuide,
    judgeTimingAutoAdjust: state.judgeTimingAutoAdjust,
    visualConstant: state.visualConstant,
    noteDurationMs: state.noteDurationMs,
    lift1P: state.lift1P,
    lift2P: state.lift2P,
    liftOn1P: state.liftOn1P,
    liftOn2P: state.liftOn2P,

    constantFadeMs: state.constantFadeMs,
    judgeTimingMs: state.judgeTimingMs,
    normalHiSpeedLevel: state.normalHiSpeedLevel,
    classicHiSpeed: state.classicHiSpeed,
    floatingHiSpeed: state.floatingHiSpeed,
    fixedDisplayArea: state.fixedDisplayArea,
    judgeAlgorithm: state.judgeAlgorithm,
    longNoteModifier: state.longNoteModifier,
    longNoteRate: state.longNoteRate,
    sevenToNinePattern: state.sevenToNinePattern,
    sevenToNineType: state.sevenToNineType,
    battleMode: state.battleMode,
    lr2ExtraMode: state.lr2ExtraMode,
    lr2ExtraLevel: state.lr2ExtraLevel,
    extraNoteDepth: state.extraNoteDepth,
    extraNoteScratch: state.extraNoteScratch,
    mineModifier: state.mineModifier,
    scrollModifier: state.scrollModifier,
    scrollSection: state.scrollSection,
    scrollRate: state.scrollRate,
    gaugeAutoShift: state.gaugeAutoShift,
    bottomShiftableGauge: state.bottomShiftableGauge,
    autoScratch1P: state.autoScratch1P,
    autoScratch2P: state.autoScratch2P,
    sort: state.sort,
    keysFilter: state.keysFilter,
    difficultyFilter: state.difficultyFilter,
    hiSpeed: state.hiSpeed,
    hsFix: state.hsFix,
    displayAreaInfo: state.displayAreaInfo,
    hiddenSudden1P: state.hiddenSudden1P,
    hiddenSudden2P: state.hiddenSudden2P,
    laneCover: state.laneCover,
    shutter: state.shutter,
  };
}

/**
 * Mirrors a select screen's play options (an LR2 panel, a skin's buttons) into the Debug Menu's state, so both surfaces
 * agree. The hi-speed is left to the caller, which also remembers it for the next visit.
 */
export function copyPlayOptionsToGUI(options: Readonly<PlayOptions>, state: GUIPlayOptions): void {
  state.hsFix = options.hsFix;
  state.displayAreaInfo = options.displayAreaInfo;
  state.hiddenSudden1P = options.hiddenSudden1P;
  state.hiddenSudden2P = options.hiddenSudden2P;
  state.laneCover = options.laneCover;
  state.shutter = options.shutter;
  state.autoPlay = options.autoPlay;
  state.gauge = options.gauge1P;
  state.random1P = options.random1P;
  state.hRandomThresholdBPM = options.hRandomThresholdBPM;
  state.randomSeed1P = options.randomSeed1P;
  state.randomSeed2P = options.randomSeed2P;
  state.randomFixedLane1P = options.randomFixedLane1P;
  state.randomFixedLane2P = options.randomFixedLane2P;
  state.random2P = options.random2P;
  state.dpFlip = options.dpFlip;
  state.bpmGuide = options.bpmGuide;
  state.judgeTimingAutoAdjust = options.judgeTimingAutoAdjust;
  state.visualConstant = options.visualConstant;
  state.noteDurationMs = options.noteDurationMs;
  state.lift1P = options.lift1P;
  state.lift2P = options.lift2P;
  state.liftOn1P = options.liftOn1P;
  state.liftOn2P = options.liftOn2P;

  state.constantFadeMs = options.constantFadeMs;
  state.judgeTimingMs = options.judgeTimingMs;
  state.normalHiSpeedLevel = options.normalHiSpeedLevel;
  state.classicHiSpeed = options.classicHiSpeed;
  state.floatingHiSpeed = options.floatingHiSpeed;
  state.fixedDisplayArea = options.fixedDisplayArea;
  state.judgeAlgorithm = options.judgeAlgorithm;
  state.longNoteModifier = options.longNoteModifier;
  state.longNoteRate = options.longNoteRate;
  state.sevenToNinePattern = options.sevenToNinePattern;
  state.sevenToNineType = options.sevenToNineType;
  state.battleMode = options.battleMode;
  state.lr2ExtraMode = options.lr2ExtraMode;
  state.lr2ExtraLevel = options.lr2ExtraLevel;
  state.extraNoteDepth = options.extraNoteDepth;
  state.extraNoteScratch = options.extraNoteScratch;
  state.mineModifier = options.mineModifier;
  state.scrollModifier = options.scrollModifier;
  state.scrollSection = options.scrollSection;
  state.scrollRate = options.scrollRate;
  state.gaugeAutoShift = options.gaugeAutoShift;
  state.bottomShiftableGauge = options.bottomShiftableGauge;
  state.autoScratch1P = options.autoScratch1P;
  state.autoScratch2P = options.autoScratch2P;
  state.sort = options.sort;
  state.keysFilter = options.keysFilter;
  state.difficultyFilter = options.difficultyFilter;
}

/**
 * The full play options in force, over `DEFAULT_PLAY_OPTIONS`. It takes every change from both surfaces: the select
 * screen's own (`on.playOptions`, its whole set) and the Debug Menu's (one option at a time). Each change is checked
 * as the select screen checks it (`resolvePlayOptions`), so the two never drift apart.
 */
export class PlayOptionsService {
  private options: PlayOptions;
  private previousArrangement: { chartId: string; replay: Pick<BeMusicReplay, 'chart' | 'play'> } | undefined;
  private fixedArrangement: { chartId: string; replay: Pick<BeMusicReplay, 'chart' | 'play'> } | undefined;

  /** Retain the previous beatoraja play's exact arrangement, including source control-flow draws. */
  public rememberArrangement(chartId: string, replay: BeMusicReplay | undefined): void {
    if (replay?.play.judgeRuleset !== 'beatoraja') return;
    this.previousArrangement = { chartId, replay: structuredClone({ chart: replay.chart, play: replay.play }) };
  }

  /** Pin the previous layout for a fresh play on the same chart; no recorded inputs are replayed. */
  public reusePreviousArrangement(): Partial<PlayOptions> | undefined {
    const previous = this.previousArrangement;
    if (!previous) return undefined;
    const play = previous.replay.play;
    const source = resolvePlayOptions({
      ...play.options,
      random1P: play.randomLane?.p1 ?? play.options?.random1P,
      random2P: play.randomLane?.p2 ?? play.options?.random2P,
      dpFlip: play.dpFlip ?? play.options?.dpFlip,
      longNoteModifier: play.longNoteModifier ?? play.options?.longNoteModifier,
      longNoteRate: play.longNoteRate ?? play.options?.longNoteRate,
      sevenToNinePattern: play.sevenToNinePattern ?? 0,
      sevenToNineType: play.sevenToNineType ?? 0,
      hRandomThresholdBPM: play.sevenToNineThresholdBPM ?? play.options?.hRandomThresholdBPM,
      battleMode: play.battleMode ?? 'OFF',
      lr2ExtraMode: play.lr2ExtraMode ?? false,
      lr2ExtraLevel: play.lr2ExtraLevel ?? 0,
      extraNoteDepth: play.extraNoteDepth ?? 0,
      extraNoteScratch: play.extraNoteScratch ?? false,
      mineModifier: play.mineModifier ?? play.options?.mineModifier,
      scrollModifier: play.scrollModifier ?? play.options?.scrollModifier,
      scrollSection: play.scrollSection ?? play.options?.scrollSection,
      scrollRate: play.scrollRate ?? play.options?.scrollRate,
    });
    const changes: Partial<PlayOptions> = {};
    for (const key of ARRANGEMENT_OPTIONS) Object.assign(changes, { [key]: source[key] });
    this.update(changes);
    this.fixedArrangement = structuredClone(previous);
    return changes;
  }

  /** Stop pinning the previous layout; explicit seed settings still apply. */
  public clearArrangement(): void {
    this.fixedArrangement = undefined;
  }

  /** A chart-specific copy prevents a reused layout from leaking to another chart. */
  public arrangementFor(chartId: string): Pick<BeMusicReplay, 'chart' | 'play'> | undefined {
    return this.fixedArrangement?.chartId === chartId ? structuredClone(this.fixedArrangement.replay) : undefined;
  }

  public constructor(initial: Readonly<Partial<PlayOptions>> = {}) {
    this.options = resolvePlayOptions(initial);
  }

  /** The play options in force, as a copy: what a select screen starts from, and what a decide screen and a play take. */
  public get current(): PlayOptions {
    return { ...this.options };
  }

  /**
   * Takes `changes` over the options in force. An option given a value it does not take goes back to its default, as
   * on the select screen.
   */
  public update(changes: Readonly<Partial<PlayOptions>>): void {
    const next = resolvePlayOptions({ ...this.options, ...changes });
    if (ARRANGEMENT_OPTIONS.some((key) => next[key] !== this.options[key])) this.clearArrangement();
    this.options = next;
  }
}

const ARRANGEMENT_OPTIONS = [
  'random1P',
  'random2P',
  'randomSeed1P',
  'randomSeed2P',
  'randomFixedLane1P',
  'randomFixedLane2P',
  'dpFlip',
  'hRandomThresholdBPM',
  'longNoteModifier',
  'longNoteRate',
  'sevenToNinePattern',
  'sevenToNineType',
  'battleMode',
  'lr2ExtraMode',
  'lr2ExtraLevel',
  'extraNoteDepth',
  'extraNoteScratch',
  'mineModifier',
  'scrollModifier',
  'scrollSection',
  'scrollRate',
] as const satisfies readonly (keyof PlayOptions)[];
