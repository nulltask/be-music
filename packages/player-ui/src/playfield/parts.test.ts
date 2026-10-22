import { describe, expect, it } from 'vite-plus/test';
import type { BeMusicGameplayFrame } from '@be-music/player-skin-sdk';
import { resolvePlayfieldParts } from './parts.ts';

type PartsInput = Parameters<typeof resolvePlayfieldParts>[0];

function frame(overrides: Partial<PartsInput> = {}): PartsInput {
  const lanes = [
    { channel: '16', kind: 'scratch', x: 20, w: 40, top: 8, bottom: 464, beam: 0 },
    { channel: '11', kind: 'white', x: 60, w: 30, top: 8, bottom: 464, beam: 0 },
    { channel: '26', kind: 'scratch', x: 300, w: 40, top: 8, bottom: 464, beam: 0 },
  ] satisfies BeMusicGameplayFrame['lanes'];
  return {
    layout: {
      stage: { width: 854, height: 480 },
      lanes: [
        { channel: '16', kind: 'scratch', side: '1P', x: 20, w: 40 },
        { channel: '11', kind: 'white', side: '1P', x: 60, w: 30 },
        { channel: '26', kind: 'scratch', side: '2P', x: 300, w: 40 },
      ],
      playfield: {
        left: 20,
        right: 340,
        centerX: 180,
        top: 8,
        judgementY: 464,
        sides: { '1P': { left: 20, right: 90 }, '2P': { left: 300, right: 340 } },
      },
      bga: { x: 724, y: 8, w: 106, h: 106 },
    },
    lanes,
    notes: [],
    longNotes: [],
    mines: [],
    measureLines: [],
    bombs: [],
    bga: undefined,
    runtime: {},
    ...overrides,
  };
}

describe('resolvePlayfieldParts', () => {
  it('gives each part only the stage rect it draws in', () => {
    const parts = resolvePlayfieldParts(frame());
    expect(parts.stage).toEqual({ width: 854, height: 480 });
    expect(parts.bga.rect).toEqual({ x: 724, y: 8, w: 106, h: 106 });
    expect(parts.lanes.rect).toEqual({ x: 20, y: 8, w: 320, h: 456 });
    expect(parts.notes.rect).toEqual({ x: 20, y: 8, w: 320, h: 472 });
    expect(parts.laneCovers.rect).toEqual(parts.lanes.rect);
    expect(parts.judgeLine.rect).toEqual({ x: 20, y: 464, w: 320, h: 2 });
    expect(parts.bombs.rect).toEqual({ x: 20, y: 438, w: 320, h: 52 });
    expect(parts.judgmentDisplay.rect).toEqual({ x: 20, y: 352, w: 320, h: 28 });
  });

  it('draws the judge line once per lane run', () => {
    expect(resolvePlayfieldParts(frame()).judgeLine.data).toEqual({
      runs: [
        { left: 20, right: 90 },
        { left: 300, right: 340 },
      ],
      y: 464,
    });
  });

  it('centers each side’s judgment word on that side and flashes PERFECT as GREAT', () => {
    const parts = resolvePlayfieldParts(
      frame({
        runtime: {
          judgeSides: [{ side: '1P', judge: 'PERFECT' }, { side: '2P', judge: 'BAD' }, { side: '1P' }],
        },
      }),
    );
    expect(parts.judgmentDisplay.data).toEqual({
      words: [
        { x: 55, text: 'GREAT' },
        { x: 320, text: 'BAD' },
      ],
      y: 374,
    });
  });

  it('covers each side over that side’s lanes and skips sides without a cover', () => {
    const parts = resolvePlayfieldParts(
      frame({
        runtime: {
          laneCovers: [
            { side: '1P', sudden: 0.25, hidden: 0.1, lift: 0 },
            { side: '2P', sudden: 0, hidden: 0, lift: 0 },
          ],
        },
      }),
    );
    expect(parts.laneCovers.data.areas).toEqual([
      { left: 20, right: 90, top: 8, bottom: 464, sudden: 0.25, hidden: 0.1 },
    ]);
  });

  it('shows the BGA only for a chart that has one', () => {
    const image = {} as CanvasImageSource;
    const bga = { base: image, poorActive: false };
    expect(resolvePlayfieldParts(frame({ bga, runtime: { hasBGA: true } })).bga.data).toEqual({
      frame: bga,
      shown: true,
    });
    expect(resolvePlayfieldParts(frame()).bga.data.shown).toBe(false);
  });

  it('keeps empty rects when the chart has no lanes yet', () => {
    const parts = resolvePlayfieldParts(frame({ lanes: [] }));
    expect(parts.lanes.rect).toEqual({ x: 20, y: 8, w: 0, h: 0 });
    expect(parts.judgeLine.data.runs).toEqual([]);
  });
});
