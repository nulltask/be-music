import { afterEach, describe, expect, it } from 'vite-plus/test';
import {
  createLatencyProbe,
  disableLatencyProbe,
  enableLatencyProbe,
  estimateAudibleAtMs,
  getLatencyProbe,
  latencyProbeClockCSV,
  latencyProbeCSV,
  summarizeLatencyPresses,
  type LatencyProbeAudioClock,
  type LatencyProbePress,
} from './latency-probe.ts';

function fakeClock(overrides: Partial<LatencyProbeAudioClock> = {}): LatencyProbeAudioClock {
  return { currentTime: 10, sampleRate: 48_000, baseLatency: 0.005, outputLatency: 0.02, ...overrides };
}

/** A probe on a hand-driven clock whose periodic sampling runs only when `tick` is called. */
function manualProbe(matchWindowMs?: number) {
  let nowMs = 1000;
  const ticks: Array<() => void> = [];
  const ended: number[] = [];
  const probe = createLatencyProbe({
    now: () => nowMs,
    repeat: (callback) => {
      ticks.push(callback);
      return () => ticks.splice(ticks.indexOf(callback), 1);
    },
    onPlayEnd: (play) => ended.push(play),
    ...(matchWindowMs === undefined ? {} : { matchWindowMs }),
  });
  return {
    probe,
    ended,
    advance: (ms: number) => {
      nowMs += ms;
    },
    tick: () => ticks.forEach((callback) => callback()),
    pending: () => ticks.length,
  };
}

describe('estimateAudibleAtMs', () => {
  it('maps the start onto the performance clock through getOutputTimestamp', () => {
    const clock = fakeClock({ getOutputTimestamp: () => ({ contextTime: 9.98, performanceTime: 5000 }) });
    expect(estimateAudibleAtMs(clock, 10, 4990)).toEqual({ atMs: 5020, source: 'output-timestamp' });
  });

  it('falls back to the reported latencies without an output timestamp', () => {
    const estimate = estimateAudibleAtMs(fakeClock(), 10, 4000);
    expect(estimate.source).toBe('reported-latency');
    expect(estimate.atMs).toBeCloseTo(4025);
  });

  it('falls back while the context has not output anything yet', () => {
    const clock = fakeClock({ getOutputTimestamp: () => ({ contextTime: 0, performanceTime: 0 }) });
    expect(estimateAudibleAtMs(clock, 10.01, 4000).source).toBe('reported-latency');
    expect(estimateAudibleAtMs(clock, 10.01, 4000).atMs).toBeCloseTo(4035);
  });
});

describe('createLatencyProbe', () => {
  it('matches each keysound to the oldest press still waiting', () => {
    const { probe, advance } = manualProbe();
    probe.attachClock(fakeClock());
    probe.recordPress('KeyZ', 995);
    probe.recordPress('KeyS', 996);
    advance(2);
    probe.recordKeysoundStart(fakeClock(), 10);
    advance(1);
    probe.recordKeysoundStart(fakeClock(), 10.001);

    const [first, second] = probe.presses();
    expect(first).toMatchObject({ play: 1, code: 'KeyZ', eventAtMs: 995, handlerAtMs: 1000, keysoundAtMs: 1002 });
    expect(first?.audibleSource).toBe('reported-latency');
    expect(second).toMatchObject({
      code: 'KeyS',
      handlerAtMs: 1000,
      keysoundAtMs: 1003,
      keysoundContextSeconds: 10.001,
    });
  });

  it('leaves a press without a keysound once the match window has passed', () => {
    const { probe, advance } = manualProbe(50);
    probe.recordPress('KeyZ', 999);
    advance(60);
    probe.recordKeysoundStart(fakeClock(), 10);
    expect(probe.presses()[0]?.keysoundAtMs).toBeUndefined();
  });

  it('ignores a keysound with no press waiting', () => {
    const { probe } = manualProbe();
    probe.recordKeysoundStart(fakeClock(), 10);
    expect(probe.presses()).toEqual([]);
  });

  it('samples the clock on attach, on every interval and on detach, and reports the play ending', () => {
    const { probe, tick, pending, ended } = manualProbe();
    const stop = probe.attachClock(
      fakeClock({ getOutputTimestamp: () => ({ contextTime: 9.97, performanceTime: 4000 }) }),
    );
    tick();
    stop();
    stop();
    expect(pending()).toBe(0);
    expect(ended).toEqual([1]);
    const samples = probe.clockSamples();
    expect(samples).toHaveLength(3);
    expect(samples[0]).toEqual({
      play: 1,
      atMs: 1000,
      contextSeconds: 10,
      outputContextSeconds: 9.97,
      outputPerformanceMs: 4000,
      baseLatencyMs: 5,
      outputLatencyMs: 20,
      sampleRate: 48_000,
    });
  });

  it('counts plays and forgets presses waiting from the previous one', () => {
    const { probe } = manualProbe();
    probe.attachClock(fakeClock());
    probe.recordPress('KeyZ', 999);
    probe.attachClock(fakeClock());
    probe.recordKeysoundStart(fakeClock(), 10);
    expect(probe.presses()[0]).toMatchObject({ play: 1 });
    expect(probe.presses()[0]?.keysoundAtMs).toBeUndefined();
  });

  it('keeps at most maxRecords presses, dropping the oldest', () => {
    const probe = createLatencyProbe({ now: () => 0, maxRecords: 2 });
    probe.recordPress('KeyA', 1);
    probe.recordPress('KeyB', 2);
    probe.recordPress('KeyC', 3);
    expect(probe.presses().map((press) => press.code)).toEqual(['KeyB', 'KeyC']);
  });

  it('clears what it recorded', () => {
    const { probe } = manualProbe();
    probe.attachClock(fakeClock());
    probe.recordPress('KeyZ', 999);
    probe.clear();
    expect(probe.presses()).toEqual([]);
    expect(probe.clockSamples()).toEqual([]);
  });
});

describe('enableLatencyProbe', () => {
  afterEach(() => disableLatencyProbe());

  it('is off until enabled, and returns the same probe while on', () => {
    expect(getLatencyProbe()).toBeUndefined();
    const probe = enableLatencyProbe();
    expect(enableLatencyProbe()).toBe(probe);
    expect(getLatencyProbe()).toBe(probe);
    disableLatencyProbe();
    expect(getLatencyProbe()).toBeUndefined();
  });
});

const press = (eventAtMs: number, handler: number, keysound?: number, audible?: number): LatencyProbePress => ({
  play: 1,
  code: 'KeyZ',
  eventAtMs,
  handlerAtMs: eventAtMs + handler,
  ...(keysound === undefined ? {} : { keysoundAtMs: eventAtMs + keysound, keysoundContextSeconds: 1 }),
  ...(audible === undefined ? {} : { audibleAtMs: eventAtMs + audible, audibleSource: 'output-timestamp' as const }),
});

describe('summarizeLatencyPresses', () => {
  it('summarises each latency over the presses that have it', () => {
    const summary = summarizeLatencyPresses(
      [press(0, 1, 2, 20), press(100, 3, 4, 30), press(200, 5)],
      [
        { play: 1, atMs: 0, contextSeconds: 0, baseLatencyMs: 5, outputLatencyMs: 20, sampleRate: 48_000 },
        { play: 1, atMs: 1, contextSeconds: 0, baseLatencyMs: 5, outputLatencyMs: 22, sampleRate: 48_000 },
      ],
    );
    expect(summary.presses).toBe(3);
    expect(summary.withKeysound).toBe(2);
    expect(summary.dispatch).toMatchObject({ count: 3, minMs: 1, medianMs: 3, maxMs: 5, meanMs: 3 });
    expect(summary.dispatch?.stdevMs).toBeCloseTo(Math.sqrt(8 / 3));
    expect(summary.dispatch?.p95Ms).toBeCloseTo(4.8);
    expect(summary.keysoundStart).toMatchObject({ count: 2, medianMs: 3 });
    expect(summary.audible).toMatchObject({ count: 2, medianMs: 25 });
    expect(summary.baseLatencyMs).toBe(5);
    expect(summary.outputLatencyMs).toBe(21);
  });

  it('leaves out what nothing measured', () => {
    expect(summarizeLatencyPresses([])).toEqual({ presses: 0, withKeysound: 0 });
  });
});

describe('latencyProbeCSV', () => {
  it('writes a row per press with the derived latencies', () => {
    expect(latencyProbeCSV([press(10.12345, 1, 2.5, 20)])).toBe(
      'play,code,eventAtMs,handlerAtMs,keysoundAtMs,keysoundContextSeconds,audibleAtMs,audibleSource,dispatchMs,keysoundStartMs,audibleMs\n' +
        '1,KeyZ,10.123,11.123,12.623,1,30.123,output-timestamp,1,2.5,20\n',
    );
  });

  it('leaves the missing fields empty', () => {
    expect(latencyProbeCSV([press(0, 1)]).split('\n')[1]).toBe('1,KeyZ,0,1,,,,,1,,');
  });
});

describe('latencyProbeClockCSV', () => {
  it('writes a row per clock sample', () => {
    expect(
      latencyProbeClockCSV([
        {
          play: 2,
          atMs: 5,
          contextSeconds: 1.5,
          outputContextSeconds: 1.48,
          outputPerformanceMs: 4.5,
          sampleRate: 44_100,
        },
      ]),
    ).toBe(
      'play,atMs,contextSeconds,outputContextSeconds,outputPerformanceMs,baseLatencyMs,outputLatencyMs,sampleRate\n' +
        '2,5,1.5,1.48,4.5,,,44100\n',
    );
  });
});
