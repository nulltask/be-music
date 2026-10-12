import { describe, expect, test } from 'vite-plus/test';
import {
  TouchLaneTracker,
  canvasPointToDesign,
  hitTestTouchLane,
  isTouchPlayPointer,
  resolveTouchLaneZones,
} from './touch-lanes.ts';

const lane = (channel: string, x: number, w = 20) => ({ channel, x, w, top: 0, bottom: 400 });

describe('resolveTouchLaneZones', () => {
  test('covers the lower part of each lane down to the stage bottom', () => {
    const [zone] = resolveTouchLaneZones([lane('11', 100)], { stageHeight: 480 });
    expect(zone).toEqual({ channel: '11', left: 90, right: 130, top: 220, bottom: 480 });
  });

  test('keeps a minimum height on short lanes without reaching above the lane top', () => {
    const short = { channel: '11', x: 0, w: 20, top: 300, bottom: 400 };
    expect(resolveTouchLaneZones([short], { stageHeight: 480, minHeight: 80 })[0]?.top).toBe(320);
    expect(resolveTouchLaneZones([short], { stageHeight: 480, minHeight: 200 })[0]?.top).toBe(300);
  });

  test('splits the gap between neighbouring lanes at its midpoint and sorts left to right', () => {
    const zones = resolveTouchLaneZones([lane('12', 124), lane('11', 100)], { stageHeight: 480 });
    expect(zones.map((zone) => [zone.channel, zone.left, zone.right])).toEqual([
      ['11', 90, 122],
      ['12', 122, 154],
    ]);
  });

  test('splits overlapping lanes at the middle of the overlap', () => {
    const zones = resolveTouchLaneZones([lane('11', 100), lane('12', 110)], { stageHeight: 480 });
    expect(zones[0]?.right).toBe(115);
    expect(zones[1]?.left).toBe(115);
  });

  test('does not join lanes further apart than their width (the two DP sides)', () => {
    const zones = resolveTouchLaneZones([lane('19', 100), lane('21', 300)], { stageHeight: 480, edgePadding: 4 });
    expect(zones.map((zone) => [zone.left, zone.right])).toEqual([
      [96, 124],
      [296, 324],
    ]);
  });

  test('limits the edge padding to half the lane width and skips lanes without width', () => {
    const zones = resolveTouchLaneZones([lane('11', 100, 10), lane('12', 200, 0)], { stageHeight: 480 });
    expect(zones).toHaveLength(1);
    expect([zones[0]?.left, zones[0]?.right]).toEqual([95, 115]);
  });
});

describe('hitTestTouchLane', () => {
  const zones = resolveTouchLaneZones([lane('11', 100), lane('12', 124)], { stageHeight: 480 });

  test('finds the zone under the point, including below the judgement line', () => {
    expect(hitTestTouchLane(zones, 110, 300)).toBe('11');
    expect(hitTestTouchLane(zones, 122, 470)).toBe('12');
  });

  test('misses above the zones, past their sides, and off the stage bottom', () => {
    expect(hitTestTouchLane(zones, 110, 100)).toBeUndefined();
    expect(hitTestTouchLane(zones, 60, 300)).toBeUndefined();
    expect(hitTestTouchLane(zones, 110, 480)).toBeUndefined();
  });
});

describe('TouchLaneTracker', () => {
  test('presses on touch down and releases on lift', () => {
    const tracker = new TouchLaneTracker();
    expect(tracker.down(1, '11')).toEqual({ pressed: ['11'], released: [] });
    expect(tracker.heldLanes()).toEqual(['11']);
    expect(tracker.up(1)).toEqual({ pressed: [], released: ['11'] });
    expect(tracker.heldLanes()).toEqual([]);
  });

  test('keeps a lane held while the finger moves inside it', () => {
    const tracker = new TouchLaneTracker();
    tracker.down(1, '11');
    expect(tracker.move(1, '11')).toEqual({ pressed: [], released: [] });
  });

  test('sliding into another lane releases the old lane and presses the new one', () => {
    const tracker = new TouchLaneTracker();
    tracker.down(1, '11');
    expect(tracker.move(1, '12')).toEqual({ pressed: ['12'], released: ['11'] });
    expect(tracker.move(1, undefined)).toEqual({ pressed: [], released: ['12'] });
    expect(tracker.up(1)).toEqual({ pressed: [], released: [] });
  });

  test('a finger that lands outside every lane presses the lane it slides into', () => {
    const tracker = new TouchLaneTracker();
    expect(tracker.down(1, undefined)).toEqual({ pressed: [], released: [] });
    expect(tracker.isTracking(1)).toBe(true);
    expect(tracker.move(1, '13')).toEqual({ pressed: ['13'], released: [] });
  });

  test('tracks fingers independently and holds a shared lane until its last finger leaves', () => {
    const tracker = new TouchLaneTracker();
    expect(tracker.down(1, '11').pressed).toEqual(['11']);
    expect(tracker.down(2, '13').pressed).toEqual(['13']);
    expect(tracker.down(3, '11')).toEqual({ pressed: [], released: [] });
    expect(tracker.up(1)).toEqual({ pressed: [], released: [] });
    expect(tracker.up(3)).toEqual({ pressed: [], released: ['11'] });
    expect(tracker.heldLanes()).toEqual(['13']);
  });

  test('ignores moves and lifts of pointers it does not follow', () => {
    const tracker = new TouchLaneTracker();
    expect(tracker.move(9, '11')).toEqual({ pressed: [], released: [] });
    expect(tracker.up(9)).toEqual({ pressed: [], released: [] });
    expect(tracker.isTracking(9)).toBe(false);
  });

  test('upAll releases every held lane once', () => {
    const tracker = new TouchLaneTracker();
    tracker.down(1, '11');
    tracker.down(2, '11');
    tracker.down(3, '16');
    expect(tracker.upAll().released).toEqual(['11', '16']);
    expect(tracker.upAll().released).toEqual([]);
    expect(tracker.isTracking(1)).toBe(false);
  });
});

describe('isTouchPlayPointer', () => {
  test('accepts touch and pen, not mouse', () => {
    expect(isTouchPlayPointer('touch')).toBe(true);
    expect(isTouchPlayPointer('pen')).toBe(true);
    expect(isTouchPlayPointer('mouse')).toBe(false);
  });
});

describe('canvasPointToDesign', () => {
  test('undoes the letterbox offset and scale', () => {
    expect(canvasPointToDesign(95, 40, { x: 75, y: 0, scale: 0.5 })).toEqual({ x: 40, y: 80 });
  });
});
