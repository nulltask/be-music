import { expect, test } from 'vite-plus/test';
import { placeBPMGuideLabel, renderBPMGuide, resolveBPMGuideFontSize, stackBPMGuideLabel } from './bpm-guide.ts';
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

function fakePool(): { pool: ChildPool; labels: FakeLabel[]; lines: number[] } {
  const labels: FakeLabel[] = [];
  const lines: number[] = [];
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
      };
      return graphics;
    },
  } as unknown as ChildPool;
  return { pool, labels, lines };
}

const window = resolveNoteDrawWindow({ rules: 'lr2', currentBeat: 2, nowSeconds: 1, laneBeats: 10, overscanBeats: 0 });

test('places future guides at note positions, right-aligned above their line, and removes passed markers', () => {
  const { pool, labels } = fakePool();
  const input = {
    enabled: true,
    drawLines: false,
    pool,
    events: [
      { kind: 'bpm' as const, beat: 0, seconds: 0, text: 'BPM120' },
      { kind: 'bpm' as const, beat: 4, seconds: 2, text: 'BPM240' },
    ],
    window,
    distance: (beat: number) => beat - 2,
    pixelsPerBeat: 100,
    lanes: [{ x: 50, w: 400, top: 0, bottom: 700 }],
  };
  renderBPMGuide(input);
  expect(labels).toHaveLength(1);
  expect(labels[0]).toMatchObject({
    text: 'BPM240',
    x: 446,
    y: 498,
    anchor: { x: 1, y: 1 },
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
      { kind: 'bpm', beat: 3, seconds: 1.5, text: 'BPM240' },
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
  });
  expect(labels.map((label) => label.text)).toEqual(['STOP 100ms', 'SCROLL 0.5']);
  expect(labels[0]!.style).toMatchObject({ fontFamily: 'Orbitron', fontWeight: '500', fontSize: 11, fill: 0xc0c000 });
  expect(labels[1]!.style).toMatchObject({ fill: 0x3fb4ff });
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

test('stacks a label above the one before it when they would overlap', () => {
  expect(stackBPMGuideLabel(300, 12, undefined)).toBe(300);
  // Clear of the label below: stays.
  expect(stackBPMGuideLabel(280, 12, { y: 300, top: 288 })).toBe(280);
  // On the same beat: goes just above it.
  expect(stackBPMGuideLabel(300, 12, { y: 300, top: 288 })).toBe(287);
  expect(stackBPMGuideLabel(295, 12, { y: 300, top: 288 })).toBe(287);
});

test('draws two changes on one beat one above the other', () => {
  const { pool, labels } = fakePool();
  renderBPMGuide({
    enabled: true,
    drawLines: false,
    pool,
    events: [
      { kind: 'bpm', beat: 4, seconds: 2, text: 'BPM240' },
      { kind: 'scroll', beat: 4, seconds: 2, text: 'SCROLL 0.5' },
    ],
    kinds: { bpm: true, stop: true, scroll: true, speed: true },
    window,
    distance: (beat: number) => beat - 2,
    pixelsPerBeat: 100,
    lanes: [{ x: 0, w: 300, top: 0, bottom: 700 }],
  });
  expect(labels.map((label) => label.y)).toEqual([498, 485]);
});
