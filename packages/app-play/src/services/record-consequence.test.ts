import { describe, expect, test } from 'vite-plus/test';
import { DEFAULT_PLAY_OPTIONS } from '@be-music/player-scene-model';
import {
  describeRecordConsequence,
  describeResultRecord,
  plannedPlayOf,
  type RecordConsequenceState,
} from './record-consequence.ts';

const state = (changes: Partial<RecordConsequenceState> = {}): RecordConsequenceState => ({
  ...DEFAULT_PLAY_OPTIONS,
  judgeRuleset: 'lr2',
  anyKey: false,
  ...changes,
});

describe('plannedPlayOf', () => {
  test('takes each option as a play takes it', () => {
    expect(plannedPlayOf(state({ anyKey: true })).anyKey).toBe(false);
    expect(plannedPlayOf(state({ anyKey: true, judgeRuleset: '____' })).anyKey).toBe(true);
    expect(plannedPlayOf(state({ customJudge: true })).customJudge).toBeUndefined();
    expect(plannedPlayOf(state({ customJudge: true, judgeRuleset: 'beatoraja' })).customJudge).toBeDefined();
    // HS-FIX is off while a hi-speed mode of its own scrolls the notes.
    expect(plannedPlayOf(state({ hsFix: 'CONSTANT' })).options?.hsFix).toBe('CONSTANT');
    expect(plannedPlayOf(state({ hsFix: 'CONSTANT', floatingHiSpeed: true })).options?.hsFix).toBe('OFF');
    expect(plannedPlayOf(state({ extraNoteDepth: 2, sevenToNinePattern: 3 }))).toMatchObject({
      extraNotes: true,
      sevenToNine: true,
    });
  });
});

describe('describeRecordConsequence', () => {
  test('the default options keep the whole record under every ruleset', () => {
    for (const judgeRuleset of ['lr2', 'beatoraja', '____'] as const)
      expect(describeRecordConsequence(state({ judgeRuleset }))).toBe(
        'Record: score, lamp and play count are saved · Leaderboard: main board',
      );
  });

  test('an assisted option names its class, its lamp under the ruleset and its board', () => {
    expect(describeRecordConsequence(state({ autoScratch1P: true }))).toBe(
      'LIGHT ASSIST (AUTO SCRATCH): lamp up to EASY and play count only, no score · Leaderboard: assisted board',
    );
    expect(describeRecordConsequence(state({ autoScratch1P: true, judgeRuleset: 'beatoraja' }))).toBe(
      'LIGHT ASSIST (AUTO SCRATCH): LIGHT ASSIST EASY lamp and play count only, no score · Leaderboard: assisted board',
    );
    expect(describeRecordConsequence(state({ random1P: 'H-RANDOM', judgeRuleset: '____' }))).toContain(
      'LIGHT ASSIST (H-RANDOM): ASSIST EASY lamp',
    );
    // LR2's separate lamps keep the lamp apart, uncapped without another assist.
    expect(describeRecordConsequence(state({ lr2ExtraMode: true }))).toBe(
      'LIGHT ASSIST (EXTRA MODE): lamp (kept apart as EXTRA MODE) and play count only, no score · Leaderboard: assisted board',
    );
  });

  test('an option that saves nothing says so', () => {
    expect(describeRecordConsequence(state({ practice: true }))).toBe(
      'Not saved (PRACTICE): no record · Leaderboard: stored, not ranked',
    );
    expect(describeRecordConsequence(state({ lr2AddNotes: 10 }))).toContain('Not saved (ADD NOTES)');
    expect(describeRecordConsequence(state({ autoPlay: true }))).toBe(
      'AUTO PLAY: no record, and nothing is sent to the Leaderboard',
    );
  });

  test('a chart-dependent option is worded as conditional after what holds on any chart', () => {
    expect(describeRecordConsequence(state({ bpmGuide: true, judgeRuleset: 'beatoraja' }))).toBe(
      'Record: score, lamp and play count are saved · Leaderboard: main board — on a chart BPM GUIDE changes: ' +
        'LIGHT ASSIST (BPM GUIDE): LIGHT ASSIST EASY lamp and play count only, no score · Leaderboard: assisted board',
    );
    expect(describeRecordConsequence(state({ autoScratch1P: true, longNoteModifier: 'REMOVE' }))).toContain(
      '— on a chart LN REMOVE changes: ASSIST (AUTO SCRATCH, LN REMOVE): lamp up to EASY',
    );
  });
});

describe('describeResultRecord', () => {
  test('a play that is no record says why, and a replay’s result says nothing', () => {
    expect(describeResultRecord({ fromReplay: true }, false)).toBeUndefined();
    expect(describeResultRecord({ autoPlay: true }, false)).toContain('AUTO PLAY');
    expect(describeResultRecord({ practice: true }, false)).toContain('Not saved (PRACTICE)');
    expect(describeResultRecord({ secondPlayer: {} as never }, false)).toContain('Two-player BATTLE');
    expect(describeResultRecord({}, true)).toBeUndefined();
  });
});
