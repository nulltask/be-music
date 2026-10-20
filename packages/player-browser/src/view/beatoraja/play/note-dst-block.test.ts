import { describe, expect, it } from 'vite-plus/test';
import { normalizeBeatorajaNote, pickBeatorajaNoteRects } from '@be-music/skin-beatoraja';
import { resolveBeatorajaNoteDstBlockIndex } from './note-dst-block.ts';

describe('resolveBeatorajaNoteDstBlockIndex', () => {
  const section = normalizeBeatorajaNote({
    dst: [
      { if: [920], values: [{ x: 1, y: 0, w: 0, h: 0 }] },
      { if: [922, -923], values: [{ x: 2, y: 0, w: 0, h: 0 }] },
      { if: [], values: [{ x: 3, y: 0, w: 0, h: 0 }] },
    ],
  });

  it('returns the first block whose if ops are satisfied, in declaration order', () => {
    expect(resolveBeatorajaNoteDstBlockIndex(section, new Set([920]))).toBe(0);
    expect(resolveBeatorajaNoteDstBlockIndex(section, new Set([920, 922]))).toBe(0);
    expect(resolveBeatorajaNoteDstBlockIndex(section, new Set([922]))).toBe(1);
  });

  it('honours negated ops and falls through to the default (empty-if) block', () => {
    expect(resolveBeatorajaNoteDstBlockIndex(section, new Set([922, 923]))).toBe(2);
    expect(resolveBeatorajaNoteDstBlockIndex(section, new Set())).toBe(2);
  });

  it('returns -1 when no block matches', () => {
    const gated = normalizeBeatorajaNote({ dst: [{ if: [920], values: [{ x: 1, y: 0, w: 0, h: 0 }] }] });
    expect(resolveBeatorajaNoteDstBlockIndex(gated, new Set([999]))).toBe(-1);
    expect(resolveBeatorajaNoteDstBlockIndex(normalizeBeatorajaNote({}), new Set([920]))).toBe(-1);
  });

  it('selects the same block as pickBeatorajaNoteRects', () => {
    for (const ops of [[920], [922], [922, 923], [], [920, 922, 923]]) {
      const activeOps = new Set(ops);
      const index = resolveBeatorajaNoteDstBlockIndex(section, activeOps);
      expect(section.dst[index]?.rects ?? []).toBe(pickBeatorajaNoteRects(section, activeOps));
    }
  });

  it('follows in-place mutation of the same Set (the play bridge reuses one Set every frame)', () => {
    const activeOps = new Set<number>();
    expect(resolveBeatorajaNoteDstBlockIndex(section, activeOps)).toBe(2);
    activeOps.add(922);
    expect(resolveBeatorajaNoteDstBlockIndex(section, activeOps)).toBe(1);
    activeOps.add(920);
    expect(resolveBeatorajaNoteDstBlockIndex(section, activeOps)).toBe(0);
    activeOps.delete(920);
    activeOps.delete(922);
    expect(resolveBeatorajaNoteDstBlockIndex(section, activeOps)).toBe(2);
  });
});
