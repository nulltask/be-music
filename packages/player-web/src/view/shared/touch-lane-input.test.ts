import { describe, expect, test } from 'vite-plus/test';
import type { PixiSceneHost } from '../../host/scene-host.ts';
import type { PlayIntent } from '../types.ts';
import { playfieldTouchLanes, TouchLaneInput } from './touch-lane-input.ts';

/** A host whose canvas is a plain event target with a style, on a 640x480 screen. */
function createHost() {
  const canvas = Object.assign(new EventTarget(), { style: { touchAction: 'auto' } });
  const host = { app: { canvas, screen: { width: 640, height: 480 } } } as unknown as PixiSceneHost;
  return { host, canvas };
}

function pointerEvent(type: string, pointerId: number, offsetX: number, offsetY = 300, pointerType = 'touch') {
  return Object.assign(new Event(type, { cancelable: true }), { pointerId, pointerType, offsetX, offsetY });
}

/** One lane, `11`, over x 90..130 from y 220 down on a 640x480 stage, the play having lifted no fingers yet. */
function createPlay() {
  const play = { laneX: new Map([['11', { x: 100, w: 20, top: 0, bottom: 400 }]]), touchLiftCount: 0 };
  const view = { play, playfieldSkin: { stage: { width: 640, height: 480 } } };
  return { play, view };
}

describe('TouchLaneInput', () => {
  test("follows the fingers on the canvas while attached, sending the session each lane's intent", () => {
    const { host, canvas } = createHost();
    const { view } = createPlay();
    const intents: PlayIntent[] = [];
    const input = new TouchLaneInput(playfieldTouchLanes(view));
    input.attach(host, (intent) => intents.push(intent));
    expect(canvas.style.touchAction).toBe('none');
    const down = pointerEvent('pointerdown', 1, 105);
    canvas.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    canvas.dispatchEvent(pointerEvent('pointerup', 1, 105));
    expect(intents.map((intent) => intent.type === 'lane' && [intent.channel, intent.pressed])).toEqual([
      ['11', true],
      ['11', false],
    ]);
  });

  test('leaves a mouse alone', () => {
    const { host, canvas } = createHost();
    const intents: PlayIntent[] = [];
    const input = new TouchLaneInput(playfieldTouchLanes(createPlay().view));
    input.attach(host, (intent) => intents.push(intent));
    const down = pointerEvent('pointerdown', 1, 105, 300, 'mouse');
    canvas.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(false);
    expect(intents).toEqual([]);
  });

  test("forgets the fingers once the play lifted them, and reads the play's lanes as they are now", () => {
    const { host, canvas } = createHost();
    const { play, view } = createPlay();
    const intents: PlayIntent[] = [];
    const input = new TouchLaneInput(playfieldTouchLanes(view));
    input.attach(host, (intent) => intents.push(intent));
    canvas.dispatchEvent(pointerEvent('pointerdown', 1, 105));
    play.touchLiftCount = 1;
    canvas.dispatchEvent(pointerEvent('pointerup', 1, 105));
    expect(intents).toHaveLength(1);
    play.laneX.set('12', { x: 120, w: 20, top: 0, bottom: 400 });
    canvas.dispatchEvent(pointerEvent('pointerdown', 2, 135));
    expect(intents.at(-1)).toMatchObject({ type: 'lane', channel: '12', pressed: true });
  });

  test('detaching stops listening, restores the canvas and forgets the fingers', () => {
    const { host, canvas } = createHost();
    const intents: PlayIntent[] = [];
    const input = new TouchLaneInput(playfieldTouchLanes(createPlay().view));
    input.attach(host, (intent) => intents.push(intent));
    canvas.dispatchEvent(pointerEvent('pointerdown', 1, 105));
    input.detach();
    expect(canvas.style.touchAction).toBe('auto');
    canvas.dispatchEvent(pointerEvent('pointerup', 1, 105));
    expect(intents).toHaveLength(1);
    // Attached again, the finger lifted while away lets nothing go.
    input.attach(host, (intent) => intents.push(intent));
    canvas.dispatchEvent(pointerEvent('pointerup', 1, 105));
    expect(intents).toHaveLength(1);
  });
});
