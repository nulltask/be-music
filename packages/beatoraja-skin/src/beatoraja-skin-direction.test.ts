// Regression test for the beatoraja-vs-LR2 `angle` parity. Beatoraja's `angle == 1 || angle == 3`
// uses width (horizontal axis); else uses height (vertical) — verified in `JSONSkinLoader.java`.
// LR2's convention is INVERTED. Getting this wrong rotates every fill direction by 90°.

import { describe, it, expect } from 'vitest';
import { normalizeBeatorajaGraphs } from './beatoraja-skin-graph.ts';
import { normalizeBeatorajaSliders } from './beatoraja-skin-slider.ts';

describe('graph[].angle direction mapping (beatoraja parity)', () => {
  it('maps 0 → down, 1 → right, 2 → up, 3 → left', () => {
    const graphs = normalizeBeatorajaGraphs([
      { id: 'g0', src: 0, x: 0, y: 0, w: 1, h: 1, type: 1, angle: 0 },
      { id: 'g1', src: 0, x: 0, y: 0, w: 1, h: 1, type: 1, angle: 1 },
      { id: 'g2', src: 0, x: 0, y: 0, w: 1, h: 1, type: 1, angle: 2 },
      { id: 'g3', src: 0, x: 0, y: 0, w: 1, h: 1, type: 1, angle: 3 },
    ]);
    expect(graphs.map((g) => g.angle)).toEqual(['down', 'right', 'up', 'left']);
  });

  it('defaults to right when angle is missing (Graph.angle Java default = 1)', () => {
    const graphs = normalizeBeatorajaGraphs([{ id: 'g', src: 0, x: 0, y: 0, w: 1, h: 1, type: 1 }]);
    expect(graphs[0]?.angle).toBe('right');
  });
});

describe('slider[].angle direction mapping (beatoraja parity)', () => {
  it('maps 0 → down, 1 → right, 2 → up (lanecover convention), 3 → left', () => {
    const sliders = normalizeBeatorajaSliders([
      { id: 's0', src: 0, x: 0, y: 0, w: 1, h: 1, range: 100, type: 4, angle: 0 },
      { id: 's1', src: 0, x: 0, y: 0, w: 1, h: 1, range: 100, type: 4, angle: 1 },
      { id: 's2', src: 0, x: 0, y: 0, w: 1, h: 1, range: 100, type: 4, angle: 2 },
      { id: 's3', src: 0, x: 0, y: 0, w: 1, h: 1, range: 100, type: 4, angle: 3 },
    ]);
    expect(sliders.map((s) => s.angle)).toEqual(['down', 'right', 'up', 'left']);
  });
});
