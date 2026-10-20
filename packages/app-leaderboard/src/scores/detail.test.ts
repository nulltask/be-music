import type { RulesetId } from '@be-music/player-engine/ruleset';
import { describe, expect, test } from 'vite-plus/test';
import { toScoreResponse, type ScoreDetail } from './detail.ts';

const result = (ruleset: RulesetId) => ({
  scoreId: 's1',
  ruleset,
  rulesetRevision: `${ruleset}/0`,
  exScore: 18,
  noteCount: 10,
  clearLamp: 4,
  missCount: 1,
  maxCombo: 9,
  gaugeType: 'GROOVE',
  gaugeFinal: 80,
  judges: { pgreat: 9 },
});

const detail = (player: ScoreDetail['player']) =>
  ({
    score: {
      id: 's1',
      chartFingerprint: 'bmfp0:c',
      playFingerprint: 'bmfp0:p',
      playedRuleset: 'lr2',
      gauge: 'GROOVE',
      assisted: false,
      assistFlags: [],
      verification: 'L4',
      createdAt: new Date(Date.UTC(2026, 9, 13)),
    },
    chart: {},
    player,
    results: [result('lr2'), result('iidx')],
  }) as unknown as ScoreDetail;

describe('toScoreResponse', () => {
  test('answers the play, its player and its figures without internal keys', () => {
    const response = toScoreResponse(detail({ handle: 'h', displayName: 'D', anonymous: true, avatarKey: null }));
    expect(response).toMatchObject({
      id: 's1',
      player: { handle: 'h', displayName: 'D' },
      createdAt: Date.UTC(2026, 9, 13),
    });
    expect(response.player).not.toHaveProperty('anonymous');
    expect(response.player).not.toHaveProperty('avatarKey');
    expect(response.results.map((entry) => entry.ruleset)).toEqual(['lr2', 'iidx']);
    expect(response.results[0]).not.toHaveProperty('scoreId');
  });

  test('answers a null player when the profile is gone', () => {
    expect(toScoreResponse(detail(null)).player).toBeNull();
  });
});
