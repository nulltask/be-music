import { describe, expect, it } from 'vite-plus/test';
import type { BeMusicPlayfieldParts } from '../models.ts';
import {
  paintBombs,
  paintJudgeLine,
  paintLaneCovers,
  paintLanes,
  paintNotes,
  paintPlayfieldParts,
  type BeMusicPlayfieldPaintContext,
} from './paint.ts';

/** Records every call and the style each fill was made with. */
function recorder(): BeMusicPlayfieldPaintContext & { calls: string[] } {
  const calls: string[] = [];
  const state = { fillStyle: '', strokeStyle: '', globalAlpha: 1, lineWidth: 1, font: '', textAlign: 'start' };
  const ctx = {
    ...state,
    calls,
    fillRect: (x: number, y: number, w: number, h: number) =>
      calls.push(`fillRect ${x},${y},${w},${h} ${String(ctx.fillStyle)} ${ctx.globalAlpha}`),
    fillText: (text: string, x: number, y: number) => calls.push(`fillText ${text} ${x},${y}`),
    beginPath: () => calls.push('beginPath'),
    arc: (x: number, y: number, r: number) => calls.push(`arc ${x},${y},${r} ${ctx.globalAlpha}`),
    rect: (x: number, y: number, w: number, h: number) => calls.push(`rect ${x},${y},${w},${h}`),
    stroke: () => calls.push('stroke'),
    clip: () => calls.push('clip'),
    save: () => calls.push('save'),
    restore: () => calls.push('restore'),
  };
  return ctx as unknown as BeMusicPlayfieldPaintContext & { calls: string[] };
}

describe('playfield painters', () => {
  it('lights a pressed lane with its beam and marks a held long note', () => {
    const ctx = recorder();
    paintLanes(ctx, {
      lanes: [{ channel: '11', kind: 'white', x: 10, w: 20, top: 0, bottom: 100, beam: 0.5, holding: true }],
    });
    expect(ctx.calls).toEqual([
      'fillRect 10,0,20,100 #202d40 1',
      'fillRect 10,0,20,100 #e5efff 0.15',
      'fillRect 10,96,20,4 #abcaff 1',
    ]);
  });

  it('draws measure lines under the notes and mines unlike playable notes', () => {
    const ctx = recorder();
    paintNotes(ctx, {
      measureLines: [{ side: '1P', x: 0, w: 50, y: 40 }],
      longNotes: [],
      notes: [{ kind: 'black', x: 10, w: 20, y: 60 }],
      mines: [{ kind: 'white', x: 30, w: 20, y: 80 }],
    });
    expect(ctx.calls).toEqual([
      'fillRect 0,39,50,1 #e5efff 0.25',
      'fillRect 10,54,20,6 #88b9ff 1',
      'fillRect 30,74,20,6 #ff5c6c 1',
      'fillRect 32,76,16,2 #10151f 1',
    ]);
  });

  it('dims a dropped long note', () => {
    const ctx = recorder();
    paintNotes(ctx, {
      measureLines: [],
      longNotes: [{ kind: 'white', x: 0, w: 10, top: 20, bottom: 60, state: 'dropped' }],
      notes: [],
      mines: [],
    });
    expect(ctx.calls).toEqual([
      'fillRect 0,14,10,40 #e5efff 0.15',
      'fillRect 0,54,10,6 #e5efff 0.5',
      'fillRect 0,14,10,6 #e5efff 0.5',
    ]);
  });

  it('covers the top for SUDDEN and the bottom for HIDDEN', () => {
    const ctx = recorder();
    paintLaneCovers(ctx, { areas: [{ left: 0, right: 40, top: 0, bottom: 200, sudden: 0.5, hidden: 0.25 }] });
    expect(ctx.calls).toEqual(['fillRect 0,0,40,100 #000000 0.92', 'fillRect 0,150,40,50 #000000 0.92']);
  });

  it('fades and grows a bomb with its age', () => {
    const ctx = recorder();
    paintBombs(ctx, {
      bombs: [{ channel: '11', kind: 'white', x: 0, w: 20, y: 100, elapsedMs: 150, seed: 1 }],
    });
    expect(ctx.calls).toEqual(['beginPath', 'arc 10,100,15 0.5', 'stroke']);
  });

  it('clips every part to its rect on a shared surface and skips empty ones', () => {
    const ctx = recorder();
    const empty = { x: 0, y: 0, w: 0, h: 0 };
    const parts: BeMusicPlayfieldParts = {
      stage: { width: 100, height: 100 },
      lanes: { rect: empty, data: { lanes: [] } },
      notes: { rect: empty, data: { notes: [], longNotes: [], mines: [], measureLines: [] } },
      laneCovers: { rect: empty, data: { areas: [] } },
      judgeLine: { rect: { x: 0, y: 90, w: 50, h: 2 }, data: { runs: [{ left: 0, right: 50 }], y: 90 } },
      bombs: { rect: empty, data: { bombs: [] } },
      judgmentDisplay: { rect: empty, data: { words: [], y: 0 } },
    };
    paintPlayfieldParts(ctx, parts);
    expect(ctx.calls).toEqual([
      'save',
      'beginPath',
      'rect 0,90,50,2',
      'clip',
      'fillRect 0,90,50,2 #ffa8b3 1',
      'restore',
    ]);
    const line = recorder();
    paintJudgeLine(line, parts.judgeLine.data);
    expect(line.calls).toEqual(['fillRect 0,90,50,2 #ffa8b3 1']);
  });
});
