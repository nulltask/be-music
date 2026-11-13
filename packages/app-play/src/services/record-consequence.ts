// What a play does to its record, in one line: before the play from the options picked (`resolvePlannedRecordPolicy`),
// and after it from the replay (`resolveReplayRecordPolicy`). Both go through the engine's record policy, so the line
// before a play and the record after it cannot disagree.
import {
  resolvePlannedRecordPolicy,
  resolveReplayRecordPolicy,
  type AssistFinding,
  type PlannedPlay,
  type PlannedRecordPolicy,
  type RecordPolicy,
} from '@be-music/player-engine/records';
import { classifyReplayAssists } from '@be-music/player-engine/records';
import { isBmsonRecoveryDisabled } from '@be-music/player-engine/ruleset';
import type { PlayResult } from '@be-music/player-scene-model';
import { playerText, type PlayerCopy } from '../player-copy.ts';
import type { PlayerGUIState } from '../types.ts';

/** The settings a play's record consequence is read from. */
export type RecordConsequenceState = Pick<
  PlayerGUIState,
  | 'judgeRuleset'
  | 'autoPlay'
  | 'autoScratch1P'
  | 'autoScratch2P'
  | 'anyKey'
  | 'customJudge'
  | 'customJudgeKeyPerfectGreat'
  | 'customJudgeKeyGreat'
  | 'customJudgeKeyGood'
  | 'customJudgeScratchPerfectGreat'
  | 'customJudgeScratchGreat'
  | 'customJudgeScratchGood'
  | 'customJudgeLongNoteMargin'
  | 'bpmGuide'
  | 'hsFix'
  | 'floatingHiSpeed'
  | 'classicHiSpeed'
  | 'normalHiSpeedLevel'
  | 'practice'
  | 'random1P'
  | 'random2P'
  | 'battleMode'
  | 'lr2AddNotes'
  | 'lr2Loudness'
  | 'lr2AddLongNotes'
  | 'lr2AddMines'
  | 'lr2ExtraMode'
  | 'mineModifier'
  | 'scrollModifier'
  | 'longNoteModifier'
  | 'extraNoteDepth'
  | 'sevenToNinePattern'
>;

/**
 * The play the settings would start, in the fields a replay records it in: each option as the play takes it
 * (`resolvePlaySceneOptions`, `createPlayScene`, `resolveReplayRecording`). A course's lane limits are not applied: the
 * line describes a single play of the chart.
 */
export function plannedPlayOf(state: RecordConsequenceState): PlannedPlay {
  const ruleset = state.judgeRuleset;
  // HS-FIX is off while a hi-speed mode of its own scrolls the notes.
  const ownHiSpeed = state.floatingHiSpeed || state.classicHiSpeed || state.normalHiSpeedLevel > 0;
  return {
    judgeRuleset: ruleset,
    autoScratch1P: state.autoScratch1P,
    autoScratch2P: state.autoScratch2P,
    // ANY KEY is offered with the `____` judge rules only, and CUSTOM JUDGE with beatoraja's.
    anyKey: state.anyKey && ruleset === '____',
    ...(state.customJudge && ruleset === 'beatoraja'
      ? {
          customJudge: {
            keyPerfectGreat: state.customJudgeKeyPerfectGreat,
            keyGreat: state.customJudgeKeyGreat,
            keyGood: state.customJudgeKeyGood,
            scratchPerfectGreat: state.customJudgeScratchPerfectGreat,
            scratchGreat: state.customJudgeScratchGreat,
            scratchGood: state.customJudgeScratchGood,
            longNoteMargin: state.customJudgeLongNoteMargin,
          },
        }
      : {}),
    options: { bpmGuide: state.bpmGuide, hsFix: ownHiSpeed ? 'OFF' : state.hsFix, practice: state.practice },
    randomLane: { p1: state.random1P, p2: state.random2P },
    battleMode: state.battleMode as NonNullable<PlannedPlay['battleMode']>,
    lr2Mania: {
      addNotes: state.lr2AddNotes,
      loudness: state.lr2Loudness,
      addLongNotes: state.lr2AddLongNotes,
      addMines: state.lr2AddMines,
    } as NonNullable<PlannedPlay['lr2Mania']>,
    lr2ExtraMode: state.lr2ExtraMode,
    mineModifier: state.mineModifier,
    scrollModifier: state.scrollModifier,
    longNoteModifier: state.longNoteModifier,
    extraNotes: state.extraNoteDepth > 0,
    sevenToNine: state.sevenToNinePattern !== 0,
  };
}

/** An assisted option's name on the line: the dialog's own name for it, or the lane option's as recorded. */
const FINDING_NAMES: Readonly<Record<string, string>> = {
  'auto-scratch': 'AUTO SCRATCH',
  'any-key': 'ANY KEY',
  'judge-window-override': 'JUDGE WINDOW',
  'custom-judge': 'CUSTOM JUDGE',
  'bpm-guide': 'BPM GUIDE',
  'hs-fix-constant': 'HS-FIX CONSTANT',
  practice: 'PRACTICE',
  'lr2-add-notes': 'ADD NOTES',
  'lr2-loudness': 'LOUDNESS',
  'lr2-add-longnotes': 'ADD LONGNOTES',
  'lr2-add-mines': 'ADD MINES',
  'lr2-extra-mode': 'EXTRA MODE',
  'extra-notes': 'EXTRA NOTE',
  'seven-to-nine': '7 TO 9',
  'mine-remove': 'MINE REMOVE',
  'scroll-remove': 'SCROLL REMOVE',
  'long-note:LEGACY': 'LEGACY NOTE',
  'long-note:REMOVE': 'LN REMOVE',
  'long-note:ADD_CN': 'ADD CN',
  'long-note:ADD_HCN': 'ADD HCN',
  'long-note:ADD_ALL': 'ADD ALL',
};

function names(findings: readonly AssistFinding[]): string {
  return findings.map((finding) => FINDING_NAMES[finding.option] ?? finding.option).join(', ');
}

/** The lamps a lamp rule names, as the lamp lists show them. */
const LAMP_NAMES: Readonly<Record<string, string>> = {
  EASY: 'EASY',
  LIGHT_ASSIST_EASY: 'LIGHT ASSIST EASY',
  ASSIST_EASY: 'ASSIST EASY',
};

/** What `policy` keeps of a play, caused by `findings`: one line. */
export function describeRecordPolicy(
  policy: RecordPolicy,
  findings: readonly AssistFinding[],
  copy: PlayerCopy['record'] = playerText().record,
): string {
  if (policy.assistClass === 'none') return copy.full;
  if (policy.assistClass === 'no-save') return copy.notSaved(names(findings));
  const lampName = policy.lamp === undefined ? undefined : (LAMP_NAMES[policy.lamp.lamp] ?? policy.lamp.lamp);
  const lamp =
    policy.lamp === undefined || lampName === undefined
      ? copy.lampKept
      : policy.lamp.rule === 'cap'
        ? copy.lampCap(lampName)
        : copy.lampReplace(lampName);
  const slot = policy.recordSlot === 'main' ? '' : copy.separateLamp(copy.slots[policy.recordSlot]);
  return copy.assisted(copy.classes[policy.assistClass], lamp + slot, names(findings));
}

/**
 * The record consequence of the options picked, before a play: what holds on any chart, then what a chart-dependent
 * option adds on a chart it changes.
 */
export function describePlannedRecord(
  planned: PlannedRecordPolicy,
  autoPlay = false,
  copy: PlayerCopy['record'] = playerText().record,
): string {
  if (autoPlay) return copy.autoPlay;
  const certain = describeRecordPolicy(planned.policy, planned.findings, copy);
  if (planned.conditionalFindings.length === 0) return certain;
  const every = [...planned.findings, ...planned.conditionalFindings];
  return `${certain} ${copy.conditional(names(planned.conditionalFindings), describeRecordPolicy(planned.conditionalPolicy, every, copy))}`;
}

/** {@link describePlannedRecord} of the player's settings. */
export function describeRecordConsequence(state: RecordConsequenceState): string {
  return describePlannedRecord(resolvePlannedRecordPolicy(plannedPlayOf(state)), state.autoPlay);
}

/**
 * What a finished play did to its record: `kept` is whether the record took it. A replay's result and a play without
 * a replay say nothing.
 */
export function describeResultRecord(
  data: Pick<PlayResult, 'replay' | 'practice' | 'autoPlay' | 'fromReplay' | 'secondPlayer'>,
  kept: boolean,
  copy: PlayerCopy['record'] = playerText().record,
): string | undefined {
  if (data.fromReplay === true) return undefined;
  if (data.autoPlay === true) return copy.autoPlay;
  if (data.practice === true) return copy.notSaved('PRACTICE');
  if (data.secondPlayer !== undefined) return copy.twoPlayer;
  const replay = data.replay;
  if (replay === undefined) return undefined;
  if (isBmsonRecoveryDisabled(replay.chart, replay.play.bmsonTotalMode)) return copy.bmsonTotal;
  const findings = classifyReplayAssists(replay);
  const policy = resolveReplayRecordPolicy(replay);
  // A record that did not take the play though its policy keeps one (no record key for the chart, say).
  if (!kept && policy.keepsRecord) return undefined;
  return describeRecordPolicy(policy, findings, copy);
}
