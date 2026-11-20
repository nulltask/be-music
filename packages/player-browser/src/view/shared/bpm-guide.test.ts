import { expect, test } from 'vite-plus/test';
import { layoutBPMGuideCallout, placeBPMGuideLabel, renderBPMGuide, resolveBPMGuideFontSize } from './bpm-guide.ts';
import { resolveNoteDrawWindow } from '../../chart/note-draw-window.ts';
import type { ChildPool } from '../../skins/pixi-kit/pools.ts';

interface FakeLabel {
  text?: string;
  style: Record<string, unknown>;
  x?: number;
  y?: number;
  anchor: { x: number; y: number; set(x: number, y: number): void };
  scale: { value: number; set(value: number): void };
  width: number;
  height: number;
}

function fakePool(): { pool: ChildPool; labels: FakeLabel[]; lines: number[]; strokes: number[] } {
  const labels: FakeLabel[] = [];
  const lines: number[] = [];
  const strokes: number[] = [];
  const pool = {
    acquireText() {
      const label: FakeLabel = {
        style: {},
        anchor: {
          x: 0,
          y: 0,
          set(x: number, y: number) {
            Object.assign(label.anchor, { x, y });
          },
        },
        scale: {
          value: 1,
          set(value: number) {
            label.scale.value = value;
          },
        },
        // Ten pixels a character at scale 1.
        get width() {
          return (label.text?.length ?? 0) * 10 * label.scale.value;
        },
        get height() {
          return 12 * label.scale.value;
        },
        position: {
          set(x: number, y: number) {
            Object.assign(label, { x, y });
          },
        },
      } as FakeLabel;
      labels.push(label);
      return label;
    },
    acquireGraphics() {
      const graphics = {
        rect(_x: number, y: number) {
          lines.push(y);
          return graphics;
        },
        fill() {
          return graphics;
        },
        moveTo() {
          return graphics;
        },
        lineTo() {
          return graphics;
        },
        stroke() {
          strokes.push(1);
          return graphics;
        },
      };
      return graphics;
    },
  } as unknown as ChildPool;
  return { pool, labels, lines, strokes };
}

/** A font whose `1` is 6 wide, other digits 10, and other characters 8; every line 12 tall. */
const measure = (text: string): { width: number; height: number } => ({
  width: text.split('').reduce((sum, char) => sum + (char === '1' ? 6 : /\d/u.test(char) ? 10 : 8), 0),
  height: 12,
});

/** The drawn glyphs grouped back into labels: the text without spaces, its right edge and baseline. */
function labelsOf(glyphs: readonly FakeLabel[]): { text: string; right: number; y: number; glyphs: FakeLabel[] }[] {
  const byLabel = new Map<string, FakeLabel[]>();
  for (const glyph of glyphs) {
    const key = (glyph as unknown as { label: string }).label;
    byLabel.set(key, [...(byLabel.get(key) ?? []), glyph]);
  }
  return [...byLabel.values()].map((group) => {
    const sorted = [...group].sort((a, b) => a.x! - b.x!);
    return { text: sorted.map((glyph) => glyph.text).join(''), right: 0, y: sorted[0]!.y!, glyphs: sorted };
  });
}

const window = resolveNoteDrawWindow({ rules: 'lr2', currentBeat: 2, nowSeconds: 1, laneBeats: 10, overscanBeats: 0 });

test('places future guides at note positions, right-aligned above their line, and removes passed markers', () => {
  const { pool, labels } = fakePool();
  const input = {
    enabled: true,
    drawLines: false,
    pool,
    events: [
      { kind: 'bpm' as const, beat: 0, seconds: 0, text: 'BPM 120' },
      { kind: 'bpm' as const, beat: 4, seconds: 2, text: 'BPM 240' },
    ],
    window,
    distance: (beat: number) => beat - 2,
    pixelsPerBeat: 100,
    lanes: [{ x: 50, w: 400, top: 0, bottom: 700 }],
    measure,
  };
  renderBPMGuide(input);
  const [label, ...rest] = labelsOf(labels);
  expect(rest).toHaveLength(0);
  expect(label).toMatchObject({ text: 'BPM240', y: 498 });
  // Right-aligned at 446: the last glyph's cell (a 0, 10 wide) is centred 5 to its left.
  expect(label!.glyphs.at(-1)!.x).toBe(441);
  expect(label!.glyphs[0]).toMatchObject({
    anchor: { x: 0.5, y: 1 },
    style: { fill: 0x00c000, fontFamily: 'monospace' },
  });
  labels.length = 0;
  renderBPMGuide({ ...input, enabled: false });
  expect(labels).toHaveLength(0);
});

test('shows only the kinds asked for, in the skin look, with lines for the kinds asked for', () => {
  const { pool, labels, lines } = fakePool();
  renderBPMGuide({
    enabled: true,
    pool,
    events: [
      { kind: 'bpm', beat: 3, seconds: 1.5, text: 'BPM 240' },
      { kind: 'stop', beat: 3.5, seconds: 1.75, text: 'STOP 100ms' },
      { kind: 'scroll', beat: 4, seconds: 2, text: 'SCROLL 0.5' },
      { kind: 'speed', beat: 5, seconds: 2.5, text: 'SPEED 2' },
    ],
    kinds: { bpm: false, stop: true, scroll: true, speed: false },
    style: { fontFamily: 'Orbitron', fontWeight: '500', fontSize: 11, colors: { scroll: 0x3fb4ff } },
    drawLines: new Set(['scroll'] as const),
    window,
    distance: (beat: number) => beat - 2,
    pixelsPerBeat: 100,
    lanes: [{ x: 0, w: 300, top: 0, bottom: 700 }],
    measure,
  });
  const drawn = labelsOf(labels);
  expect(drawn.map((label) => label.text)).toEqual(['STOP100ms', 'SCROLL0.5']);
  expect(drawn[0]!.glyphs[0]!.style).toMatchObject({
    fontFamily: 'Orbitron',
    fontWeight: '500',
    fontSize: 11,
    fill: 0xc0c000,
  });
  expect(drawn[1]!.glyphs[0]!.style).toMatchObject({ fill: 0x3fb4ff });
  // Only the SCROLL label gets a line.
  expect(lines).toEqual([500]);
});

test('shrinks a label wider than its lanes to fit inside them', () => {
  expect(placeBPMGuideLabel({ x: 10, w: 100 }, 300, 50)).toEqual({ x: 106, y: 298, scale: 1 });
  expect(placeBPMGuideLabel({ x: 10, w: 100 }, 300, 184)).toEqual({ x: 106, y: 298, scale: 0.5 });
});

test('sizes labels by the skin, else by the lanes as beatoraja does', () => {
  expect(resolveBPMGuideFontSize(280)).toBe(20);
  expect(resolveBPMGuideFontSize(70)).toBe(10);
  expect(resolveBPMGuideFontSize(210)).toBe(15);
  expect(resolveBPMGuideFontSize(280, { fontFamily: 'x', fontSize: 11 })).toBe(11);
});

test('stacks labels on one line in a callout: right-aligned, shortest at the top, with a leader', () => {
  // BPM 123 (70 wide), SCROLL 4 (80), STOP 4 (60), SPEED 1 (70); 12 tall, rows 14 apart.
  const labels = [70, 80, 60, 70].map((width) => ({ width, height: 12 }));
  const layout = layoutBPMGuideCallout(300, 200, labels);
  // Bottom up: SCROLL 4, BPM 123, SPEED 1, STOP 4; the bottom row half a row above the line.
  expect(layout.rows).toEqual([277, 291, 249, 263]);
  const leader = layout.leader!;
  expect(leader.from[1]).toBe(300);
  // The slant rises to the right, from the line to the top row.
  expect(leader.to[0]).toBeGreaterThan(leader.from[0]);
  expect(leader.to[1]).toBe(243.5);
  for (const [index, tick] of [1, 0, 3, 2].map((label, rank) => [label, leader.ticks[rank]!] as const)) {
    // Each tick ends just before its label, and is at least 6 long.
    expect(tick.x2).toBe(200 - labels[index]!.width - 3);
    expect(tick.x2 - tick.x1).toBeGreaterThanOrEqual(6 - 1e-9);
  }
});

test('puts a label alone just above its line, with no leader', () => {
  expect(layoutBPMGuideCallout(300, 200, [{ width: 50, height: 12 }])).toEqual({ rows: [298] });
});

test('draws changes on one beat as a callout', () => {
  const { pool, labels, strokes } = fakePool();
  renderBPMGuide({
    enabled: true,
    drawLines: false,
    pool,
    events: [
      { kind: 'bpm', beat: 4, seconds: 2, text: 'BPM 240' },
      { kind: 'scroll', beat: 4, seconds: 2, text: 'SCROLL 0.5' },
    ],
    kinds: { bpm: true, stop: true, scroll: true, speed: true },
    window,
    distance: (beat: number) => beat - 2,
    pixelsPerBeat: 100,
    lanes: [{ x: 0, w: 300, top: 0, bottom: 700 }],
    measure,
  });
  // SCROLL 0.5 is longer: the bottom row; BPM 240 above it.
  expect(labelsOf(labels).map((label) => [label.text, label.y])).toEqual([
    ['BPM240', 477],
    ['SCROLL0.5', 491],
  ]);
  expect(strokes).toHaveLength(1);
});

test('draws digits in cells as wide as the widest digit', () => {
  const { pool, labels } = fakePool();
  const draw = (text: string): number[] => {
    labels.length = 0;
    renderBPMGuide({
      enabled: true,
      drawLines: false,
      pool,
      events: [{ kind: 'bpm', beat: 4, seconds: 2, text }],
      window,
      distance: (beat: number) => beat - 2,
      pixelsPerBeat: 100,
      lanes: [{ x: 0, w: 300, top: 0, bottom: 700 }],
      measure,
    });
    return labelsOf(labels)[0]!.glyphs.map((glyph) => glyph.x!);
  };
  // A 1 takes a 0's cell, so BPM 111 and BPM 100 put every glyph in the same place.
  expect(draw('BPM 111')).toEqual(draw('BPM 100'));
});
