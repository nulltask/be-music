// Regression test for the beatoraja `angle` direction codes on graph[] and slider[]. The two
// element types share a JSON field name but NOT the value space:
//
//   - `slider[].angle` (`SkinSlider.java:26`): 4 values — `0:上 1:右 2:下 3:左` (up/right/down/left).
//     The `draw()` math `region.y + (dir==0 ? +v*range : dir==2 ? -v*range : 0)` confirms
//     libGDX Y-UP semantics where direction 0 adds to skin y (visually up in Y-UP). After our
//     Pixi Y-DOWN flip, the source labels line up with screen-visual direction labels.
//
//   - `graph[].angle` (`SkinGraph.java:99-106`): 2 values — `direction == 1` ⇒ vertical (fill
//     bottom-up), anything else ⇒ horizontal (fill left-right). `JsonSkin.Graph.angle` defaults
//     to 1, so an omitted field renders as VERTICAL.
//
// Audit A-5 / B-3: previous TS impl borrowed slider's 4-direction code for graph[] which both
// inverted the default (1 was treated as 'right') and added 'left' / 'down' modes that don't
// exist in upstream `SkinGraph`.

import { describe, it, expect } from 'vitest';
import { normalizeBeatorajaGraphs } from './beatoraja-skin-graph.ts';
import { normalizeBeatorajaSliders } from './beatoraja-skin-slider.ts';

describe('graph[].angle direction mapping (audit A-5 / B-3 — 2-value semantics)', () => {
  it('maps angle === 1 → vertical, anything else → horizontal', () => {
    const graphs = normalizeBeatorajaGraphs([
      { id: 'g0', src: 0, x: 0, y: 0, w: 1, h: 1, type: 1, angle: 0 },
      { id: 'g1', src: 0, x: 0, y: 0, w: 1, h: 1, type: 1, angle: 1 },
      { id: 'g2', src: 0, x: 0, y: 0, w: 1, h: 1, type: 1, angle: 2 },
      { id: 'g3', src: 0, x: 0, y: 0, w: 1, h: 1, type: 1, angle: 3 },
    ]);
    expect(graphs.map((g) => g.angle)).toEqual(['horizontal', 'vertical', 'horizontal', 'horizontal']);
  });

  it('defaults to vertical when angle is missing (matches `JsonSkin.Graph.angle = 1` default)', () => {
    const graphs = normalizeBeatorajaGraphs([{ id: 'g', src: 0, x: 0, y: 0, w: 1, h: 1, type: 1 }]);
    expect(graphs[0]?.angle).toBe('vertical');
  });
});

describe('slider[].angle direction mapping (beatoraja parity)', () => {
  it('maps 0 → up, 1 → right, 2 → down, 3 → left', () => {
    const sliders = normalizeBeatorajaSliders([
      { id: 's0', src: 0, x: 0, y: 0, w: 1, h: 1, range: 100, type: 4, angle: 0 },
      { id: 's1', src: 0, x: 0, y: 0, w: 1, h: 1, range: 100, type: 4, angle: 1 },
      { id: 's2', src: 0, x: 0, y: 0, w: 1, h: 1, range: 100, type: 4, angle: 2 },
      { id: 's3', src: 0, x: 0, y: 0, w: 1, h: 1, range: 100, type: 4, angle: 3 },
    ]);
    expect(sliders.map((s) => s.angle)).toEqual(['up', 'right', 'down', 'left']);
  });
});
