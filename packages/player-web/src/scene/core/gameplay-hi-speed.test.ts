import { describe, expect, it } from 'vite-plus/test';
import { adjustHiSpeed } from '../../session/play/play-view-settings.ts';
import { CoreGameplayView } from './gameplay.ts';

type HiSpeedInternals = {
  hiSpeed: number;
  playerHiSpeed: number;
  hsFixMultiplier: number;
};

describe('CoreGameplayView hi-speed under HS-FIX', () => {
  /** A view (not mounted) at the player's hi-speed 3.0 on a chart whose HS-FIX multiplier is 2/3. */
  function hsFixView(onHiSpeedChange: (hiSpeed: number) => void) {
    const view = new CoreGameplayView({ initialHiSpeed: 3, onHiSpeedChange });
    const internals = view as unknown as HiSpeedInternals;
    // What `applyHsFix` leaves once the chart is prepared.
    internals.hsFixMultiplier = 2 / 3;
    internals.hiSpeed = 2;
    return { view, internals };
  }

  it("steps the player's hi-speed and reports it, drawing it scaled by HS-FIX", () => {
    const reported: number[] = [];
    const { view, internals } = hsFixView((hiSpeed) => reported.push(hiSpeed));
    adjustHiSpeed.call(view, 0.1);
    expect(internals.playerHiSpeed).toBe(3.1);
    expect(internals.hiSpeed).toBe(2.067);
    expect(reported).toEqual([3.1]);
  });

  it("takes the host's hi-speed on the player's scale", () => {
    const { view, internals } = hsFixView(() => undefined);
    view.setHiSpeed(4.5);
    expect(internals.playerHiSpeed).toBe(4.5);
    expect(internals.hiSpeed).toBe(3);
  });
});
