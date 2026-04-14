import { describe, expect, test } from 'vitest';
import { createPixiLaneMetrics, resolveVisualLaneChannels } from './pixi-lane-layout.ts';

describe('player-web-core pixi lane layout', () => {
  test('orders SP lanes like beatmania with scratch on the left', () => {
    expect(resolveVisualLaneChannels(['11', '12', '13', '14', '15', '16', '18', '19'])).toEqual([
      '16',
      '11',
      '12',
      '13',
      '14',
      '15',
      '18',
      '19',
    ]);
  });

  test('maps FREE ZONE channels onto the scratch lane', () => {
    expect(resolveVisualLaneChannels(['11', '17'])).toEqual(['16', '11']);
  });

  test('gives scratch lanes more width than regular keys', () => {
    const metrics = createPixiLaneMetrics(['16', '11', '12', '13', '14', '15', '18', '19'], 100, 800, 4, 18);
    expect(metrics[0]?.channel).toBe('16');
    expect(metrics[0]?.width).toBeGreaterThan(metrics[1]?.width ?? 0);
  });
});
