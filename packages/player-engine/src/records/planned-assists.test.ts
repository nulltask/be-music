import { describe, expect, test } from 'vite-plus/test';
import type { RulesetId } from '../ruleset/definitions.ts';
import { classifyPlannedAssists, resolvePlannedRecordPolicy, type PlannedPlay } from './planned-assists.ts';

const RULESETS: readonly RulesetId[] = ['lr2', 'beatoraja', '____'];
const options = (plan: PlannedPlay) => classifyPlannedAssists(plan).findings.map((finding) => finding.option);
const conditional = (plan: PlannedPlay) =>
  classifyPlannedAssists(plan).conditionalFindings.map((finding) => finding.option);

describe('classifyPlannedAssists', () => {
  test('a plan without assisted options has no finding, certain or conditional', () => {
    expect(classifyPlannedAssists({})).toEqual({ findings: [], conditionalFindings: [] });
    expect(classifyPlannedAssists({ randomLane: { p1: 'RANDOM', p2: 'MIRROR' }, longNoteModifier: 'OFF' })).toEqual({
      findings: [],
      conditionalFindings: [],
    });
  });

  test('an option that assists any chart is certain', () => {
    expect(options({ autoScratch1P: true })).toEqual(['auto-scratch']);
    expect(options({ anyKey: true })).toEqual(['any-key']);
    expect(options({ randomLane: { p1: 'H-RANDOM' } })).toEqual(['H-RANDOM']);
    expect(options({ options: { hsFix: 'CONSTANT' } })).toEqual(['hs-fix-constant']);
    expect(options({ options: { practice: true } })).toEqual(['practice']);
    expect(options({ lr2Mania: { addNotes: 10, loudness: 0, addLongNotes: 0, addMines: 30 } as never })).toEqual([
      'lr2-add-notes',
      'lr2-add-mines',
    ]);
    expect(options({ lr2ExtraMode: true, battleMode: 'D-BATTLE' as never })).toEqual(['D-BATTLE', 'lr2-extra-mode']);
  });

  test('an option that assists only a chart it changes is conditional', () => {
    expect(classifyPlannedAssists({ options: { bpmGuide: true } })).toMatchObject({
      findings: [],
      conditionalFindings: [{ option: 'bpm-guide', assistClass: 'light' }],
    });
    expect(conditional({ mineModifier: 'REMOVE' as never })).toEqual(['mine-remove']);
    expect(conditional({ scrollModifier: 'REMOVE' as never })).toEqual(['scroll-remove']);
    expect(conditional({ longNoteModifier: 'LEGACY' as never })).toEqual(['long-note:LEGACY']);
    expect(conditional({ longNoteModifier: 'REMOVE' as never })).toEqual(['long-note:REMOVE']);
    expect(conditional({ longNoteModifier: 'ADD_CN' as never })).toEqual(['long-note:ADD_CN']);
    // ADD LN is never an assist.
    expect(conditional({ longNoteModifier: 'ADD_LN' as never })).toEqual([]);
    expect(conditional({ extraNotes: true })).toEqual(['extra-notes']);
    expect(conditional({ sevenToNine: true })).toEqual(['seven-to-nine']);
    // The 2P side: its AUTO SCRATCH and a beatoraja lane option count on a chart with one; LR2's lane option always.
    expect(conditional({ autoScratch2P: true })).toEqual(['auto-scratch']);
    expect(conditional({ randomLane: { p2: 'H-RANDOM' } })).toEqual(['H-RANDOM']);
    expect(options({ randomLane: { p2: 'SCATTER' } })).toEqual(['SCATTER']);
  });

  test('a conditional finding is not repeated when it is already certain', () => {
    expect(classifyPlannedAssists({ autoScratch1P: true, autoScratch2P: true })).toMatchObject({
      findings: [{ option: 'auto-scratch' }],
      conditionalFindings: [],
    });
  });
});

describe('resolvePlannedRecordPolicy', () => {
  test.each(RULESETS)('an unassisted plan keeps the whole record under %s', (ruleset) => {
    const planned = resolvePlannedRecordPolicy({ judgeRuleset: ruleset });
    expect(planned.policy).toMatchObject({ ruleset, assistClass: 'none', updatesScore: true, leaderboard: 'main' });
    expect(planned.conditionalPolicy).toEqual(planned.policy);
  });

  test.each(RULESETS)('a light assist keeps the lamp and play count only under %s', (ruleset) => {
    const { policy } = resolvePlannedRecordPolicy({ judgeRuleset: ruleset, autoScratch1P: true });
    expect(policy).toMatchObject({ assistClass: 'light', keepsRecord: true, updatesScore: false });
    expect(policy.leaderboard).toBe('assisted');
    expect(policy.lamp).toEqual(
      ruleset === 'lr2'
        ? { rule: 'cap', lamp: 'EASY' }
        : { rule: 'replace', lamp: ruleset === 'beatoraja' ? 'LIGHT_ASSIST_EASY' : 'ASSIST_EASY' },
    );
  });

  test.each(RULESETS)('a no-save option keeps nothing under %s', (ruleset) => {
    const { policy } = resolvePlannedRecordPolicy({ judgeRuleset: ruleset, options: { practice: true } });
    expect(policy).toMatchObject({ assistClass: 'no-save', keepsRecord: false, leaderboard: 'unranked' });
  });

  test('BATTLE follows the judge ruleset: no record under ____, a light assist under beatoraja', () => {
    expect(resolvePlannedRecordPolicy({ judgeRuleset: '____', battleMode: 'BATTLE' as never }).policy.assistClass).toBe(
      'no-save',
    );
    expect(
      resolvePlannedRecordPolicy({ judgeRuleset: 'beatoraja', battleMode: 'BATTLE' as never }).policy.assistClass,
    ).toBe('light');
  });

  test('a conditional option leaves the certain policy alone and shows in the conditional one', () => {
    const planned = resolvePlannedRecordPolicy({ judgeRuleset: 'beatoraja', longNoteModifier: 'REMOVE' as never });
    expect(planned.policy.assistClass).toBe('none');
    expect(planned.conditionalPolicy).toMatchObject({
      assistClass: 'assist',
      lamp: { rule: 'replace', lamp: 'ASSIST_EASY' },
    });
    // The ruleset can be named apart from the plan's.
    expect(resolvePlannedRecordPolicy({ options: { bpmGuide: true } }, 'lr2').conditionalPolicy.lamp).toEqual({
      rule: 'cap',
      lamp: 'EASY',
    });
  });
});
