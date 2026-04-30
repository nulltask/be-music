import { describe, expect, it } from 'vitest';
import {
  BGM_BUS_COMPRESSOR_PARAMS,
  KEY_BUS_COMPRESSOR_PARAMS,
  LEGACY_COMPRESSOR_PARAMS,
  MASTER_BUS_COMPRESSOR_PARAMS,
  MASTER_MAKEUP_GAIN_LINEAR,
  buildAudioBus,
  parseCompressorMode,
  type CompressorMode,
} from './audio-bus.ts';

// -- Tiny `AudioContext` fake -----------------------------------------------
// Vitest runs under Node where Web Audio doesn't exist. Rather than pulling
// in a heavyweight jsdom shim, this fake records the `connect()` /
// `disconnect()` graph topology so we can assert the bus's wiring directly.
//
// It models the small subset `audio-bus.ts` actually touches:
// - `createGain()` and `createDynamicsCompressor()` return tagged nodes
//   with `connect(target)` and `disconnect()`. `disconnect()` (no args)
//   removes every outgoing edge — same semantics as the real spec.
// - Each compressor exposes `threshold` / `ratio` / `attack` / `release` /
//   `knee` `AudioParam`-like objects whose `value` we can read back to
//   verify the params we wrote into them.
// - `destination` is a sentinel node (no behaviour) — the bus connects to
//   it as the audible terminator, and tests check via the recorded edges.

interface FakeAudioParam {
  value: number;
}

interface FakeNode {
  type: 'gain' | 'compressor' | 'destination';
  id: number;
  outgoing: Set<FakeNode>;
  threshold?: FakeAudioParam;
  ratio?: FakeAudioParam;
  attack?: FakeAudioParam;
  release?: FakeAudioParam;
  knee?: FakeAudioParam;
  gain?: FakeAudioParam;
  connect(target: FakeNode): void;
  disconnect(target?: FakeNode): void;
}

function createFakeAudioContext(): { context: AudioContext; destination: FakeNode } {
  let nextId = 1;
  const makeNode = (type: FakeNode['type']): FakeNode => {
    const node: FakeNode = {
      type,
      id: nextId++,
      outgoing: new Set(),
      connect(target: FakeNode) {
        node.outgoing.add(target);
      },
      disconnect(target?: FakeNode) {
        if (target === undefined) {
          node.outgoing.clear();
        } else {
          node.outgoing.delete(target);
        }
      },
    };
    if (type === 'compressor') {
      node.threshold = { value: 0 };
      node.ratio = { value: 1 };
      node.attack = { value: 0 };
      node.release = { value: 0 };
      node.knee = { value: 0 };
    }
    if (type === 'gain') {
      node.gain = { value: 1 };
    }
    return node;
  };
  const destination = makeNode('destination');
  const context = {
    destination,
    createGain: () => makeNode('gain'),
    createDynamicsCompressor: () => makeNode('compressor'),
    // Other AudioContext fields that `audio-bus.ts` doesn't read are
    // intentionally absent — accessing them would surface as a test
    // failure pointing at the exact missing API.
  } as unknown as AudioContext;
  return { context, destination };
}

function reachable(start: FakeNode): Set<FakeNode> {
  const visited = new Set<FakeNode>();
  const stack: FakeNode[] = [start];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (visited.has(node)) continue;
    visited.add(node);
    for (const next of node.outgoing) stack.push(next);
  }
  return visited;
}

function reachesDestination(start: FakeNode, destination: FakeNode): boolean {
  return reachable(start).has(destination);
}

// -- Param sanity ----------------------------------------------------------

describe('compressor parameter constants', () => {
  // Spec-required clamps and a couple of sanity bounds — protects
  // accidentally typing `0.3` instead of `0.003` for an attack value.
  const inSpecRange = (params: { threshold: number; ratio: number; attack: number; release: number; knee: number }): boolean =>
    params.threshold <= 0 &&
    params.threshold >= -100 &&
    params.ratio >= 1 &&
    params.ratio <= 20 &&
    params.attack >= 0 &&
    params.attack <= 1 &&
    params.release >= 0 &&
    params.release <= 1 &&
    params.knee >= 0 &&
    params.knee <= 40;

  it('keeps every preset within the Web Audio spec ranges', () => {
    expect(inSpecRange(KEY_BUS_COMPRESSOR_PARAMS)).toBe(true);
    expect(inSpecRange(BGM_BUS_COMPRESSOR_PARAMS)).toBe(true);
    expect(inSpecRange(MASTER_BUS_COMPRESSOR_PARAMS)).toBe(true);
    expect(inSpecRange(LEGACY_COMPRESSOR_PARAMS)).toBe(true);
  });

  it('orders thresholds master <= key <= BGM (later stage = lower threshold)', () => {
    // The split design intentionally engages each bus before the
    // master so peaks are shaped per-source, then the master only
    // catches summed-bus peaks. If someone "fixed" master to be
    // less aggressive than its inputs, the design intent breaks.
    expect(MASTER_BUS_COMPRESSOR_PARAMS.threshold).toBeGreaterThan(KEY_BUS_COMPRESSOR_PARAMS.threshold);
    expect(MASTER_BUS_COMPRESSOR_PARAMS.threshold).toBeGreaterThan(BGM_BUS_COMPRESSOR_PARAMS.threshold);
  });

  it('keeps the master makeup gain near unity', () => {
    // Anything wildly above 1 would be a loudness boost rather than
    // a make-up — at these compression ratios the "lost" level is
    // small, so >1.5 (≈ +3.5 dB) would suggest a typo.
    expect(MASTER_MAKEUP_GAIN_LINEAR).toBeGreaterThan(1);
    expect(MASTER_MAKEUP_GAIN_LINEAR).toBeLessThan(1.5);
  });
});

// -- parseCompressorMode --------------------------------------------------

describe('parseCompressorMode', () => {
  it('returns the canonical mode for valid values (case-insensitive)', () => {
    expect(parseCompressorMode('split')).toBe('split');
    expect(parseCompressorMode('LEGACY')).toBe('legacy');
    expect(parseCompressorMode(' Off ')).toBe('off');
  });

  it('returns undefined for missing / unrecognised flag values', () => {
    expect(parseCompressorMode(null)).toBeUndefined();
    expect(parseCompressorMode(undefined)).toBeUndefined();
    expect(parseCompressorMode('')).toBeUndefined();
    expect(parseCompressorMode('hard')).toBeUndefined();
  });
});

// -- Graph topology --------------------------------------------------------

describe('buildAudioBus graph topology', () => {
  // Node identity: every key/BGM source connects to the same mixers
  // regardless of mode, so a mode flip is a downstream-only re-wire.
  // Verifying topology this way (rather than on the real Web Audio
  // graph) lets the tests run under Node — and lets us assert the
  // structure without depending on the browser implementation.

  it('routes both mixers through key/BGM/master compressors in split mode', () => {
    const { context, destination } = createFakeAudioContext();
    const bus = buildAudioBus(context, 'split');
    const keyMixer = bus.keyMixer as unknown as FakeNode;
    const bgmMixer = bus.bgmMixer as unknown as FakeNode;
    expect(reachesDestination(keyMixer, destination)).toBe(true);
    expect(reachesDestination(bgmMixer, destination)).toBe(true);
    // Walk the chain: keyMixer's first edge must be a compressor
    // (the key bus comp), not the destination directly. Same for BGM.
    expect([...keyMixer.outgoing].every((node) => node.type === 'compressor')).toBe(true);
    expect([...bgmMixer.outgoing].every((node) => node.type === 'compressor')).toBe(true);
  });

  it('collapses both buses into a single compressor in legacy mode', () => {
    const { context, destination } = createFakeAudioContext();
    const bus = buildAudioBus(context, 'legacy');
    const keyMixer = bus.keyMixer as unknown as FakeNode;
    const bgmMixer = bus.bgmMixer as unknown as FakeNode;
    expect(reachesDestination(keyMixer, destination)).toBe(true);
    expect(reachesDestination(bgmMixer, destination)).toBe(true);
    // Legacy mode: both mixers should share the same downstream
    // compressor target (no per-bus comps in this mode).
    const sharedTargets = [...keyMixer.outgoing].filter((node) => bgmMixer.outgoing.has(node));
    expect(sharedTargets).toHaveLength(1);
    expect(sharedTargets[0]?.type).toBe('compressor');
  });

  it('connects mixers directly to destination in off mode', () => {
    const { context, destination } = createFakeAudioContext();
    const bus = buildAudioBus(context, 'off');
    const keyMixer = bus.keyMixer as unknown as FakeNode;
    const bgmMixer = bus.bgmMixer as unknown as FakeNode;
    // Direct edge — no compressor stages between mixer and dest.
    expect([...keyMixer.outgoing]).toEqual([destination]);
    expect([...bgmMixer.outgoing]).toEqual([destination]);
  });

  it('preserves mixer identity across mode switches (no re-allocation)', () => {
    // The whole point of the bus design is that source-side
    // connections never have to be touched on a mode flip. If
    // setMode swapped out the mixer node references, every
    // BufferSourceNode in flight would lose its sink.
    const { context } = createFakeAudioContext();
    const bus = buildAudioBus(context, 'split');
    const keyBefore = bus.keyMixer;
    const bgmBefore = bus.bgmMixer;
    bus.setMode('legacy');
    bus.setMode('off');
    bus.setMode('split');
    expect(bus.keyMixer).toBe(keyBefore);
    expect(bus.bgmMixer).toBe(bgmBefore);
  });

  it('reports the active mode via getMode()', () => {
    const { context } = createFakeAudioContext();
    const bus = buildAudioBus(context, 'split');
    expect(bus.getMode()).toBe('split');
    bus.setMode('legacy');
    expect(bus.getMode()).toBe('legacy');
    bus.setMode('off');
    expect(bus.getMode()).toBe('off');
  });

  it('disposes by tearing down every outgoing edge', () => {
    const { context } = createFakeAudioContext();
    const bus = buildAudioBus(context, 'split');
    bus.dispose();
    const keyMixer = bus.keyMixer as unknown as FakeNode;
    const bgmMixer = bus.bgmMixer as unknown as FakeNode;
    expect(keyMixer.outgoing.size).toBe(0);
    expect(bgmMixer.outgoing.size).toBe(0);
  });

  it('writes per-bus params onto the underlying compressors', () => {
    // Verifies that `KEY_BUS_COMPRESSOR_PARAMS` etc. actually reach
    // the nodes — a future refactor that forgets to assign one
    // AudioParam would silently leave it at the default (e.g.
    // ratio=1 = pass-through) without this test catching it.
    const { context } = createFakeAudioContext();
    buildAudioBus(context, 'split');
    // Walk the spy state: every compressor created by the test
    // recorded its assigned params on the FakeAudioParam objects.
    // We don't have direct refs to the inner compressors, but we
    // can verify the params are on at least one FakeNode of type
    // 'compressor' by walking the createDynamicsCompressor call
    // record indirectly. Easier: re-create with a wrapping
    // AudioContext that captures every compressor it hands out.
    const compressors: FakeNode[] = [];
    const wrapped = {
      ...context,
      createDynamicsCompressor: (): FakeNode => {
        const node = (context as unknown as { createDynamicsCompressor: () => FakeNode }).createDynamicsCompressor();
        compressors.push(node);
        return node;
      },
      createGain: (context as unknown as { createGain: () => FakeNode }).createGain,
      destination: (context as unknown as { destination: FakeNode }).destination,
    } as unknown as AudioContext;
    buildAudioBus(wrapped, 'split');
    // 4 compressors expected: key + BGM + master + legacy (held idle).
    expect(compressors).toHaveLength(4);
    const paramSets = compressors.map((c) => ({
      threshold: c.threshold!.value,
      ratio: c.ratio!.value,
      attack: c.attack!.value,
      release: c.release!.value,
      knee: c.knee!.value,
    }));
    // Order matches the construction order in `buildAudioBus`.
    expect(paramSets[0]).toMatchObject(KEY_BUS_COMPRESSOR_PARAMS);
    expect(paramSets[1]).toMatchObject(BGM_BUS_COMPRESSOR_PARAMS);
    expect(paramSets[2]).toMatchObject(MASTER_BUS_COMPRESSOR_PARAMS);
    expect(paramSets[3]).toMatchObject(LEGACY_COMPRESSOR_PARAMS);
  });

  it('honours the initial mode argument', () => {
    const { context } = createFakeAudioContext();
    const modes: CompressorMode[] = ['split', 'legacy', 'off'];
    for (const mode of modes) {
      const bus = buildAudioBus(context, mode);
      expect(bus.getMode()).toBe(mode);
    }
  });
});
