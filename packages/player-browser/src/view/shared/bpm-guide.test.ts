import { expect, test } from 'vite-plus/test';
import { renderBPMGuide } from './bpm-guide.ts';
import { resolveNoteDrawWindow } from '../../chart/note-draw-window.ts';
import type { ChildPool } from '../../skins/pixi-kit/pools.ts';

test('places future guides at note positions, with source colors, and removes passed markers', () => {
  const labels: { text?: string; style: Record<string, unknown>; x?: number; y?: number }[] = [];
  const pool = {
    acquireText() {
      const label = {
        style: {},
        position: {
          set(x: number, y: number) {
            Object.assign(label, { x, y });
          },
        },
      };
      labels.push(label);
      return label;
    },
  } as unknown as ChildPool;
  const input = {
    enabled: true,
    drawLines: false,
    pool,
    events: [
      { kind: 'bpm' as const, beat: 0, seconds: 0, text: 'BPM120' },
      { kind: 'bpm' as const, beat: 4, seconds: 2, text: 'BPM240' },
    ],
    window: resolveNoteDrawWindow({ rules: 'lr2', currentBeat: 2, nowSeconds: 1, laneBeats: 10, overscanBeats: 0 }),
    distance: (beat: number) => beat - 2,
    pixelsPerBeat: 100,
    lanes: [{ x: 50, w: 400, top: 0, bottom: 700 }],
  };
  renderBPMGuide(input);
  expect(labels).toHaveLength(1);
  expect(labels[0]).toMatchObject({ text: 'BPM240', x: 250, y: 480, style: { fill: 0x00c000 } });
  labels.length = 0;
  renderBPMGuide({ ...input, enabled: false });
  expect(labels).toHaveLength(0);
});
