import { describe, expect, test } from 'vite-plus/test';
import type { BeMusicReplay, ReplayNote } from '../replay/format.ts';
import { DEFAULT_BEATORAJA_CUSTOM_JUDGE } from '../ruleset/custom-judge.ts';
import type { RulesetId } from '../ruleset/definitions.ts';
import {
  ASSIST_CLASSES,
  applyRecordPolicyLamp,
  classifyReplayAssists,
  resolveAssistClass,
  resolveRecordPolicy,
  resolveReplayRecordPolicy,
  type AssistFinding,
  type AssistReplay,
} from './assist-policy.ts';

const note = (channel: string, extra: Partial<ReplayNote> = {}): ReplayNote => ({
  id: 0,
  channel,
  type: 'normal',
  timeUs: 0,
  ...extra,
});

function replay(play: Partial<BeMusicReplay['play']> = {}, chart: Partial<AssistReplay['chart']> = {}): AssistReplay {
  return {
    chart: { notes: [note('11'), note('16')], ...chart },
    play: { mode: 'manual', autoScratch: false, gauge: 'GROOVE', ...play },
  };
}

const classOf = (play: Partial<BeMusicReplay['play']>, chart: Partial<AssistReplay['chart']> = {}) =>
  resolveAssistClass(classifyReplayAssists(replay(play, chart)));

describe('classifyReplayAssists', () => {
  test('finds nothing in a play without assisted options', () => {
    expect(classifyReplayAssists(replay())).toEqual([]);
    expect(classOf({ randomLane: { p1: 'RANDOM', p2: 'MIRROR' }, dpFlip: true })).toBe('none');
    // R-RANDOM (beatoraja ROTATE), SYNCHRONIZE / SYMMETRY RANDOM and M-RAN set no assist in their sources.
    expect(classOf({ randomLane: { p1: 'R-RANDOM' } })).toBe('none');
    expect(classOf({ randomLane: { p1: 'SYNCHRONIZE-RANDOM' } })).toBe('none');
  });

  // Each option, classified by the rules of the source it comes from.
  test.each<[string, Partial<BeMusicReplay['play']>, Partial<AssistReplay['chart']>, string, string, string]>([
    ['LR2 AUTO SCRATCH', { autoScratch1P: true, judgeRuleset: 'lr2' }, {}, 'auto-scratch', 'lr2', 'light'],
    ['AC AUTO SCRATCH', { autoScratch1P: true, judgeRuleset: '____' }, {}, 'auto-scratch', '____', 'light'],
    [
      'AUTO SCRATCH under beatoraja',
      { autoScratch1P: true, judgeRuleset: 'beatoraja' },
      {},
      'auto-scratch',
      'lr2',
      'light',
    ],
    ['legacy combined AUTO SCRATCH', { autoScratch: true }, {}, 'auto-scratch', 'lr2', 'light'],
    ['HS-FIX CONSTANT', { view: { hsFix: 'CONSTANT' } }, {}, 'hs-fix-constant', 'lr2', 'light'],
    [
      'HS-FIX CONSTANT changed to',
      { viewChanges: [{ timeUs: 1, hsFix: 'CONSTANT' }] },
      {},
      'hs-fix-constant',
      'lr2',
      'light',
    ],
    ['SCATTER', { randomLane: { p1: 'SCATTER' } }, {}, 'SCATTER', 'lr2', 'light'],
    ['SCATTER (9KEY corrected)', { randomLane: { p2: 'SCATTER-CORRECTED' } }, {}, 'SCATTER-CORRECTED', 'lr2', 'light'],
    ['LR2 CONVERGE', { randomLane: { p1: 'CONVERGE' }, judgeRuleset: 'lr2' }, {}, 'CONVERGE', 'lr2', 'light'],
    [
      'beatoraja CONVERGE',
      { randomLane: { p1: 'CONVERGE' }, judgeRuleset: 'beatoraja' },
      {},
      'CONVERGE',
      'beatoraja',
      'light',
    ],
    [
      'qualified CONVERGE',
      { randomLane: { p1: 'beatoraja:CONVERGE' }, judgeRuleset: 'lr2' },
      {},
      'CONVERGE',
      'beatoraja',
      'light',
    ],
    ['D-BATTLE', { battleMode: 'D-BATTLE' }, {}, 'D-BATTLE', 'lr2', 'light'],
    ['SP TO DP', { battleMode: 'SP-TO-DP' }, {}, 'SP-TO-DP', 'lr2', 'light'],
    ['LR2 EXTRA MODE', { lr2ExtraMode: true }, {}, 'lr2-extra-mode', 'lr2', 'light'],
    ['SPIRAL', { randomLane: { p1: 'SPIRAL' } }, {}, 'SPIRAL', 'beatoraja', 'light'],
    ['H-RANDOM', { randomLane: { p1: 'H-RANDOM' } }, {}, 'H-RANDOM', 'beatoraja', 'light'],
    ['ALL-SCR', { randomLane: { p1: 'ALL-SCR' } }, {}, 'ALL-SCR', 'beatoraja', 'light'],
    ['RANDOM-EX', { randomLane: { p1: 'RANDOM-EX' } }, {}, 'RANDOM-EX', 'beatoraja', 'light'],
    ['S-RANDOM-EX', { randomLane: { p2: 'S-RANDOM-EX' } }, {}, 'S-RANDOM-EX', 'beatoraja', 'light'],
    ['RANDOM_PLAYABLE', { randomLane: { p1: 'RANDOM_PLAYABLE' } }, {}, 'RANDOM_PLAYABLE', 'beatoraja', 'light'],
    ['S_RANDOM_PLAYABLE', { randomLane: { p1: 'S_RANDOM_PLAYABLE' } }, {}, 'S_RANDOM_PLAYABLE', 'beatoraja', 'light'],
    ['beatoraja BATTLE', { battleMode: 'BATTLE', judgeRuleset: 'beatoraja' }, {}, 'BATTLE', 'beatoraja', 'light'],
    ['AC BATTLE', { battleMode: 'BATTLE', judgeRuleset: '____' }, {}, 'BATTLE', '____', 'no-save'],
    ['BATTLE AS', { battleMode: 'BATTLE-AS' }, {}, 'BATTLE-AS', 'beatoraja', 'light'],
    ['7 TO 9', { sevenToNineApplied: true }, {}, 'seven-to-nine', 'beatoraja', 'light'],
    [
      'BPM GUIDE on a BPM-changing chart',
      { options: { bpmGuide: true } },
      { bpmRange: { min: 120, max: 180 } },
      'bpm-guide',
      'beatoraja',
      'light',
    ],
    [
      'mine REMOVE that removed mines',
      { mineModifier: 'REMOVE', mineModifierChangeCount: 3 },
      {},
      'mine-remove',
      'beatoraja',
      'light',
    ],
    [
      'scroll REMOVE that changed the chart',
      { scrollModifier: 'REMOVE', scrollModifierChanged: true },
      {},
      'scroll-remove',
      'beatoraja',
      'light',
    ],
    ['LEGACY NOTE', { longNoteModifier: 'LEGACY' }, {}, 'long-note:LEGACY', '____', 'light'],
    [
      'LN REMOVE that removed notes',
      { longNoteModifier: 'REMOVE', longNoteModifierChangeCount: 2 },
      {},
      'long-note:REMOVE',
      'beatoraja',
      'assist',
    ],
    [
      'ADD CN that added charge notes',
      { longNoteModifier: 'ADD_CN', longNoteModifierChangeCount: 1 },
      { notes: [note('11', { type: 'long', generatedLongNote: true, lnMode: 2 })] },
      'long-note:ADD_CN',
      'beatoraja',
      'assist',
    ],
    [
      'EXTRA notes that converted notes',
      { extraNoteDepth: 1, extraNoteChangeCount: 4 },
      {},
      'extra-notes',
      'beatoraja',
      'assist',
    ],
    [
      'CUSTOM JUDGE over 100 %',
      { customJudge: DEFAULT_BEATORAJA_CUSTOM_JUDGE },
      {},
      'custom-judge',
      'beatoraja',
      'assist',
    ],
    [
      'the debug judge-window override',
      { judgeWindowOverrideMs: 200 },
      {},
      'judge-window-override',
      'be-music',
      'assist',
    ],
    [
      'beatoraja PRACTICE',
      { options: { practice: true }, judgeRuleset: 'beatoraja' },
      {},
      'practice',
      'beatoraja',
      'no-save',
    ],
  ])('classifies %s', (_name, play, chart, option, source, assistClass) => {
    expect(classifyReplayAssists(replay(play, chart))).toContainEqual(
      expect.objectContaining({ option, source, assistClass }),
    );
  });

  test("marks LR2's separate-lamp modes with their slot", () => {
    expect(classifyReplayAssists(replay({ battleMode: 'D-BATTLE' }))[0]?.lr2Slot).toBe('d-battle');
    expect(classifyReplayAssists(replay({ battleMode: 'SP-TO-DP' }))[0]?.lr2Slot).toBe('sp-to-dp');
    expect(classifyReplayAssists(replay({ lr2ExtraMode: true }))[0]?.lr2Slot).toBe('extra');
  });

  test("classifies beatoraja's chart-dependent options only when they changed the chart", () => {
    // BPM GUIDE on a chart without BPM changes, or without the recorded BPM range.
    expect(classOf({ options: { bpmGuide: true } }, { bpmRange: { min: 150, max: 150 } })).toBe('none');
    expect(classOf({ options: { bpmGuide: true } })).toBe('none');
    // REMOVE with nothing to remove.
    expect(classOf({ mineModifier: 'REMOVE', mineModifierChangeCount: 0 })).toBe('none');
    expect(classOf({ scrollModifier: 'REMOVE', scrollModifierChanged: false })).toBe('none');
    expect(classOf({ longNoteModifier: 'REMOVE', longNoteModifierChangeCount: 0 })).toBe('none');
    // Additions that set no assist flag in beatoraja: mines, scroll changes, plain LN.
    expect(classOf({ mineModifier: 'ADD_RANDOM', mineModifierChangeCount: 9 })).toBe('none');
    expect(classOf({ scrollModifier: 'ADD', scrollModifierChanged: true })).toBe('none');
    expect(
      classOf(
        { longNoteModifier: 'ADD_ALL', longNoteModifierChangeCount: 1 },
        { notes: [note('11', { type: 'long', generatedLongNote: true, lnMode: 1 })] },
      ),
    ).toBe('none');
    expect(classOf({ extraNoteDepth: 2, extraNoteChangeCount: 0 })).toBe('none');
    // CUSTOM JUDGE that only narrows the windows.
    expect(
      classOf({
        customJudge: {
          keyPerfectGreat: 100,
          keyGreat: 50,
          keyGood: 100,
          scratchPerfectGreat: 100,
          scratchGreat: 100,
          scratchGood: 100,
          longNoteMargin: 100,
        },
      }),
    ).toBe('none');
    // beatoraja's visual CONSTANT is not LR2's HS-FIX CONSTANT.
    expect(classOf({ options: { visualConstant: true } })).toBe('none');
  });

  test('counts the 2P AUTO SCRATCH only on a chart with a 2P side', () => {
    expect(classOf({ autoScratch1P: false, autoScratch2P: true })).toBe('none');
    expect(classOf({ autoScratch1P: false, autoScratch2P: true }, { notes: [note('11'), note('26')] })).toBe('light');
  });
});

describe('resolveAssistClass', () => {
  test('takes the highest class of the options', () => {
    expect(ASSIST_CLASSES).toEqual(['none', 'light', 'assist', 'no-save']);
    expect(resolveAssistClass([])).toBe('none');
    expect(classOf({ randomLane: { p1: 'H-RANDOM' }, judgeWindowOverrideMs: 100 })).toBe('assist');
    expect(classOf({ battleMode: 'BATTLE', judgeRuleset: '____', customJudge: DEFAULT_BEATORAJA_CUSTOM_JUDGE })).toBe(
      'no-save',
    );
    expect(resolveAssistClass([{ assistClass: 'none' }, { assistClass: 'light' }])).toBe('light');
  });
});

const light: AssistFinding = { option: 'H-RANDOM', source: 'beatoraja', assistClass: 'light' };
const assist: AssistFinding = { option: 'custom-judge', source: 'beatoraja', assistClass: 'assist' };
const noSave: AssistFinding = { option: 'BATTLE', source: '____', assistClass: 'no-save' };
const autoScratch: AssistFinding = { option: 'auto-scratch', source: 'lr2', assistClass: 'light' };
const dBattle: AssistFinding = { option: 'D-BATTLE', source: 'lr2', assistClass: 'light', lr2Slot: 'd-battle' };
const scatter: AssistFinding = { option: 'SCATTER', source: 'lr2', assistClass: 'light' };

describe('resolveRecordPolicy', () => {
  test.each<RulesetId>(['lr2', 'beatoraja', '____'])('keeps an unassisted play whole under %s', (ruleset) => {
    expect(resolveRecordPolicy([], ruleset)).toEqual({
      ruleset,
      assistClass: 'none',
      keepsRecord: true,
      updatesScore: true,
      recordSlot: 'main',
      keepsCourseRecord: true,
      leaderboard: 'main',
      keepsReplay: true,
    });
  });

  test.each<RulesetId>(['lr2', 'beatoraja', '____'])('keeps nothing from a no-save play under %s', (ruleset) => {
    expect(resolveRecordPolicy([light, noSave], ruleset)).toMatchObject({
      assistClass: 'no-save',
      keepsRecord: false,
      updatesScore: false,
      keepsCourseRecord: false,
      leaderboard: 'unranked',
      keepsReplay: true,
    });
  });

  // Each ruleset's consequence of an assisted play: lamp only, the lamp limited by that ruleset's rule.
  test.each<[RulesetId, AssistFinding[], object]>([
    ['lr2', [light], { lamp: { rule: 'cap', lamp: 'EASY' } }],
    ['lr2', [assist], { lamp: { rule: 'cap', lamp: 'EASY' } }],
    ['beatoraja', [light], { lamp: { rule: 'replace', lamp: 'LIGHT_ASSIST_EASY' } }],
    ['beatoraja', [light, assist], { lamp: { rule: 'replace', lamp: 'ASSIST_EASY' } }],
    ['____', [light], { lamp: { rule: 'replace', lamp: 'ASSIST_EASY' } }],
    ['____', [assist], { lamp: { rule: 'replace', lamp: 'ASSIST_EASY' } }],
  ])('limits an assisted play under %s', (ruleset, findings, expected) => {
    expect(resolveRecordPolicy(findings, ruleset)).toMatchObject({
      ...expected,
      keepsRecord: true,
      updatesScore: false,
      recordSlot: 'main',
      keepsCourseRecord: false,
      leaderboard: 'assisted',
    });
  });

  test("keeps LR2's separate-lamp modes in their own slot, capped at EASY only with another assist", () => {
    expect(resolveRecordPolicy([dBattle], 'lr2')).toMatchObject({ recordSlot: 'd-battle', updatesScore: false });
    expect(resolveRecordPolicy([dBattle], 'lr2').lamp).toBeUndefined();
    // LR2's isForceEasy exempts AUTO SCRATCH on D-BATTLE, not SCATTER.
    expect(resolveRecordPolicy([dBattle, autoScratch], 'lr2').lamp).toBeUndefined();
    expect(resolveRecordPolicy([dBattle, scatter], 'lr2').lamp).toEqual({ rule: 'cap', lamp: 'EASY' });
    // Other rulesets have no separate lamp: the mode is a light assist there.
    expect(resolveRecordPolicy([dBattle], 'beatoraja')).toMatchObject({
      recordSlot: 'main',
      lamp: { rule: 'replace', lamp: 'LIGHT_ASSIST_EASY' },
    });
  });

  test('reads a cross-source play by the option source for the class and the ruleset for the consequence', () => {
    // beatoraja's H-RANDOM under LR2 rules: light, so LR2 caps the lamp at EASY.
    const play = replay({ randomLane: { p1: 'H-RANDOM' }, judgeRuleset: 'lr2' });
    expect(resolveReplayRecordPolicy(play).lamp).toEqual({ rule: 'cap', lamp: 'EASY' });
    expect(resolveReplayRecordPolicy(play, 'beatoraja').lamp).toEqual({ rule: 'replace', lamp: 'LIGHT_ASSIST_EASY' });
    expect(resolveReplayRecordPolicy(play, '____').lamp).toEqual({ rule: 'replace', lamp: 'ASSIST_EASY' });
  });
});

describe('applyRecordPolicyLamp', () => {
  test('caps or replaces a clear and leaves a failed play alone', () => {
    const cap = { lamp: { rule: 'cap', lamp: 'EASY' } } as const;
    const replace = { lamp: { rule: 'replace', lamp: 'LIGHT_ASSIST_EASY' } } as const;
    expect(applyRecordPolicyLamp('FULL_COMBO', cap)).toBe('EASY');
    expect(applyRecordPolicyLamp('HARD', cap)).toBe('EASY');
    expect(applyRecordPolicyLamp('EASY', cap)).toBe('EASY');
    expect(applyRecordPolicyLamp('ASSIST_EASY', cap)).toBe('ASSIST_EASY');
    expect(applyRecordPolicyLamp('FAILED', cap)).toBe('FAILED');
    expect(applyRecordPolicyLamp('MAX', replace)).toBe('LIGHT_ASSIST_EASY');
    expect(applyRecordPolicyLamp('EASY', replace)).toBe('LIGHT_ASSIST_EASY');
    expect(applyRecordPolicyLamp('FAILED', replace)).toBe('FAILED');
    expect(applyRecordPolicyLamp('NO_PLAY', replace)).toBe('NO_PLAY');
    expect(applyRecordPolicyLamp('HARD', {})).toBe('HARD');
  });
});
