import { expect, test } from './support.ts';

type Probe = { duration: number; rate: number; leftPeak: number; rightPeak: number; frequency: number };

for (const mode of ['pitch', 'keep-pitch'] as const) {
  test(`WAVCMD and EXWAV prepare independent slot PCM before ${mode} tempo playback`, async ({ player }) => {
    await player.page.addInitScript(() => {
      const target = window as unknown as { wavEffectProbes: Probe[] };
      target.wavEffectProbes = [];
      // oxlint-disable-next-line typescript/unbound-method -- Reflect.apply below restores the source node as this.
      const original = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (...args: Parameters<typeof original>): void {
        if (this.buffer) {
          const left = this.buffer.getChannelData(0);
          const right = this.buffer.getChannelData(this.buffer.numberOfChannels > 1 ? 1 : 0);
          let leftPeak = 0,
            rightPeak = 0;
          for (let index = 0; index < left.length; index++) {
            leftPeak = Math.max(leftPeak, Math.abs(left[index]!));
            rightPeak = Math.max(rightPeak, Math.abs(right[index]!));
          }
          // The right channel's pitch by autocorrelation over its middle half. Counting zero crossings across the whole
          // buffer drops cycles at the time-stretch splices, by an amount that depends on the context's sample rate
          // (#878).
          const rate = this.buffer.sampleRate;
          const from = Math.floor(right.length / 4),
            to = Math.floor((right.length * 3) / 4);
          const correlation = (lag: number): number => {
            let sum = 0;
            for (let index = from; index < to - lag; index++) sum += right[index]! * right[index + lag]!;
            return sum / Math.max(1, to - lag - from);
          };
          let bestLag = 0,
            best = -Infinity;
          for (let lag = Math.floor(rate / 3000); lag <= Math.ceil(rate / 1000); lag++) {
            const value = correlation(lag);
            if (value > best) [best, bestLag] = [value, lag];
          }
          const [before, after] = [correlation(bestLag - 1), correlation(bestLag + 1)];
          const curvature = before - 2 * best + after;
          const lag = bestLag + (curvature < 0 ? (0.5 * (before - after)) / curvature : 0);
          const frequency = lag > 0 ? rate / lag : 0;
          target.wavEffectProbes.push({
            duration: this.buffer.duration,
            rate: this.playbackRate.value,
            leftPeak,
            rightPeak,
            frequency,
          });
        }
        Reflect.apply(original, this, args);
      };
    });
    await player.open({
      'be-music.play-tempo': JSON.stringify({
        tempoEnabled: true,
        tempoPercent: 20,
        tempoPitchMode: mode,
        tempoStretchAlgorithm: 'wsola',
      }),
    });
    const loads = (await player.state()).loads;
    await player.page.evaluate(() => {
      const rate = 16000,
        frames = 4000;
      const wav = new Uint8Array(44 + frames * 4);
      const view = new DataView(wav.buffer);
      for (const [offset, text] of [
        [0, 'RIFF'],
        [8, 'WAVE'],
        [12, 'fmt '],
        [36, 'data'],
      ] as const)
        wav.set(new TextEncoder().encode(text), offset);
      view.setUint32(4, wav.length - 8, true);
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 2, true);
      view.setUint32(24, rate, true);
      view.setUint32(28, rate * 4, true);
      view.setUint16(32, 4, true);
      view.setUint16(34, 16, true);
      view.setUint32(40, frames * 4, true);
      for (let index = 0; index < frames; index++) {
        const value = Math.sin((2 * Math.PI * 440 * index) / rate);
        view.setInt16(44 + index * 4, Math.round(value * 16000), true);
        view.setInt16(46 + index * 4, Math.round(value * 8000), true);
      }
      const chart = [
        '#TITLE WAV Effects',
        '#BPM 120',
        '#WAV01 missing.wav',
        '#EXWAV01 pf 10000 32000 stereo.wav',
        '#EXWAV02 p -10000 stereo.wav',
        '#WAVCMD 00 01 72',
        '#WAVCMD 02 01 100',
        '#00111:01',
        '#00112:02',
        '#00211:01',
      ].join('\n');
      const event = new Event('drop', { cancelable: true });
      Object.defineProperty(event, 'dataTransfer', {
        value: {
          items: [],
          types: ['Files'],
          files: [new File([chart], 'effects.bms'), new File([wav], 'stereo.wav')],
        },
      });
      window.dispatchEvent(event);
    });
    await player.waitFor((state) => state.loads > loads && !state.loading, 'effect chart import');
    await player.setOption(['Play options'], 'Auto play', true);
    await player.key('Enter');
    const result = await player.waitForResult(0);
    expect(result.results[0]!.judged.pgreat).toBe(3);
    const probes = await player.page.evaluate(
      () => (window as unknown as { wavEffectProbes: Probe[] }).wavEffectProbes,
    );
    const expectedDuration = 0.05 / (mode === 'keep-pitch' ? 1.2 : 1);
    const effected = probes.filter(
      (probe) => Math.abs(probe.duration - expectedDuration) < 0.001 && probe.leftPeak === 0 && probe.rightPeak > 0.1,
    );
    expect(effected).toHaveLength(2);
    for (const probe of effected) {
      expect(probe.rate).toBeCloseTo(mode === 'pitch' ? 1.2 : 1, 5);
      expect(probe.frequency).toBeGreaterThan(1650);
      expect(probe.frequency).toBeLessThan(1850);
    }
    expect(
      probes.some(
        (probe) =>
          probe.leftPeak > 0.2 &&
          probe.rightPeak === 0 &&
          Math.abs(probe.duration - 0.25 / (mode === 'keep-pitch' ? 1.2 : 1)) < 0.001,
      ),
    ).toBe(true);
  });
}
