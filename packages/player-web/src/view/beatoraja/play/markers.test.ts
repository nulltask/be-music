import { Texture, TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vite-plus/test';
import type { BeatorajaImageElement, BeatorajaImageId } from '@be-music/beatoraja-skin';
import { BeatorajaMarkerLayer } from './markers.ts';
import { resolveNoteDrawWindow } from '../../../chart/note-draw-window.ts';
import type { BeatorajaTextureCache } from '../../../skin/beatoraja/textures.ts';

// Match the skin-view tests' fake-texture pattern: a 1×1 non-EMPTY texture so the marker layer
// treats the entry as a real texture without needing a GPU device.
function fakeTextureCache(): BeatorajaTextureCache {
  const fakeSource = new TextureSource({ resource: new Uint8Array(4), width: 1, height: 1 });
  const tex = new Texture({ source: fakeSource });
  return {
    get: () => tex,
    values: () => [tex][Symbol.iterator](),
    pathOf: () => undefined,
  };
}

function makeImages(): ReadonlyMap<BeatorajaImageId, BeatorajaImageElement> {
  // The marker rect's `id` references this image — its source-rect crop becomes the marker
  // texture. Geometry doesn't matter for the alignment test; we only need a resolvable id.
  const map = new Map<BeatorajaImageId, BeatorajaImageElement>();
  map.set('section-line', {
    id: 'section-line',
    src: 0,
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    divx: 1,
    divy: 1,
    timer: 0,
    cycle: 0,
    ref: 0,
    len: 0,
    op: [],
    act: 0,
    click: 0,
    ifCodes: [],
  } as unknown as BeatorajaImageElement);
  return map;
}

describe('BeatorajaMarkerLayer — barline alignment vs lane bottom (upstream `y - hl`)', () => {
  // Mirrors upstream `LaneRenderer.java:373`'s `line.draw(sprite, time, main, 0, (int) (y - hl))`.
  // The rendered barline bottom = `authored_marker_y_gdx + (scroll_y - authored_lane_bottom_y)`.
  // Re-derived in Pixi: `rendered_pixi_bottom = scroll_pixi + (M_authored_pixi - L_authored_pixi)`.
  //
  // ModernChic authors lane.y_gdx = NOTES_JUDGE_Y - 12 (= 768 - 50 - 12 = 706 with judge at 50)
  // and barline.y_gdx = NOTES_JUDGE_Y (= 706 + 12 = 718). The barline's authored Y is 12 px
  // ABOVE the lane bottom in Y-UP — when re-anchored to the live scroll-Y the barline should
  // sit 12 px ABOVE the live judgement line in Pixi (= smaller y).

  const canvasHeight = 1000;
  const NOTES_JUDGE_Y_GDX = 200; // libGDX Y-UP — pretend judge line is at 200 from bottom.
  // Authored lane bottom in Y-UP = NOTES_JUDGE_Y_GDX - 12 = 188.
  // After flip to Pixi: lane bottom Pixi = canvasHeight - 188 = 812.
  const LANE_AUTHORED_BOTTOM_Y_PIXI = canvasHeight - (NOTES_JUDGE_Y_GDX - 12);

  it('barline at scroll=judgement lands 12 px above judgement in Pixi (matching ModernChic offset)', () => {
    const layer = new BeatorajaMarkerLayer({
      // ModernChic-shaped barline declaration: y = NOTES_JUDGE_Y, h = 3.
      group: [
        {
          id: 'section-line',
          dst: [{ x: 100, y: NOTES_JUDGE_Y_GDX, w: 500, h: 3, a: 255, r: 255, g: 255, b: 255 }],
        },
      ],
      bpm: [],
      stop: [],
      time: [],
      images: makeImages(),
      textures: fakeTextureCache(),
      canvasHeight,
      laneAuthoredBottomY: LANE_AUTHORED_BOTTOM_Y_PIXI,
    });

    // Live scroll: judgementY at 850 (could be a different pixi-bottom than the authored).
    // currentBeat=0, group=[0] → scrollY = judgementY at beat 0.
    const judgementY = 850;
    layer.update({
      currentBeat: 0,
      judgementY,
      laneTopY: 0,
      pixelsPerBeat: 100,
      markers: { group: [0], bpm: [], stop: [], time: [] },
    });

    const sprite = layer.container.children[0]!;
    // Marker is rendered with anchor=(0,1) → sprite.y is the BOTTOM of the marker rect.
    // Expected: sprite.y = scrollY + (M_authored - L_authored)
    //                    = 850 + ((canvasH - NOTES_JUDGE_Y_GDX) - LANE_AUTHORED_BOTTOM_Y_PIXI)
    //                    = 850 + ((1000 - 200) - (1000 - 188))
    //                    = 850 + (800 - 812) = 850 - 12 = 838.
    const expected = judgementY - 12;
    expect((sprite as { y: number }).y).toBe(expected);
  });

  it('barline at upcoming beat scrolls upward by `(beat - currentBeat) * pixelsPerBeat` plus the lane offset', () => {
    const layer = new BeatorajaMarkerLayer({
      group: [
        {
          id: 'section-line',
          dst: [{ x: 0, y: NOTES_JUDGE_Y_GDX, w: 500, h: 3, a: 255, r: 255, g: 255, b: 255 }],
        },
      ],
      bpm: [],
      stop: [],
      time: [],
      images: makeImages(),
      textures: fakeTextureCache(),
      canvasHeight,
      laneAuthoredBottomY: LANE_AUTHORED_BOTTOM_Y_PIXI,
    });

    // beat=4, currentBeat=2, pixelsPerBeat=100 → delta = 2 * 100 = 200 px above the live judgement.
    layer.update({
      currentBeat: 2,
      judgementY: 800,
      laneTopY: 0,
      pixelsPerBeat: 100,
      markers: { group: [4], bpm: [], stop: [], time: [] },
    });

    const sprite = layer.container.children[0]!;
    // scrollY = 800 - (4 - 2) * 100 = 600.
    // sprite.y = 600 + (-12) = 588.
    expect((sprite as { y: number }).y).toBe(800 - 200 - 12);
  });

  it('DP-style multi-destination markers paint each prototype (1P + 2P side)', () => {
    // DP skins author one `group[]` destination per side (typical layout: a 1P-side x and a
    // 2P-side x), so a chart with a single section-line beat must emit TWO sprites — one per
    // authored destination. Upstream `LaneRenderer.java:412-416` mirrors this with a
    // `for (SkinImage line : skin.getLine())` loop over every registered marker image. Prior
    // to this fix `kind.find(...)` short-circuited to the FIRST prototype and painted it at
    // every beat, leaving the 2P-side markers invisible. User-reported symptom: "2P 側に
    // 小節線や BPM 変更線が表示されない" on DP charts.
    const layer = new BeatorajaMarkerLayer({
      group: [
        // 1P-side barline — authored at x=50.
        {
          id: 'section-line',
          dst: [{ x: 50, y: NOTES_JUDGE_Y_GDX, w: 300, h: 3, a: 255, r: 255, g: 255, b: 255 }],
        },
        // 2P-side barline — authored at x=600 (the right-hand DP playfield).
        {
          id: 'section-line',
          dst: [{ x: 600, y: NOTES_JUDGE_Y_GDX, w: 300, h: 3, a: 255, r: 255, g: 255, b: 255 }],
        },
      ],
      bpm: [],
      stop: [],
      time: [],
      images: makeImages(),
      textures: fakeTextureCache(),
      canvasHeight,
      laneAuthoredBottomY: LANE_AUTHORED_BOTTOM_Y_PIXI,
    });

    layer.update({
      currentBeat: 0,
      judgementY: 850,
      laneTopY: 0,
      pixelsPerBeat: 100,
      markers: { group: [0], bpm: [], stop: [], time: [] },
    });

    // Both 1P (x=50) and 2P (x=600) prototypes must paint at the same scroll position.
    const sprites = layer.container.children as Array<{ x: number; y: number }>;
    expect(sprites).toHaveLength(2);
    expect(sprites[0]?.x).toBe(50);
    expect(sprites[1]?.x).toBe(600);
    // Both share the same y (= the offset-adjusted judgement position).
    expect(sprites[0]?.y).toBe(850 - 12);
    expect(sprites[1]?.y).toBe(850 - 12);
  });

  it('omitting laneAuthoredBottomY falls back to "marker bottom = scroll position" (legacy behaviour)', () => {
    // Hosts that haven't wired the new arg yet should still render markers — just at the
    // pre-fix position (= bug-compatible). Ensures the constructor remains backwards-compat
    // for any caller that doesn't have a noteSection handy.
    const layer = new BeatorajaMarkerLayer({
      group: [
        {
          id: 'section-line',
          dst: [{ x: 0, y: NOTES_JUDGE_Y_GDX, w: 500, h: 3, a: 255, r: 255, g: 255, b: 255 }],
        },
      ],
      bpm: [],
      stop: [],
      time: [],
      images: makeImages(),
      textures: fakeTextureCache(),
      canvasHeight,
      // NOT passing laneAuthoredBottomY.
    });

    layer.update({
      currentBeat: 0,
      judgementY: 850,
      laneTopY: 0,
      pixelsPerBeat: 100,
      markers: { group: [0], bpm: [], stop: [], time: [] },
    });

    const sprite = layer.container.children[0]!;
    // Pre-fix: sprite.y = scrollY = judgementY = 850. No 12-px offset.
    expect((sprite as { y: number }).y).toBe(850);
  });
});

describe('BeatorajaMarkerLayer — beatoraja LaneRenderer window on a chart that scrolls', () => {
  const canvasHeight = 1000;
  const makeLayer = () =>
    new BeatorajaMarkerLayer({
      group: [{ id: 'section-line', dst: [{ x: 0, y: 200, w: 500, h: 3, a: 255, r: 255, g: 255, b: 255 }] }],
      bpm: [],
      stop: [],
      time: [],
      images: makeImages(),
      textures: fakeTextureCache(),
      canvasHeight,
      laneAuthoredBottomY: canvasHeight - 200,
    });
  const visibleYs = (layer: BeatorajaMarkerLayer): number[] =>
    layer.container.children.filter((child) => child.visible).map((child) => (child as { y: number }).y);

  it('hides a bar line whose time has come and stops after the first timeline past the lane top', () => {
    const layer = makeLayer();
    // Lane from y=510 to the line at y=800: 2.9 beats at 100 px per beat, overrun at beat 4.9; the next timeline is
    // the bar line at beat 5, which draws in the band above the lane, and the walk stops there: beat 6, which a
    // negative scroll brings back into the lane, is not drawn.
    const window = resolveNoteDrawWindow({
      rules: 'beatoraja',
      currentBeat: 2,
      nowSeconds: 1,
      laneBeats: 2.9,
      timelineBeats: [1, 3, 5, 6],
      overscanBeats: 0,
      stageBottomY: canvasHeight,
    });
    layer.update({
      currentBeat: 2,
      judgementY: 800,
      laneTopY: 510,
      pixelsPerBeat: 100,
      // Beat 1.8 lies just below the line but its time (0.9 s) has passed; beat 2 is on the line at 1 s.
      markers: { group: [1.8, 2, 3, 5, 6], bpm: [], stop: [], time: [] },
      distance: (beat) => (beat === 6 ? 1 : beat - 2),
      window,
      secondsAt: (beat) => beat / 2,
    });
    expect(visibleYs(layer)).toEqual([800, 700, 500]);
  });

  it('draws a bar line a negative scroll puts below the line while its time is ahead', () => {
    const layer = makeLayer();
    const window = resolveNoteDrawWindow({
      rules: 'beatoraja',
      currentBeat: 2,
      nowSeconds: 1,
      laneBeats: 3,
      overscanBeats: 0,
      stageBottomY: canvasHeight,
    });
    layer.update({
      currentBeat: 2,
      judgementY: 800,
      laneTopY: 500,
      pixelsPerBeat: 100,
      markers: { group: [3], bpm: [], stop: [], time: [] },
      distance: () => -1.5,
      window,
      secondsAt: (beat) => beat / 2,
    });
    expect(visibleYs(layer)).toEqual([950]);
  });
});

describe('BeatorajaMarkerLayer — LR2 window on a chart that does not scroll', () => {
  const canvasHeight = 1000;
  const makeLayer = () =>
    new BeatorajaMarkerLayer({
      group: [{ id: 'section-line', dst: [{ x: 0, y: 200, w: 500, h: 3, a: 255, r: 255, g: 255, b: 255 }] }],
      bpm: [],
      stop: [],
      time: [],
      images: makeImages(),
      textures: fakeTextureCache(),
      canvasHeight,
      laneAuthoredBottomY: canvasHeight - 200,
    });
  const visibleYs = (layer: BeatorajaMarkerLayer): number[] =>
    layer.container.children.filter((child) => child.visible).map((child) => (child as { y: number }).y);

  it('holds the bar line just crossed on the judgement line and drops the ones the playhead has passed', () => {
    const layer = makeLayer();
    const window = resolveNoteDrawWindow({
      rules: 'lr2',
      currentBeat: 2,
      nowSeconds: 1,
      laneBeats: 3,
      overscanBeats: 0,
    });
    layer.update({
      currentBeat: 2,
      judgementY: 800,
      laneTopY: 500,
      pixelsPerBeat: 100,
      // Beat 1.995 was crossed within the last pixel: it stays, on the line rather than half a pixel below it. Beat 1.9
      // is gone (LR2 does not slide bar lines under the judgement line).
      markers: { group: [1.9, 1.995, 2, 3], bpm: [], stop: [], time: [] },
      window,
    });
    expect(visibleYs(layer)).toEqual([800, 800, 700]);
  });
  it('draws the same bar lines from a whole chart of them: those past the playhead and above the lead-in band are skipped', () => {
    const layer = makeLayer();
    const window = resolveNoteDrawWindow({
      rules: 'lr2',
      currentBeat: 400,
      nowSeconds: 200,
      laneBeats: 3,
      overscanBeats: 0,
    });
    // A bar line every half beat over 1,000 beats; the lane shows beats 400 to 403 plus the 24 px band above it.
    const group = Array.from({ length: 2001 }, (_, index) => index / 2);
    layer.update({
      currentBeat: 400,
      judgementY: 800,
      laneTopY: 500,
      pixelsPerBeat: 100,
      markers: { group, bpm: [], stop: [], time: [] },
      window,
    });
    expect(visibleYs(layer)).toEqual([800, 750, 700, 650, 600, 550, 500]);
  });
});
