import { describe, expect, test } from 'vite-plus/test';
import {
  TouchLaneFingers,
  TouchLaneTracker,
  canvasPointToDesign,
  hitTestTouchLane,
  isTouchPlayPointer,
  resolveTouchLaneZones,
  touchLaneIntents,
  type TouchLaneLayout,
  type TouchLanePointer,
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

describe('touchLaneIntents', () => {
  test('lets the lanes go first, then presses, all at the one time', () => {
    expect(touchLaneIntents({ pressed: ['12'], released: ['11'] }, 42)).toEqual([
      { type: 'lane', channel: '11', pressed: false, atMs: 42 },
      { type: 'lane', channel: '12', pressed: true, atMs: 42 },
    ]);
    expect(touchLaneIntents({ pressed: [], released: [] }, 0)).toEqual([]);
  });
});

describe('TouchLaneFingers', () => {
  // Two lanes on a 640x480 stage shown 1:1: their zones run from y 220 down to 480, `11` over x 90..120, `12` 120..150.
  const LAYOUT: TouchLaneLayout = {
    stage: { width: 640, height: 480 },
    screen: { width: 640, height: 480 },
    lanes: [lane('11', 100), lane('12', 120)],
  };
  const layout = () => LAYOUT;
  const pointer = (
    type: string,
    pointerId: number,
    x: number,
    y = 300,
    pointerType = 'touch',
    timeStamp = 1000,
  ): TouchLanePointer => ({ type, pointerId, pointerType, offsetX: x, offsetY: y, timeStamp });
  const press = (channel: string, atMs = 1000) => ({ type: 'lane', channel, pressed: true, atMs });
  const release = (channel: string, atMs = 1000) => ({ type: 'lane', channel, pressed: false, atMs });

  test('a finger touching down presses the lane under it, at its time, and stops the browser default', () => {
    const fingers = new TouchLaneFingers();
    expect(fingers.handle(pointer('pointerdown', 1, 105, 300, 'touch', 1234), layout, 0)).toEqual({
      intents: [press('11', 1234)],
      preventDefault: true,
    });
    expect(fingers.handle(pointer('pointerup', 1, 105, 300, 'touch', 1300), layout, 0)).toEqual({
      intents: [release('11', 1300)],
      preventDefault: false,
    });
  });

  test('a pen plays the lanes too; a mouse does not, and is never laid out', () => {
    const fingers = new TouchLaneFingers();
    expect(fingers.handle(pointer('pointerdown', 1, 125, 300, 'pen'), layout, 0).intents).toEqual([press('12')]);
    let asked = false;
    const result = fingers.handle(
      pointer('pointerdown', 2, 105, 300, 'mouse'),
      () => {
        asked = true;
        return LAYOUT;
      },
      0,
    );
    expect(result).toEqual({ intents: [], preventDefault: false });
    expect(asked).toBe(false);
  });

  test('sliding into the next lane lets the old one go and presses the new one', () => {
    const fingers = new TouchLaneFingers();
    fingers.handle(pointer('pointerdown', 1, 105), layout, 0);
    expect(fingers.handle(pointer('pointermove', 1, 110), layout, 0).intents).toEqual([]);
    expect(fingers.handle(pointer('pointermove', 1, 130), layout, 0)).toEqual({
      intents: [release('11'), press('12')],
      preventDefault: false,
    });
  });

  test('a finger landing off the lanes presses nothing until it slides onto one', () => {
    const fingers = new TouchLaneFingers();
    expect(fingers.handle(pointer('pointerdown', 1, 105, 100), layout, 0)).toEqual({
      intents: [],
      preventDefault: true,
    });
    expect(fingers.handle(pointer('pointermove', 1, 105, 300), layout, 0).intents).toEqual([press('11')]);
  });

  test("a move or a lift of a finger it does not follow does nothing, and a move isn't laid out", () => {
    const fingers = new TouchLaneFingers();
    let asked = false;
    const counting = () => {
      asked = true;
      return LAYOUT;
    };
    expect(fingers.handle(pointer('pointermove', 7, 105), counting, 0).intents).toEqual([]);
    expect(fingers.handle(pointer('pointerup', 7, 105), counting, 0).intents).toEqual([]);
    expect(asked).toBe(false);
  });

  test('a cancelled finger lets its lane go', () => {
    const fingers = new TouchLaneFingers();
    fingers.handle(pointer('pointerdown', 1, 125), layout, 0);
    expect(fingers.handle(pointer('pointercancel', 1, 125), layout, 0).intents).toEqual([release('12')]);
  });

  test('holds a lane two fingers share until the last one lifts', () => {
    const fingers = new TouchLaneFingers();
    expect(fingers.handle(pointer('pointerdown', 1, 105), layout, 0).intents).toEqual([press('11')]);
    expect(fingers.handle(pointer('pointerdown', 2, 112), layout, 0).intents).toEqual([]);
    expect(fingers.handle(pointer('pointerup', 1, 105), layout, 0).intents).toEqual([]);
    expect(fingers.handle(pointer('pointerup', 2, 112), layout, 0).intents).toEqual([release('11')]);
  });

  test('forgets the fingers down when the play lifted them all, until they touch down again', () => {
    const fingers = new TouchLaneFingers();
    fingers.handle(pointer('pointerdown', 1, 105), layout, 0);
    // The play paused: it let the lane go itself and counted the lift.
    expect(fingers.handle(pointer('pointermove', 1, 130), layout, 1).intents).toEqual([]);
    expect(fingers.handle(pointer('pointerup', 1, 130), layout, 1).intents).toEqual([]);
    expect(fingers.handle(pointer('pointerdown', 1, 130), layout, 1).intents).toEqual([press('12')]);
    // The same count again lifts nothing.
    expect(fingers.handle(pointer('pointerup', 1, 130), layout, 1).intents).toEqual([release('12')]);
  });

  test('reset forgets every finger without letting a lane go', () => {
    const fingers = new TouchLaneFingers();
    fingers.handle(pointer('pointerdown', 1, 105), layout, 0);
    fingers.reset();
    expect(fingers.handle(pointer('pointerup', 1, 105), layout, 0).intents).toEqual([]);
  });

  test('reads the point through the letterbox the stage is fitted with', () => {
    const fingers = new TouchLaneFingers();
    // A 1280x960 canvas shows the stage at 2x: canvas (210, 600) is stage (105, 300), lane `11`.
    const big = () => ({ ...LAYOUT, screen: { width: 1280, height: 960 } });
    expect(fingers.handle(pointer('pointerdown', 1, 210, 600), big, 0).intents).toEqual([press('11')]);
    // A 1280x480 canvas pillarboxes it 320 px in: canvas (445, 300) is stage (125, 300), lane `12`.
    const wide = () => ({ ...LAYOUT, screen: { width: 1280, height: 480 } });
    expect(fingers.handle(pointer('pointerdown', 2, 445, 300), wide, 0).intents).toEqual([press('12')]);
  });
});
