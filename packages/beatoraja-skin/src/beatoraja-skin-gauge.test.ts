import { describe, expect, it } from 'vitest';
import { normalizeBeatorajaGauge, pickBeatorajaGaugeNode, type BeatorajaGaugeElement } from './beatoraja-skin-gauge.ts';

function makeGauge(overrides: Partial<BeatorajaGaugeElement> & Pick<BeatorajaGaugeElement, 'nodes'>): BeatorajaGaugeElement {
  return {
    id: 'gauge',
    parts: 50,
    type: 0,
    range: 3,
    cycle: 33,
    starttime: 0,
    endtime: 500,
    ifCodes: [],
    ...overrides,
  };
}

describe('pickBeatorajaGaugeNode (type=0, default 7K 8-node 4-zone × 2-state)', () => {
  // Mirrors `default/play7main.lua`'s gauge: nodes[0..3] = off (n1..n4), nodes[4..7] = lit
  // (e1..e4). Standard LR2 4-zone groove gauge.
  const gauge = makeGauge({
    nodes: ['n1', 'n2', 'n3', 'n4', 'e1', 'e2', 'e3', 'e4'],
    parts: 50,
  });

  it('lit cells pick the higher slab; off cells the lower slab', () => {
    // Cell at part 4 (= 10% partPercent, zone 0) with gauge at 50% → lit, zone 0 → e1.
    expect(pickBeatorajaGaugeNode(gauge, 4, 50)).toMatchObject({ nodeId: 'e1', lit: true });
    // Cell at part 4 with gauge at 5% → off, zone 0 → n1.
    expect(pickBeatorajaGaugeNode(gauge, 4, 5)).toMatchObject({ nodeId: 'n1', lit: false });
  });

  it('zone selection follows the 4-band partition (30 / 60 / 80 thresholds)', () => {
    // partPercent thresholds: cell index produces partPercent = (i+1)/parts*100.
    // Use parts=10 for easier math.
    const g10 = makeGauge({ nodes: ['n1', 'n2', 'n3', 'n4', 'e1', 'e2', 'e3', 'e4'], parts: 10 });
    // Cell 0 → partPercent 10 (< 30) → zone 0. Lit at gauge 100 → e1.
    expect(pickBeatorajaGaugeNode(g10, 0, 100)).toMatchObject({ nodeId: 'e1' });
    // Cell 2 → partPercent 30 (= 30) → zone 1. → e2.
    expect(pickBeatorajaGaugeNode(g10, 2, 100)).toMatchObject({ nodeId: 'e2' });
    // Cell 5 → partPercent 60 (= 60) → zone 2. → e3.
    expect(pickBeatorajaGaugeNode(g10, 5, 100)).toMatchObject({ nodeId: 'e3' });
    // Cell 7 → partPercent 80 (= 80) → zone 3. → e4.
    expect(pickBeatorajaGaugeNode(g10, 7, 100)).toMatchObject({ nodeId: 'e4' });
  });
});

describe('pickBeatorajaGaugeNode (type=3, default 9K 12-node 4-zone × 3-state pulse)', () => {
  // Mirrors `default/play9.json`'s gauge: 12 nodes in 3 slabs of 4 zones each.
  //   nodes[0..3]: n1..n4 (off)
  //   nodes[4..7]: e1..e4 (lit)
  //   nodes[8..11]: n1bright..n2bright + e1bright..e2bright (pulse-bright slab)
  const gauge = makeGauge({
    nodes: ['n1', 'n2', 'n3', 'n4', 'e1', 'e2', 'e3', 'e4', 'n1b', 'n2b', 'e1b', 'e2b'],
    parts: 24,
    type: 3,
    cycle: 1500,
  });

  it('lit cells alternate between the lit slab and the bright slab over `cycle`', () => {
    // Cell at part 0 (partPercent ≈ 4%, zone 0) with gauge at 100%:
    //   Phase 0..749 ms (= first half of 1500 ms cycle): state = 1 → nodes[4] = e1 (lit)
    //   Phase 750..1499 ms (= second half): state = 2 → nodes[8] = n1b (bright)
    expect(pickBeatorajaGaugeNode(gauge, 0, 100, 0)).toMatchObject({ nodeId: 'e1', state: 1 });
    expect(pickBeatorajaGaugeNode(gauge, 0, 100, 749)).toMatchObject({ nodeId: 'e1', state: 1 });
    expect(pickBeatorajaGaugeNode(gauge, 0, 100, 750)).toMatchObject({ nodeId: 'n1b', state: 2 });
    expect(pickBeatorajaGaugeNode(gauge, 0, 100, 1499)).toMatchObject({ nodeId: 'n1b', state: 2 });
    // Wrap: 1500 ms = exactly one cycle → back to phase 0 → lit slab.
    expect(pickBeatorajaGaugeNode(gauge, 0, 100, 1500)).toMatchObject({ nodeId: 'e1', state: 1 });
  });

  it('off cells stay on slab 0 regardless of pulse phase', () => {
    // Cell at part 0 with gauge at 0% (cell is off) → state 0 always, regardless of nowMs.
    expect(pickBeatorajaGaugeNode(gauge, 0, 0, 0)).toMatchObject({ nodeId: 'n1', state: 0 });
    expect(pickBeatorajaGaugeNode(gauge, 0, 0, 750)).toMatchObject({ nodeId: 'n1', state: 0 });
  });

  it('omitting nowMs locks the lit cell on slab 1 (no pulse)', () => {
    // Useful for tests / frozen snapshots that want a deterministic node pick.
    expect(pickBeatorajaGaugeNode(gauge, 0, 100)).toMatchObject({ nodeId: 'e1', state: 1 });
  });
});

describe('normalizeBeatorajaGauge', () => {
  it('reads `type` and `cycle` so the renderer can pick pulse vs static rendering', () => {
    const out = normalizeBeatorajaGauge({
      id: 'g',
      nodes: ['n1', 'e1'],
      type: 3,
      cycle: 1500,
      parts: 24,
    });
    expect(out).toMatchObject({ id: 'g', type: 3, cycle: 1500, parts: 24 });
  });
});
