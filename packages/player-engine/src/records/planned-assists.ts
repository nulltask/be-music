/**
 * The record consequence of a play before it is played: the options picked, classified by the classifier a finished
 * play goes through ({@link classifyReplayAssists}). Some findings depend on the chart (a BPM GUIDE on a chart whose BPM
 * changes, a REMOVE modifier that removed something, a 2P option on a chart with a 2P side), and the chart is not
 * prepared yet, so the plan is classified twice: once as if no chart-dependent case arises and once as if every one
 * does. A finding only in the second is conditional.
 */
import type { BeMusicReplay } from '../replay/format.ts';
import type { RulesetId } from '../ruleset/definitions.ts';
import {
  classifyReplayAssists,
  resolveRecordPolicy,
  type AssistFinding,
  type AssistReplay,
  type RecordPolicy,
} from './assist-policy.ts';

/**
 * The options a play is about to start with, in the fields a replay records them in (`BeMusicReplay.play`). The
 * counts a prepared chart gives (`mineModifierChangeCount`, `longNoteModifierChangeCount`, `scrollModifierChanged`,
 * `extraNoteChangeCount`, `sevenToNineApplied`) are not read: the plan says whether the option is on instead.
 */
export interface PlannedPlay extends Partial<
  Pick<
    BeMusicReplay['play'],
    | 'judgeRuleset'
    | 'autoScratch'
    | 'autoScratch1P'
    | 'autoScratch2P'
    | 'anyKey'
    | 'customJudge'
    | 'options'
    | 'view'
    | 'randomLane'
    | 'battleMode'
    | 'lr2Mania'
    | 'lr2ExtraMode'
    | 'mineModifier'
    | 'scrollModifier'
    | 'longNoteModifier'
  >
> {
  /** An option that adds notes to the chart is on (beatoraja's extra note depth). */
  readonly extraNotes?: boolean;
  /** A 7-to-9 pattern is on. */
  readonly sevenToNine?: boolean;
}

/** What a planned play does to its record: for certain, and at most. */
export interface PlannedRecordPolicy {
  /** The findings that hold on any chart. */
  readonly findings: readonly AssistFinding[];
  /** The findings that hold only on a chart the option changes something on. */
  readonly conditionalFindings: readonly AssistFinding[];
  /** The policy of the certain findings: what the play does to its record on a chart no conditional finding holds on. */
  readonly policy: RecordPolicy;
  /** The policy with every conditional finding holding; equal to `policy` when there is none. */
  readonly conditionalPolicy: RecordPolicy;
}

/** A chart on which every chart-dependent finding holds: a 2P side, a generated charge note and a changing BPM. */
const EVERY_CASE_CHART = {
  notes: [{ channel: '21', generatedLongNote: true, lnMode: 2 }],
  bpmRange: { min: 1, max: 2 },
} as unknown as AssistReplay['chart'];

/** A chart on which none does: no 2P side, no generated note, one BPM. */
const NO_CASE_CHART = { notes: [], bpmRange: { min: 1, max: 1 } } as unknown as AssistReplay['chart'];

function planAsReplay(plan: PlannedPlay, everyCase: boolean): AssistReplay {
  const { extraNotes, sevenToNine, ...recorded } = plan;
  const count = everyCase ? 1 : 0;
  return {
    play: {
      ...recorded,
      mineModifierChangeCount: count,
      longNoteModifierChangeCount: count,
      scrollModifierChanged: everyCase,
      extraNoteChangeCount: extraNotes === true ? count : 0,
      sevenToNineApplied: sevenToNine === true && everyCase,
    } as BeMusicReplay['play'],
    chart: everyCase ? EVERY_CASE_CHART : NO_CASE_CHART,
  };
}

/** The assist findings of a planned play: the certain ones, and the ones that depend on the chart. */
export function classifyPlannedAssists(
  plan: PlannedPlay,
): Pick<PlannedRecordPolicy, 'findings' | 'conditionalFindings'> {
  const findings = classifyReplayAssists(planAsReplay(plan, false));
  const every = classifyReplayAssists(planAsReplay(plan, true));
  return {
    findings,
    conditionalFindings: every.filter((finding) => !findings.some((known) => known.option === finding.option)),
  };
}

/**
 * What a planned play does to its record under `ruleset` (the plan's judge ruleset by default), from the resolver a
 * finished play's record goes through ({@link resolveRecordPolicy}).
 */
export function resolvePlannedRecordPolicy(plan: PlannedPlay, ruleset?: RulesetId): PlannedRecordPolicy {
  const judged = ruleset ?? plan.judgeRuleset ?? 'lr2';
  const { findings, conditionalFindings } = classifyPlannedAssists(plan);
  return {
    findings,
    conditionalFindings,
    policy: resolveRecordPolicy(findings, judged),
    conditionalPolicy: resolveRecordPolicy([...findings, ...conditionalFindings], judged),
  };
}
