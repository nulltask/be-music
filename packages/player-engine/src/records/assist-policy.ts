import type { BeMusicReplay } from '../replay/format.ts';
import type { ReplayOptionChange, ReplayOptionState } from '../replay/options.ts';
import { isCustomJudgeAssist } from '../ruleset/custom-judge.ts';
import { compareClearLamps, type ClearLamp } from '../ruleset/clear-lamp.ts';
import type { RulesetId } from '../ruleset/definitions.ts';

/**
 * How assisted a play is, mildest first (#602). A play takes the highest class of its options.
 *
 * - `none`: no assist.
 * - `light`: beatoraja's LIGHT_ASSIST options, LR2's EASY-capped options and separate-lamp modes, and
 *   That-Which-Must-Not-Be-Named's assist options.
 * - `assist`: beatoraja's ASSIST options (and the debug judge-window override, which widens the windows as CUSTOM JUDGE
 *   does).
 * - `no-save`: an option whose source saves no data from the play (That-Which-Must-Not-Be-Named's BATTLE and the PC
 *   edition's ANY KEY, beatoraja PRACTICE).
 */
export const ASSIST_CLASSES = ['none', 'light', 'assist', 'no-save'] as const;

export type AssistClass = (typeof ASSIST_CLASSES)[number];

/** LR2's separate lamps, kept apart from a chart's ordinary record: D-BATTLE, SP TO DP and EXTRA MODE. */
export type LR2RecordSlot = 'd-battle' | 'sp-to-dp' | 'extra';

/** The record a play keeps under a ruleset: a chart's ordinary record, or one of LR2's separate lamps. */
export type RecordSlot = 'main' | LR2RecordSlot;

/** Where an option comes from: a judge ruleset's source game, or be-music itself (its debug judge-window override). */
export type AssistSource = RulesetId | 'be-music';

/** One assisted option a play used, with the source that classifies it. */
export interface AssistFinding {
  /**
   * What the option is: `auto-scratch`, `any-key`, `judge-window-override`, `custom-judge`, `bpm-guide`, `hs-fix-constant`,
   * `practice`, `extra-notes`, `lr2-extra-mode`, `seven-to-nine`, `mine-remove`, `scroll-remove`, `long-note:<modifier>`
   * or a lane or battle option's value (`H-RANDOM`, `SCATTER`, `BATTLE`, `D-BATTLE`, …).
   */
  option: string;
  source: AssistSource;
  assistClass: Exclude<AssistClass, 'none'>;
  /** Set for LR2's separate-lamp modes. */
  lr2Slot?: LR2RecordSlot;
}

/** The facts of a play the classification reads: its recorded options and chart. */
export type AssistReplay = Pick<BeMusicReplay, 'play'> & {
  chart: Pick<BeMusicReplay['chart'], 'notes' | 'bpmRange'>;
};

/** beatoraja's lane options that declare LIGHT_ASSIST (0.8.9 `Random`, `LaneShuffleModifier`, `NoteShuffleModifier`). */
const BEATORAJA_LIGHT_LANE_OPTIONS: ReadonlySet<string> = new Set([
  'SPIRAL',
  'H-RANDOM',
  'ALL-SCR',
  'RANDOM-EX',
  'S-RANDOM-EX',
  'RANDOM_PLAYABLE',
  'S_RANDOM_PLAYABLE',
]);

/** LR2's lane options that cap the lamp at EASY and save no score (OpenLR2 `LR2f.cpp` L9334, `random > 3`). */
const LR2_LIGHT_LANE_OPTIONS: ReadonlySet<string> = new Set(['SCATTER', 'SCATTER-CORRECTED']);

/** A lane or battle value as `[source, name]`: a qualified value (ADR 0019) keeps its source, a bare one has none. */
function splitSource(value: string): [RulesetId | undefined, string] {
  const colon = value.indexOf(':');
  if (colon < 0) return [undefined, value];
  const source = value.slice(0, colon);
  const name = value.slice(colon + 1);
  return source === 'lr2' || source === 'beatoraja' || source === '____' ? [source, name] : [undefined, value];
}

/** Whether a selected option took `value` at any point of the play: at the start or in a later change. */
function optionEverTook(
  options: Readonly<ReplayOptionState> | undefined,
  changes: readonly ReplayOptionChange[] | undefined,
  key: string,
  value: string | boolean,
): boolean {
  if (options?.[key] === value) return true;
  return (changes ?? []).some((change) => change.values[key] === value);
}

/** Whether the play kept its scroll with HS-FIX CONSTANT at any point (the view, or the selected option). */
function usedHSFixConstant(play: BeMusicReplay['play']): boolean {
  if (play.view?.hsFix === 'CONSTANT') return true;
  if ((play.viewChanges ?? []).some((change) => change.hsFix === 'CONSTANT')) return true;
  return optionEverTook(play.options, play.optionChanges, 'hsFix', 'CONSTANT');
}

/** Whether the chart has a 2P side: a note on a 2P channel (2x, 6x), where the 2P AUTO SCRATCH plays a part. */
function hasSecondPlayerSide(notes: AssistReplay['chart']['notes']): boolean {
  return notes.some((note) => note.channel.startsWith('2') || note.channel.startsWith('6'));
}

/** Whether a long-note modifier generated a CN or HCN (beatoraja `LongNoteModifier` marks only those ASSIST). */
function generatedChargeNote(replay: AssistReplay): boolean {
  return replay.chart.notes.some(
    (note) => note.generatedLongNote === true && note.lnMode !== undefined && note.lnMode !== 1,
  );
}

/** Which source a bare value or a ruleset-relative switch belongs to under `ruleset` (ADR 0019). */
function sourceOf(qualified: RulesetId | undefined, playedRuleset: RulesetId): RulesetId {
  return qualified ?? playedRuleset;
}

/** The lane-option findings of one side's recorded value. */
function laneFinding(value: string | undefined, playedRuleset: RulesetId): AssistFinding | undefined {
  if (value === undefined) return undefined;
  const [qualified, name] = splitSource(value);
  if (BEATORAJA_LIGHT_LANE_OPTIONS.has(name)) return { option: name, source: 'beatoraja', assistClass: 'light' };
  if (LR2_LIGHT_LANE_OPTIONS.has(name)) return { option: name, source: 'lr2', assistClass: 'light' };
  if (name === 'CONVERGE') {
    // LR2's CONVERGE (`random` 5) and beatoraja's PMS CONVERGE (`ConvergeRandomizer`, LIGHT_ASSIST) are both light.
    const source = sourceOf(qualified, playedRuleset);
    return { option: name, source: source === 'beatoraja' ? 'beatoraja' : 'lr2', assistClass: 'light' };
  }
  return undefined;
}

/**
 * The assisted options a play used, each classified by the rules of the source it comes from (#602): LR2 beta3 100201
 * (OpenLR2 `LR2f.cpp` L9196-L9364, L27075-L27095), beatoraja 0.8.9 (`BMSPlayer` L201-L364 and the pattern modifiers),
 * and That-Which-Must-Not-Be-Named AC 34 (its option page: assist options, and BATTLE saves no score). A bare value that two sources
 * define (BATTLE, CONVERGE, AUTO SCRATCH) is the played ruleset's own, as ADR 0019 reads it. Only recorded facts are read,
 * so the server's re-simulation classifies a play the same way: beatoraja's chart-dependent cases use the recorded counts
 * (mines removed, notes converted, scroll changed) and the chart's BPM range.
 */
export function classifyReplayAssists(replay: AssistReplay): AssistFinding[] {
  const { play } = replay;
  const playedRuleset: RulesetId = play.judgeRuleset ?? 'lr2';
  const findings: AssistFinding[] = [];
  const add = (finding: AssistFinding | undefined): void => {
    if (finding !== undefined && !findings.some((known) => known.option === finding.option)) findings.push(finding);
  };

  // AUTO SCRATCH: LR2 caps the lamp at EASY (`p1_assist` / `p2_assist`), That-Which-Must-Not-Be-Named lists it as an assist option;
  // beatoraja has no standalone switch, so LR2's rule stands in.
  const autoScratch1P = play.autoScratch1P ?? play.autoScratch;
  const autoScratch2P = (play.autoScratch2P ?? play.autoScratch) && hasSecondPlayerSide(replay.chart.notes);
  if (autoScratch1P || autoScratch2P)
    add({ option: 'auto-scratch', source: playedRuleset === '____' ? '____' : 'lr2', assistClass: 'light' });

  // ANY KEY is the PC edition's assist, and the PC edition saves no play data from it (NO PLAY).
  if (play.anyKey === true) add({ option: 'any-key', source: '____', assistClass: 'no-save' });
  if (play.judgeWindowOverrideMs !== undefined)
    add({ option: 'judge-window-override', source: 'be-music', assistClass: 'assist' });
  if (play.customJudge !== undefined && isCustomJudgeAssist(play.customJudge))
    add({ option: 'custom-judge', source: 'beatoraja', assistClass: 'assist' });
  // beatoraja assists BPM GUIDE only on a chart whose BPM changes.
  if (
    optionEverTook(play.options, play.optionChanges, 'bpmGuide', true) &&
    replay.chart.bpmRange !== undefined &&
    replay.chart.bpmRange.min < replay.chart.bpmRange.max
  )
    add({ option: 'bpm-guide', source: 'beatoraja', assistClass: 'light' });
  if (usedHSFixConstant(play)) add({ option: 'hs-fix-constant', source: 'lr2', assistClass: 'light' });
  if (play.options?.practice === true && playedRuleset === 'beatoraja')
    add({ option: 'practice', source: 'beatoraja', assistClass: 'no-save' });

  add(laneFinding(play.randomLane?.p1, playedRuleset));
  add(laneFinding(play.randomLane?.p2, playedRuleset));

  switch (play.battleMode) {
    case 'BATTLE':
      // beatoraja's BATTLE is LIGHT_ASSIST (`BMSPlayer` L252); That-Which-Must-Not-Be-Named's saves no score data.
      add(
        playedRuleset === '____'
          ? { option: 'BATTLE', source: '____', assistClass: 'no-save' }
          : { option: 'BATTLE', source: 'beatoraja', assistClass: 'light' },
      );
      break;
    case 'BATTLE-AS':
      add({ option: 'BATTLE-AS', source: 'beatoraja', assistClass: 'light' });
      break;
    case 'D-BATTLE':
      add({ option: 'D-BATTLE', source: 'lr2', assistClass: 'light', lr2Slot: 'd-battle' });
      break;
    case 'SP-TO-DP':
      add({ option: 'SP-TO-DP', source: 'lr2', assistClass: 'light', lr2Slot: 'sp-to-dp' });
      break;
    default:
      break;
  }
  if (play.lr2ExtraMode === true)
    add({ option: 'lr2-extra-mode', source: 'lr2', assistClass: 'light', lr2Slot: 'extra' });
  if ((play.extraNoteChangeCount ?? 0) > 0) add({ option: 'extra-notes', source: 'beatoraja', assistClass: 'assist' });
  if (play.sevenToNineApplied === true) add({ option: 'seven-to-nine', source: 'beatoraja', assistClass: 'light' });
  if (play.mineModifier === 'REMOVE' && (play.mineModifierChangeCount ?? 0) > 0)
    add({ option: 'mine-remove', source: 'beatoraja', assistClass: 'light' });
  if (play.scrollModifier === 'REMOVE' && play.scrollModifierChanged === true)
    add({ option: 'scroll-remove', source: 'beatoraja', assistClass: 'light' });

  const longNotes = play.longNoteModifier;
  if (longNotes === 'LEGACY') add({ option: 'long-note:LEGACY', source: '____', assistClass: 'light' });
  else if (longNotes === 'REMOVE' && (play.longNoteModifierChangeCount ?? 0) > 0)
    add({ option: 'long-note:REMOVE', source: 'beatoraja', assistClass: 'assist' });
  else if (
    (longNotes === 'ADD_CN' || longNotes === 'ADD_HCN' || longNotes === 'ADD_ALL') &&
    (play.longNoteModifierChangeCount ?? 0) > 0 &&
    generatedChargeNote(replay)
  )
    add({ option: `long-note:${longNotes}`, source: 'beatoraja', assistClass: 'assist' });
  return findings;
}

/** The highest class among `findings` ({@link ASSIST_CLASSES}); `none` for none. */
export function resolveAssistClass(findings: readonly { assistClass: AssistClass }[]): AssistClass {
  let index = 0;
  for (const finding of findings) index = Math.max(index, ASSIST_CLASSES.indexOf(finding.assistClass));
  return ASSIST_CLASSES[index]!;
}

/**
 * How a cleared play's lamp is limited: `cap` keeps any lamp up to `lamp` (LR2's EASY), `replace` awards `lamp` for
 * any clear (beatoraja's LIGHT ASSIST EASY / ASSIST EASY, That-Which-Must-Not-Be-Named's ASSIST CLEAR). A failed play stays FAILED.
 */
export interface RecordLampRule {
  rule: 'cap' | 'replace';
  lamp: ClearLamp;
}

/** What a play's assist class means for its records under one judge ruleset: one output per decision, not one boolean. */
export interface RecordPolicy {
  ruleset: RulesetId;
  assistClass: AssistClass;
  /** Whether the play keeps anything in its local record (`no-save` keeps nothing). */
  keepsRecord: boolean;
  /** Whether its EX score, BP and max combo may improve the record; otherwise only its lamp and play count count. */
  updatesScore: boolean;
  /** How its lamp is limited; absent when it is not. */
  lamp?: RecordLampRule;
  /** Which record the play keeps: the chart's ordinary one, or an LR2 separate lamp. */
  recordSlot: RecordSlot;
  /** Whether a course run with a stage of this class keeps a course record, and the stage its chart's (LR2 and beatoraja: no). */
  keepsCourseRecord: boolean;
  /** Where the Leaderboard puts the play: the main board, the assisted board, or stored without ranking. */
  leaderboard: 'main' | 'assisted' | 'unranked';
  /** The replay is always kept: it is what the records are derived from. */
  keepsReplay: true;
}

/**
 * The consequences of a play's assisted options under `ruleset`, each ruleset by its own rules (#602):
 *
 * - `lr2` (OpenLR2 L9196-L9364): an assisted play caps its lamp at EASY and keeps only its lamp and play count. D-BATTLE,
 *   SP TO DP and EXTRA MODE keep a separate lamp instead, capped at EASY only with another assist (AUTO SCRATCH on
 *   D-BATTLE excepted, as LR2's `isForceEasy` exempts it).
 * - `beatoraja` (`BMSPlayer.createScoreData`, `PlayDataAccessor.updateScore`): a cleared LIGHT_ASSIST play is LIGHT ASSIST
 *   EASY and an ASSIST one ASSIST EASY; `updateScore` is off, so only the lamp and play count update.
 * - `____`: an assisted clear is ASSIST CLEAR (the ASSIST EASY lamp) and saves no score, as the original pages leave the
 *   score open and both LR2 and beatoraja block it.
 *
 * `no-save` keeps nothing under any ruleset. A course run with any assisted stage keeps no course record (LR2's
 * `CheckScoreSaveConditon`, beatoraja's `updateCourseScore`). The Leaderboard ranks `none` on the main board, `light` and
 * `assist` on the assisted board, and stores `no-save` unranked.
 */
export function resolveRecordPolicy(findings: readonly AssistFinding[], ruleset: RulesetId): RecordPolicy {
  const assistClass = resolveAssistClass(findings);
  const base = { ruleset, assistClass, keepsReplay: true as const };
  if (assistClass === 'none')
    return {
      ...base,
      keepsRecord: true,
      updatesScore: true,
      recordSlot: 'main',
      keepsCourseRecord: true,
      leaderboard: 'main',
    };
  if (assistClass === 'no-save')
    return {
      ...base,
      keepsRecord: false,
      updatesScore: false,
      recordSlot: 'main',
      keepsCourseRecord: false,
      leaderboard: 'unranked',
    };
  const assisted = {
    ...base,
    keepsRecord: true,
    updatesScore: false,
    keepsCourseRecord: false,
    leaderboard: 'assisted' as const,
  };
  if (ruleset === 'lr2') {
    const slot = findings.find((finding) => finding.lr2Slot !== undefined)?.lr2Slot;
    if (slot === undefined) return { ...assisted, recordSlot: 'main', lamp: { rule: 'cap', lamp: 'EASY' } };
    const forceEasy = findings.some(
      (finding) => finding.lr2Slot === undefined && !(slot === 'd-battle' && finding.option === 'auto-scratch'),
    );
    return {
      ...assisted,
      recordSlot: slot,
      ...(forceEasy ? { lamp: { rule: 'cap' as const, lamp: 'EASY' as const } } : {}),
    };
  }
  if (ruleset === 'beatoraja')
    return {
      ...assisted,
      recordSlot: 'main',
      lamp: { rule: 'replace', lamp: assistClass === 'light' ? 'LIGHT_ASSIST_EASY' : 'ASSIST_EASY' },
    };
  return { ...assisted, recordSlot: 'main', lamp: { rule: 'replace', lamp: 'ASSIST_EASY' } };
}

/** {@link resolveRecordPolicy} of a recorded play, under `ruleset` (the ruleset it was played under by default). */
export function resolveReplayRecordPolicy(replay: AssistReplay, ruleset?: RulesetId): RecordPolicy {
  return resolveRecordPolicy(classifyReplayAssists(replay), ruleset ?? replay.play.judgeRuleset ?? 'lr2');
}

/** The lamp a play keeps under `policy`: unchanged without a lamp rule and for NO PLAY and FAILED. */
export function applyRecordPolicyLamp(lamp: ClearLamp, policy: Pick<RecordPolicy, 'lamp'>): ClearLamp {
  if (policy.lamp === undefined || lamp === 'NO_PLAY' || lamp === 'FAILED') return lamp;
  if (policy.lamp.rule === 'replace') return policy.lamp.lamp;
  return compareClearLamps(lamp, policy.lamp.lamp) > 0 ? policy.lamp.lamp : lamp;
}
