import { Sprite, Texture, TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vite-plus/test';
import { BEATORAJA_OP, normalizeBeatorajaNote, normalizeBeatorajaImages } from '@be-music/skin-beatoraja';
import type { BeatorajaTextureCache } from '../../../skin/beatoraja/textures.ts';
import {
  BeatorajaNoteLayer,
  beatorajaDisplayScrollBeat,
  beatorajaPixelsPerBeat,
  lr2LastWalkedBeat,
  resolveBeatorajaNoteLane,
} from './notes.ts';

// Mirrors upstream `LaneRenderer.java:271-276`'s `rxhs = (hu - hl) * hispeed` divided by
// `getMeasureBeats(1.0) === 4` to convert "y-delta per measure" into "y-delta per beat".
// The previous implementation used a fixed 72 px/beat regardless of skin lane height; that
// produced a ~2.9× slower scroll on ModernChic (lane = 841 px → upstream's 210 px/beat
// vs our 72), which the user reported as the beatoraja path falling slower than the LR2
// path on the same chart at the same hispeed.
describe('beatorajaPixelsPerBeat (upstream `rxhs / 4` for the beatoraja note layer)', () => {
  it('returns laneHeight / 4 at hispeed=1 (= 1 measure visible per lane height)', () => {
    // ModernChic-shaped lane (841 px in skin coords): 1 measure = 4 beats spans 1 lane.
    expect(beatorajaPixelsPerBeat(841, 1)).toBeCloseTo(841 / 4, 6);
    // Default play5.json's 580-px lane authored at `y:140, h:580`: 580 / 4 = 145 px/beat.
    expect(beatorajaPixelsPerBeat(580, 1)).toBeCloseTo(145, 6);
  });

  it('scales linearly with hispeed', () => {
    expect(beatorajaPixelsPerBeat(800, 2)).toBeCloseTo(400, 6);
    expect(beatorajaPixelsPerBeat(800, 0.5)).toBeCloseTo(100, 6);
    // hispeed 4× → 4× the per-beat scroll → only 1 beat fits per lane height.
    expect(beatorajaPixelsPerBeat(800, 4)).toBeCloseTo(800, 6);
  });

  it('returns 0 for non-positive lane height (degenerate skin or pre-mount frames)', () => {
    expect(beatorajaPixelsPerBeat(0, 1)).toBe(0);
    expect(beatorajaPixelsPerBeat(-50, 1)).toBe(0);
  });

  it('returns 0 for non-positive hispeed (paused / clamped state)', () => {
    expect(beatorajaPixelsPerBeat(800, 0)).toBe(0);
    expect(beatorajaPixelsPerBeat(800, -1)).toBe(0);
  });

  it('returns 0 for non-finite inputs (NaN guard)', () => {
    expect(beatorajaPixelsPerBeat(Number.NaN, 1)).toBe(0);
    expect(beatorajaPixelsPerBeat(800, Number.NaN)).toBe(0);
    expect(beatorajaPixelsPerBeat(Number.POSITIVE_INFINITY, 1)).not.toBeNaN();
  });
});

// The display layers (note + marker) scroll from the engine's mirrored `displayBeat` once an LR2 negative-BPM
// reversal (issue #134) is past; before that the field is unset and the true `currentBeat` drives the scroll.
describe('beatorajaDisplayScrollBeat (LR2 negative-BPM reversal display clock)', () => {
  it('returns currentBeat while no reversal mirror is armed', () => {
    expect(beatorajaDisplayScrollBeat({ currentBeat: 12.5 })).toBe(12.5);
    expect(beatorajaDisplayScrollBeat({ currentBeat: 12.5, displayBeat: undefined })).toBe(12.5);
  });

  it('returns the mirrored displayBeat once the engine publishes it (scrolling backwards past the reversal)', () => {
    // Past the reversal the engine mirrors the clock — displayBeat runs BEHIND currentBeat and shrinks each
    // frame while currentBeat keeps advancing; the display consumer must follow the mirror, not the true clock.
    expect(beatorajaDisplayScrollBeat({ currentBeat: 20, displayBeat: 12 })).toBe(12);
    expect(beatorajaDisplayScrollBeat({ currentBeat: 21, displayBeat: 11 })).toBe(11);
    // A mirrored beat of 0 is a valid position (back at the chart head) — `??` must not treat it as unset.
    expect(beatorajaDisplayScrollBeat({ currentBeat: 32, displayBeat: 0 })).toBe(0);
  });
});

describe('lr2LastWalkedBeat (where the note walk stops under LR2 rules)', () => {
  it('stops one pixel past the lead-in band above the lane top', () => {
    // 100 px per beat: the 24 px band and one more pixel are 0.25 beats past the window's last beat.
    expect(lr2LastWalkedBeat({ rules: 'lr2', lastBeat: 10 }, 100)).toBeCloseTo(10.25, 10);
  });

  it('does not stop under beatoraja rules, which end at their own window', () => {
    expect(lr2LastWalkedBeat({ rules: 'beatoraja', lastBeat: 10 }, 100)).toBe(Number.POSITIVE_INFINITY);
  });

  it('does not stop when notes do not scroll (no speed, or a NaN one)', () => {
    expect(lr2LastWalkedBeat({ rules: 'lr2', lastBeat: 10 }, 0)).toBe(Number.POSITIVE_INFINITY);
    expect(lr2LastWalkedBeat({ rules: 'lr2', lastBeat: 10 }, Number.NaN)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('resolveBeatorajaNoteLane', () => {
  it('maps the 24 keys onto skin lanes 0..23 and the wheel up / down onto 24 / 25', () => {
    expect(resolveBeatorajaNoteLane('11', '24')).toBe(0);
    expect(resolveBeatorajaNoteLane('1O', '24')).toBe(23);
    expect(resolveBeatorajaNoteLane('1P', '24')).toBe(24);
    expect(resolveBeatorajaNoteLane('1Q', '24')).toBe(25);
    expect(resolveBeatorajaNoteLane('1R', '24')).toBeUndefined();
  });

  it('puts the 48 KEY 2P side after the 1P wheel, its wheel on 50 / 51', () => {
    expect(resolveBeatorajaNoteLane('1Q', '48')).toBe(25);
    expect(resolveBeatorajaNoteLane('21', '48')).toBe(26);
    expect(resolveBeatorajaNoteLane('2O', '48')).toBe(49);
    expect(resolveBeatorajaNoteLane('2P', '48')).toBe(50);
    expect(resolveBeatorajaNoteLane('2Q', '48')).toBe(51);
  });

  it('keeps the That-Which-Must-Not-Be-Named scratch after the keys of its side', () => {
    expect(resolveBeatorajaNoteLane('11', '7')).toBe(0);
    expect(resolveBeatorajaNoteLane('16', '7')).toBe(7);
    expect(resolveBeatorajaNoteLane('21', '14')).toBe(8);
    expect(resolveBeatorajaNoteLane('26', '14')).toBe(15);
    expect(resolveBeatorajaNoteLane('16', '10')).toBe(5);
    expect(resolveBeatorajaNoteLane('25', '9')).toBe(8);
  });
});

describe('BeatorajaNoteLayer lane geometry under a mutated activeOps Set', () => {
  const textures: BeatorajaTextureCache = {
    get: () => undefined,
    values: () => [][Symbol.iterator](),
    pathOf: () => undefined,
  };
  // A lift-gated layout ahead of the default one: with `LIFT1_ON` lit the lane sits 100 px higher (libGDX Y-UP).
  const noteSection = normalizeBeatorajaNote({
    dst: [
      { if: [BEATORAJA_OP.LIFT1_ON], values: [{ x: 0, y: 300, w: 50, h: 500 }] },
      { if: [], values: [{ x: 0, y: 200, w: 50, h: 500 }] },
    ],
  });

  it('switches lane bounds when a gating op toggles on the same Set, and back again', () => {
    const layer = new BeatorajaNoteLayer({
      noteSection,
      variant: '7',
      images: new Map(),
      textures,
      canvasHeight: 1000,
    });
    const activeOps = new Set<number>();
    expect(layer.getLaneBounds(activeOps)).toEqual({ topY: 300, bottomY: 800 });
    activeOps.add(BEATORAJA_OP.LIFT1_ON);
    expect(layer.getLaneBounds(activeOps)).toEqual({ topY: 200, bottomY: 700 });
    // An op the note dst does not gate on leaves the geometry alone.
    activeOps.add(BEATORAJA_OP.LANECOVER1_ON);
    expect(layer.getLaneBounds(activeOps)).toEqual({ topY: 200, bottomY: 700 });
    activeOps.delete(BEATORAJA_OP.LIFT1_ON);
    expect(layer.getLaneBounds(activeOps)).toEqual({ topY: 300, bottomY: 800 });
    layer.dispose();
  });
});

describe('BeatorajaNoteLayer landmines', () => {
  it('draws engine landmineNotes even when the next regular note is outside the lane', () => {
    const layer = new BeatorajaNoteLayer({
      noteSection: normalizeBeatorajaNote({ dst: [{ values: [{ x: 0, y: 200, w: 50, h: 600 }] }] }),
      variant: '7',
      images: new Map(),
      textures: { get: () => undefined, values: () => [][Symbol.iterator](), pathOf: () => undefined },
      canvasHeight: 1000,
    });
    const mine = { channel: '11', beat: 1, seconds: 0.5, judged: false, mine: true };
    const frame = {
      notes: [{ channel: '11', beat: 100, seconds: 50, judged: false }],
      landmineNotes: [mine],
      currentBeat: 0,
      currentSeconds: 0,
    };
    layer.update(frame, 1, new Set());
    const noteLayer = layer.container.children[2]!;
    expect(noteLayer.children.filter((child) => child.visible)).toHaveLength(1);
    expect(noteLayer.children[0]!.getBounds().minY).toBe(644);
    mine.judged = true;
    layer.update({ ...frame, currentBeat: 2, currentSeconds: 1 }, 1, new Set());
    expect(noteLayer.children.filter((child) => child.visible)).toHaveLength(0);
    layer.update(frame, 1, new Set());
    expect(noteLayer.children.filter((child) => child.visible)).toHaveLength(1);
    layer.dispose();
  });
});

describe('BeatorajaNoteLayer mine sprites', () => {
  it.each([
    ['7', '11', 0],
    ['7', '16', 7],
    ['14', '21', 8],
    ['14', '26', 15],
    ['9', '25', 8],
    ['24', '1P', 24],
    ['48', '2Q', 51],
  ] as const)('uses the mine image on variant %s channel %s', (variant, channel, lane) => {
    const texture = new Texture({
      source: new TextureSource({ resource: new Uint8Array(16 * 16 * 4), width: 16, height: 16 }),
    });
    const images = normalizeBeatorajaImages([{ id: 'mine', src: 0, x: 0, y: 0, w: 16, h: 8 }]);
    const layer = new BeatorajaNoteLayer({
      noteSection: normalizeBeatorajaNote({
        mine: Array(52).fill('mine'),
        dst: Array.from({ length: 52 }, (_, i) => ({ x: i * 30, y: 200, w: 30, h: 600 })),
      }),
      variant,
      images: new Map(images.map((image) => [image.id, image])),
      textures: { get: () => texture, values: () => [texture][Symbol.iterator](), pathOf: () => undefined },
      canvasHeight: 1000,
    });
    const mine = { channel, beat: 1, seconds: 0.5, judged: false, mine: true };
    const frame = {
      notes: [],
      landmineNotes: [mine],
      invisibleNotes: [{ ...mine, mine: false, invisible: true }],
      currentBeat: 0,
      currentSeconds: 0,
    };
    layer.update(frame, 1, new Set());
    const sprite = layer.container.children[2]!.children[0] as Sprite;
    expect(sprite).toBeInstanceOf(Sprite);
    expect(sprite.visible).toBe(true);
    expect(sprite.x).toBe(lane * 30);
    expect(sprite.y).toBe(642);
    expect(sprite.texture.frame.height).toBe(8);
    const marker = layer.container.children[0]!;
    expect(marker.visible).toBe(false);
    layer.update(frame, 1, new Set(), undefined, true);
    expect(marker.visible).toBe(true);
    expect(marker.getBounds()).toMatchObject({ minX: lane * 30 + 2, minY: 646, maxX: lane * 30 + 28, maxY: 650 });
    layer.update(
      { ...frame, landmineNotes: [], notes: [{ channel, beat: 100, seconds: 50, judged: false }] },
      1,
      new Set(),
    );
    expect(sprite.visible).toBe(false);
    layer.dispose();
    texture.destroy(true);
  });
});

describe('BeatorajaNoteLayer invisible objects', () => {
  it('shows green inspection markers only while enabled and removes passed objects', () => {
    const layer = new BeatorajaNoteLayer({
      noteSection: normalizeBeatorajaNote({ dst: [{ x: 0, y: 200, w: 50, h: 600 }] }),
      variant: '7',
      images: new Map(),
      textures: { get: () => undefined, values: () => [][Symbol.iterator](), pathOf: () => undefined },
      canvasHeight: 1000,
    });
    const frame = {
      notes: [],
      landmineNotes: [],
      invisibleNotes: [{ channel: '11', beat: 1, seconds: 0.5, judged: true, invisible: true }],
      currentBeat: 0,
      currentSeconds: 0,
    };
    layer.update(frame, 1, new Set());
    expect(layer.container.getBounds().width).toBe(0);
    layer.update(frame, 1, new Set(), undefined, true);
    const marker = layer.container.children.find((child) => child.label === 'invisible-notes');
    expect(marker?.visible).toBe(true);
    expect(marker!.getBounds()).toMatchObject({ minX: 2, minY: 646, maxX: 48, maxY: 650 });
    layer.update(frame, 1, new Set(), undefined, false);
    expect(marker!.visible).toBe(false);
    layer.update(frame, 1, new Set(), undefined, true);
    expect(marker!.visible).toBe(true);
    layer.update({ ...frame, currentBeat: 2, currentSeconds: 1 }, 1, new Set(), undefined, true);
    expect(marker!.visible).toBe(false);
    layer.update(frame, 1, new Set(), undefined, true);
    expect(marker!.visible).toBe(true);
    // Invalid channels never create inspection markers.
    layer.update(
      { ...frame, invisibleNotes: [{ ...frame.invisibleNotes[0]!, channel: 'ZZ' }] },
      1,
      new Set(),
      undefined,
      true,
    );
    expect(marker!.visible).toBe(false);
    layer.dispose();
  });
});
