import { createHiSpeedState, createPlayState } from '@be-music/player-scene-model';
import { describe, expect, it } from 'vite-plus/test';
import { PlaySession } from './play-session.ts';
import { adjustHiSpeed } from './play-view-settings.ts';

describe('PlaySession hi-speed under HS-FIX', () => {
  /** A play (not loaded) at the player's hi-speed 3.0 on a chart whose HS-FIX multiplier is 2/3. */
  function hsFixView(onHiSpeedChange: (hiSpeed: number) => void, locked = false) {
    const view = new PlaySession({ initialHiSpeed: 3, onHiSpeedChange });
    // What `prepareChart` leaves once the chart is prepared.
    view.playState = createPlayState({
      view: { hiSpeed: createHiSpeedState({ hiSpeed: 3, multiplier: 2 / 3, locked }) },
    });
    expect(view.playState.view.hiSpeed.drawn).toBe(2);
    return view;
  }

  it('starts at the host-supplied hi-speed, snapped to the grid', () => {
    const view = new PlaySession({ initialHiSpeed: 1.5000000000000002 });
    expect(view.getHiSpeed()).toBe(1.5);
    expect(view.scrollHiSpeed.target).toBe(1.5);
  });

  it("steps the player's hi-speed and reports it, drawing it scaled by HS-FIX", () => {
    const reported: number[] = [];
    const view = hsFixView((hiSpeed) => reported.push(hiSpeed));
    adjustHiSpeed(view, 0.1);
    expect(view.playState.view.hiSpeed.player).toBe(3.1);
    expect(view.playState.view.hiSpeed.drawn).toBe(2.067);
    expect(view.scrollHiSpeed.target).toBe(2.067);
    expect(reported).toEqual([3.1]);
  });

  it("ignores the player's keys while a course locks the hi-speed", () => {
    const reported: number[] = [];
    const view = hsFixView((hiSpeed) => reported.push(hiSpeed), true);
    adjustHiSpeed(view, 0.1);
    expect(view.getHiSpeed()).toBe(3);
    expect(reported).toEqual([]);
  });

  it("takes the host's hi-speed on the player's scale", () => {
    const view = hsFixView(() => undefined);
    view.setHiSpeed(4.5);
    expect(view.getHiSpeed()).toBe(4.5);
    expect(view.playState.view.hiSpeed.drawn).toBe(3);
  });
});
