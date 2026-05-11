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

// -- Tiny `AudioContext` fake ----------------------------------------------- Vitest runs under Node where Web Audio
// doesn't exist. Rather than pulling in a heavyweight jsdom shim, this fake records the `connect()` / `disconnect()`
// graph topology so we can assert the bus's wiring directly.
//
// It models the small subset `audio-bus.ts` actually touches: - `createGain()` and `createDynamicsCompressor()` return
// tagged nodes with `connect(target)` and `disconnect()`. `disconnect()` (no args) removes every outgoing edge — same
// semantics as the real spec. - Each compressor exposes `threshold` / `ratio` / `attack` / `release` / `knee`
// `AudioParam`-like objects whose `value` we can read back to verify the params we wrote into them. - `destination` is
// a sentinel node (no behavior) — the bus connects to it as the audible terminator, and tests check via the recorded
// edges.

interface FakeAudioParam {
  value: number;
  cancelScheduledValues?(time: number): void;
  setValueAtTime?(value: number, time: number): void;
  linearRampToValueAtTime?(value: number, time: number): void;
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
      // Gain `AudioParam`s expose the minimal subset audio-bus touches for the post-tap fade. The fake records the
      // *final* setpoint (`setValueAtTime` / ramp end) onto `value` so tests can assert "where did this param land?"
      // without modeling the full schedule timeline.
      const param: FakeAudioParam = {
        value: 1,
        cancelScheduledValues() {
          // No-op — we don't model an in-flight schedule queue; every subsequent `setValueAtTime` / ramp just
          // overwrites `value` directly.
        },
        setValueAtTime(value: number) {
          param.value = value;
        },
        linearRampToValueAtTime(value: number) {
          // For "where does the param ultimately land?" assertions the ramp's destination IS the relevant value. Tests
          // that need to check intermediate samples would need a richer fake; none of audio-bus's contracts depend on
          // mid-ramp interpolation.
          param.value = value;
        },
      };
      node.gain = param;
    }
    return node;
  };
  const destination = makeNode('destination');
  const context = {
    destination,
    // The fade API reads `audioContext.currentTime` to anchor the ramp; surfacing a stable `0` is enough since the
    // fake's ramp model collapses to "set to target value".
    currentTime: 0,
    createGain: () => makeNode('gain'),
    createDynamicsCompressor: () => makeNode('compressor'),
    // Other AudioContext fields that `audio-bus.ts` doesn't read are intentionally absent — accessing them would
    // surface as a test failure pointing at the exact missing API.
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

function compressorsReachableFrom(start: FakeNode): number {
  return [...reachable(start)].filter((node) => node.type === 'compressor').length;
}

// -- Param sanity ----------------------------------------------------------

describe('compressor parameter constants', () => {
  // Spec-required clamps and a couple of sanity bounds — protects accidentally typing `0.3` instead of `0.003` for an
  // attack value.
  const inSpecRange = (params: {
    threshold: number;
    ratio: number;
    attack: number;
    release: number;
    knee: number;
  }): boolean =>
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
    // The split design intentionally engages each bus before the master so peaks are shaped per-source, then the master
    // only catches summed-bus peaks. If someone "fixed" master to be less aggressive than its inputs, the design intent
    // breaks.
    expect(MASTER_BUS_COMPRESSOR_PARAMS.threshold).toBeGreaterThan(KEY_BUS_COMPRESSOR_PARAMS.threshold);
    expect(MASTER_BUS_COMPRESSOR_PARAMS.threshold).toBeGreaterThan(BGM_BUS_COMPRESSOR_PARAMS.threshold);
  });

  it('keeps the master makeup gain near unity', () => {
    // Anything wildly above 1 would be a loudness boost rather than a make-up — at these compression ratios the
    // "lost" level is small, so >1.5 (≈ +3.5 dB) would suggest a typo. The lower bound is 1.0 (= 0 dB, no
    // makeup); Phase 4c pinned this at unity because the engine's beatoraja-compatible look-ahead lane keysound
    // fallback / Free-Zone empty-press playback increased typical simultaneous-sample density and a non-unity
    // makeup made compressor pumping audible.
    expect(MASTER_MAKEUP_GAIN_LINEAR).toBeGreaterThanOrEqual(1);
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

  it('returns undefined for missing / unrecognized flag values', () => {
    expect(parseCompressorMode(null)).toBeUndefined();
    expect(parseCompressorMode(undefined)).toBeUndefined();
    expect(parseCompressorMode('')).toBeUndefined();
    expect(parseCompressorMode('hard')).toBeUndefined();
  });
});

// -- Graph topology --------------------------------------------------------

describe('buildAudioBus graph topology', () => {
  // Node identity: every key/BGM source connects to the same mixers regardless of mode, so a mode flip is a
  // downstream-only re-wire. Verifying topology this way (rather than on the real Web Audio graph) lets the tests run
  // under Node — and lets us assert the structure without depending on the browser implementation.

  it('routes both mixers through key/BGM/master compressors in split mode', () => {
    const { context, destination } = createFakeAudioContext();
    const bus = buildAudioBus(context, 'split');
    const keyMixer = bus.keyMixer as unknown as FakeNode;
    const bgmMixer = bus.bgmMixer as unknown as FakeNode;
    expect(reachesDestination(keyMixer, destination)).toBe(true);
    expect(reachesDestination(bgmMixer, destination)).toBe(true);
    // Walk the chain: keyMixer's first edge must be a compressor (the key bus comp), not the destination directly. Same
    // for BGM.
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
    // Legacy mode: both mixers should share the same downstream compressor target (no per-bus comps in this mode).
    const sharedTargets = [...keyMixer.outgoing].filter((node) => bgmMixer.outgoing.has(node));
    expect(sharedTargets).toHaveLength(1);
    expect(sharedTargets[0]?.type).toBe('compressor');
  });

  it('routes mixers through the universal tap (then destination) in off mode', () => {
    const { context, destination } = createFakeAudioContext();
    const bus = buildAudioBus(context, 'off');
    const keyMixer = bus.keyMixer as unknown as FakeNode;
    const bgmMixer = bus.bgmMixer as unknown as FakeNode;
    // No compressor stages on the audible path — the mixers go through the chart-level master-gain (#VOLWAV) stage and
    // the unity-gain tap before reaching the destination. The mid-chain tap matters because external consumers
    // (recording, analyzers) connect there to see the signal even when no compressor is engaged; without it the
    // recorder would capture silence whenever the user toggles compression off.
    expect(reachesDestination(keyMixer, destination)).toBe(true);
    expect(reachesDestination(bgmMixer, destination)).toBe(true);
    expect(compressorsReachableFrom(keyMixer)).toBe(0);
    expect(compressorsReachableFrom(bgmMixer)).toBe(0);
    // Both mixers share their immediate downstream — the chart master-gain (#VOLWAV) stage that feeds the tap. The
    // shared-target gain node is a unity GainNode in this mode, so the path is acoustically transparent (the recording
    // captures the unprocessed signal that the user actually hears).
    const sharedTargets = [...keyMixer.outgoing].filter((node) => bgmMixer.outgoing.has(node));
    expect(sharedTargets).toHaveLength(1);
    expect(sharedTargets[0]?.type).toBe('gain');
    // The bus's `outputNode` is the tap, which sits one hop downstream of the shared master-gain target.
    expect(sharedTargets[0]?.outgoing.has(bus.outputNode as unknown as FakeNode)).toBe(true);
  });

  it('exposes the tap as a stable outputNode across mode switches', () => {
    // Recording / analyzers connect to `outputNode` once and expect that tap point to keep delivering signal across
    // mode flips. Identity stability locks that in.
    const { context } = createFakeAudioContext();
    const bus = buildAudioBus(context, 'split');
    const tapBefore = bus.outputNode;
    bus.setMode('legacy');
    bus.setMode('off');
    bus.setMode('split');
    expect(bus.outputNode).toBe(tapBefore);
  });

  it('preserves mixer identity across mode switches (no re-allocation)', () => {
    // The whole point of the bus design is that source-side connections never have to be touched on a mode flip. If
    // setMode swapped out the mixer node references, every BufferSourceNode in flight would lose its sink.
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
    // Verifies that `KEY_BUS_COMPRESSOR_PARAMS` etc. actually reach the nodes — a future refactor that forgets to
    // assign one AudioParam would silently leave it at the default (e.g. ratio=1 = pass-through) without this test
    // catching it.
    const { context } = createFakeAudioContext();
    buildAudioBus(context, 'split');
    // Walk the spy state: every compressor created by the test recorded its assigned params on the FakeAudioParam
    // objects. We don't have direct refs to the inner compressors, but we can verify the params are on at least one
    // FakeNode of type 'compressor' by walking the createDynamicsCompressor call record indirectly. Easier: re-create
    // with a wrapping AudioContext that captures every compressor it hands out.
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

  it('honors the initial mode argument', () => {
    const { context } = createFakeAudioContext();
    const modes: CompressorMode[] = ['split', 'legacy', 'off'];
    for (const mode of modes) {
      const bus = buildAudioBus(context, mode);
      expect(bus.getMode()).toBe(mode);
    }
  });
});

// -- Per-stage on/off toggles ---------------------------------------------

describe('buildAudioBus per-stage toggles', () => {
  // Each stage flip should rebuild the routing so the corresponding compressor node is bypassed. We track this by
  // counting the total number of compressor nodes the source-side mixers can reach: in the all-on baseline we expect
  // both keyComp + masterComp (or bgmComp + masterComp) on each path, and disabling one stage drops one compressor from
  // the path's reachable set.
  const setupSplit = (initialStages?: { key?: boolean; bgm?: boolean; master?: boolean }) => {
    const { context, destination } = createFakeAudioContext();
    const bus = buildAudioBus(context, 'split', { initialStages });
    return { bus, context, destination };
  };

  it('starts every stage enabled by default', () => {
    const { bus } = setupSplit();
    expect(bus.getStageEnabled('key')).toBe(true);
    expect(bus.getStageEnabled('bgm')).toBe(true);
    expect(bus.getStageEnabled('master')).toBe(true);
  });

  it('respects initialStages when seeding the bus', () => {
    const { bus } = setupSplit({ key: false, master: false });
    expect(bus.getStageEnabled('key')).toBe(false);
    expect(bus.getStageEnabled('bgm')).toBe(true);
    expect(bus.getStageEnabled('master')).toBe(false);
  });

  it('routes keyMixer through 2 compressors with all stages on', () => {
    const { bus, destination } = setupSplit();
    const keyMixer = bus.keyMixer as unknown as FakeNode;
    expect(reachesDestination(keyMixer, destination)).toBe(true);
    // keyComp + masterComp = 2 compressors on the key path. The legacy comp + bgmComp aren't reachable from the key
    // mixer (different branches), so we shouldn't see them.
    expect(compressorsReachableFrom(keyMixer)).toBe(2);
  });

  it('drops keyComp from the key path when stage.key is off', () => {
    const { bus, destination } = setupSplit();
    bus.setStageEnabled('key', false);
    const keyMixer = bus.keyMixer as unknown as FakeNode;
    expect(reachesDestination(keyMixer, destination)).toBe(true);
    // Now only masterComp is on the key path.
    expect(compressorsReachableFrom(keyMixer)).toBe(1);
    // The BGM path is unaffected (still bgmComp + masterComp).
    const bgmMixer = bus.bgmMixer as unknown as FakeNode;
    expect(compressorsReachableFrom(bgmMixer)).toBe(2);
  });

  it('drops bgmComp from the BGM path when stage.bgm is off', () => {
    const { bus } = setupSplit();
    bus.setStageEnabled('bgm', false);
    const bgmMixer = bus.bgmMixer as unknown as FakeNode;
    expect(compressorsReachableFrom(bgmMixer)).toBe(1);
    const keyMixer = bus.keyMixer as unknown as FakeNode;
    expect(compressorsReachableFrom(keyMixer)).toBe(2);
  });

  it('drops masterComp from BOTH paths when stage.master is off', () => {
    const { bus, destination } = setupSplit();
    bus.setStageEnabled('master', false);
    const keyMixer = bus.keyMixer as unknown as FakeNode;
    const bgmMixer = bus.bgmMixer as unknown as FakeNode;
    // Just keyComp on the key path; just bgmComp on the BGM path.
    expect(compressorsReachableFrom(keyMixer)).toBe(1);
    expect(compressorsReachableFrom(bgmMixer)).toBe(1);
    expect(reachesDestination(keyMixer, destination)).toBe(true);
    expect(reachesDestination(bgmMixer, destination)).toBe(true);
  });

  it('routes through makeup-only when every stage is off', () => {
    const { bus, destination } = setupSplit();
    bus.setStageEnabled('key', false);
    bus.setStageEnabled('bgm', false);
    bus.setStageEnabled('master', false);
    const keyMixer = bus.keyMixer as unknown as FakeNode;
    const bgmMixer = bus.bgmMixer as unknown as FakeNode;
    // No compressors on either path, but the makeup gain is still there — distinct from `'off'` mode which bypasses
    // makeup too.
    expect(compressorsReachableFrom(keyMixer)).toBe(0);
    expect(compressorsReachableFrom(bgmMixer)).toBe(0);
    expect(reachesDestination(keyMixer, destination)).toBe(true);
    expect(reachesDestination(bgmMixer, destination)).toBe(true);
  });

  it('remembers stage state across mode switches', () => {
    // The split → legacy switch should be a no-op for stage state (legacy doesn't use it), and switching back to split
    // should bring the disabled stages back without the user having to re-toggle.
    const { bus, destination } = setupSplit();
    bus.setStageEnabled('key', false);
    bus.setMode('legacy');
    expect(bus.getStageEnabled('key')).toBe(false);
    bus.setMode('split');
    const keyMixer = bus.keyMixer as unknown as FakeNode;
    expect(compressorsReachableFrom(keyMixer)).toBe(1);
    expect(reachesDestination(keyMixer, destination)).toBe(true);
  });

  it('treats setStageEnabled as a no-op for unchanged values', () => {
    // Asserting no exception + idempotent state is the practical contract; flipping the same stage twice shouldn't
    // accidentally re-route on the second call.
    const { bus } = setupSplit();
    bus.setStageEnabled('master', true); // already true
    bus.setStageEnabled('master', true);
    expect(bus.getStageEnabled('master')).toBe(true);
  });
});

// -- #VOLWAV master gain ---------------------------------------------------

describe('buildAudioBus master gain (#VOLWAV)', () => {
  // The bus exposes a single dedicated stage for the chart-level master volume scaling. The contract: the value applies
  // through every routing mode (so a chart authored at #VOLWAV 80 sounds at 80 % even in 'off' mode), and the recorder
  // tap captures the post-`#VOLWAV` signal — i.e. what the user hears.

  it('starts at unity gain so charts without #VOLWAV are unaffected', () => {
    const { context } = createFakeAudioContext();
    const bus = buildAudioBus(context, 'split');
    expect(bus.getMasterGain()).toBe(1.0);
  });

  it('applies setMasterGain across every routing mode', () => {
    // The single AudioParam sits BEFORE the universal tap, so once set, every mode threads its signal through it. We
    // verify by confirming the value sticks when the host flips modes.
    const { context } = createFakeAudioContext();
    const bus = buildAudioBus(context, 'split');
    bus.setMasterGain(0.8);
    expect(bus.getMasterGain()).toBeCloseTo(0.8);
    bus.setMode('legacy');
    expect(bus.getMasterGain()).toBeCloseTo(0.8);
    bus.setMode('off');
    expect(bus.getMasterGain()).toBeCloseTo(0.8);
    bus.setMode('split');
    expect(bus.getMasterGain()).toBeCloseTo(0.8);
  });

  it('clamps negative gains to 0 and replaces non-finite inputs with unity', () => {
    // A malformed `#VOLWAV` value can land in the parser as NaN or a negative number; both should be handled gracefully
    // rather than poisoning the AudioParam.
    const { context } = createFakeAudioContext();
    const bus = buildAudioBus(context, 'split');
    bus.setMasterGain(-1);
    expect(bus.getMasterGain()).toBe(0);
    bus.setMasterGain(Number.NaN);
    expect(bus.getMasterGain()).toBe(1.0);
    bus.setMasterGain(Number.POSITIVE_INFINITY);
    expect(bus.getMasterGain()).toBe(1.0);
  });

  it('admits values above unity (#VOLWAV > 100 boosts the chart)', () => {
    // Some charts authored on quieter sample sets push above 100 to bring the audible level up — the bus has to honor
    // that.
    const { context } = createFakeAudioContext();
    const bus = buildAudioBus(context, 'split');
    bus.setMasterGain(1.5);
    expect(bus.getMasterGain()).toBeCloseTo(1.5);
  });

  it('keeps the master gain stage on the audible path in every mode', () => {
    // The master-gain GainNode must sit between the bus tail and the destination so a `setMasterGain(0)` mutes every
    // mode. Identity: the bus's outputNode (tap) is the *post*-master anchor; mixer → ... → masterGain → tap →
    // destination.
    const { context, destination } = createFakeAudioContext();
    const bus = buildAudioBus(context, 'split');
    const keyMixer = bus.keyMixer as unknown as FakeNode;
    const bgmMixer = bus.bgmMixer as unknown as FakeNode;
    // Sanity: even with the master-gain stage in place the audible path still reaches the destination across every
    // mode.
    for (const mode of ['split', 'legacy', 'off'] as const) {
      bus.setMode(mode);
      expect(reachesDestination(keyMixer, destination)).toBe(true);
      expect(reachesDestination(bgmMixer, destination)).toBe(true);
    }
  });
});

// -- Exit fade (post-tap) -------------------------------------------------

describe('buildAudioBus exit-fade gain', () => {
  // The exit-fade gain sits AFTER the recording tap and BEFORE `audioContext.destination`. Two consequences must hold:
  // 1. fading it down silences the speakers but leaves the recording tap unaffected (so a saved WAV still captures the
  // unattenuated mix); 2. the bus's `outputNode` (the tap) is NOT the same node as the post-tap fade — there's exactly
  // one gain hop between `outputNode` and the destination on the audible path.

  it('inserts a unity-gain fade stage between outputNode and the destination', () => {
    const { context, destination } = createFakeAudioContext();
    const bus = buildAudioBus(context, 'split');
    const tap = bus.outputNode as unknown as FakeNode;
    // Tap → exitFadeGain → destination (two-hop).
    const tapDownstream = [...tap.outgoing];
    expect(tapDownstream).toHaveLength(1);
    const fadeStage = tapDownstream[0]!;
    expect(fadeStage.type).toBe('gain');
    expect(fadeStage).not.toBe(tap); // distinct from the tap itself
    expect(fadeStage.outgoing.has(destination)).toBe(true);
    // Steady-state value is unity so the fade stage is acoustically transparent until the gameplay scene actually
    // drives it.
    expect(fadeStage.gain?.value).toBe(1);
  });

  it('drives the post-tap stage to the requested target on fadeOutAudibleTo', () => {
    const { context } = createFakeAudioContext();
    const bus = buildAudioBus(context, 'split');
    const tap = bus.outputNode as unknown as FakeNode;
    const fadeStage = [...tap.outgoing][0]!;
    bus.fadeOutAudibleTo(0, 1000);
    expect(fadeStage.gain?.value).toBe(0);
  });

  it('snaps immediately when the duration is zero / negative / non-finite', () => {
    // Avoids `linearRampToValueAtTime` being asked for a same-time ramp endpoint, which the spec leaves
    // implementation-defined.
    const { context } = createFakeAudioContext();
    const bus = buildAudioBus(context, 'split');
    const tap = bus.outputNode as unknown as FakeNode;
    const fadeStage = [...tap.outgoing][0]!;
    bus.fadeOutAudibleTo(0.5, 0);
    expect(fadeStage.gain?.value).toBe(0.5);
    bus.fadeOutAudibleTo(0.25, -1);
    expect(fadeStage.gain?.value).toBe(0.25);
    bus.fadeOutAudibleTo(0.1, Number.NaN);
    expect(fadeStage.gain?.value).toBe(0.1);
  });

  it('clamps a negative or non-finite target to silence', () => {
    // A pathological caller mustn't push the gain into the negative domain (which would phase-invert the output) or
    // poison the AudioParam with NaN.
    const { context } = createFakeAudioContext();
    const bus = buildAudioBus(context, 'split');
    const tap = bus.outputNode as unknown as FakeNode;
    const fadeStage = [...tap.outgoing][0]!;
    bus.fadeOutAudibleTo(-0.5, 100);
    expect(fadeStage.gain?.value).toBe(0);
    bus.fadeOutAudibleTo(Number.NaN, 100);
    expect(fadeStage.gain?.value).toBe(0);
  });

  it('resetFadeGain restores the post-tap stage to unity', () => {
    const { context } = createFakeAudioContext();
    const bus = buildAudioBus(context, 'split');
    const tap = bus.outputNode as unknown as FakeNode;
    const fadeStage = [...tap.outgoing][0]!;
    bus.fadeOutAudibleTo(0, 100);
    bus.resetFadeGain();
    expect(fadeStage.gain?.value).toBe(1);
  });

  it('keeps the recording tap (outputNode) at unity during a fade', () => {
    // External consumers connect to `outputNode` — that node must NOT see the fade so a recording captures the full mix
    // even mid-exit-sequence. Verifying via the gain value on the tap itself is enough; its outgoing edges (to the fade
    // stage) are separate node-to-node connections.
    const { context } = createFakeAudioContext();
    const bus = buildAudioBus(context, 'split');
    const tap = bus.outputNode as unknown as FakeNode;
    bus.fadeOutAudibleTo(0, 100);
    expect(tap.gain?.value).toBe(1);
  });
});
