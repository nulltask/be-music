import { createHash } from 'node:crypto';
import { expect, test } from './support.ts';

test('NONSTOP keeps fractional VOLWAV times WAVCMD gain on both stage voices', async ({ player }) => {
  await player.page.addInitScript(() => {
    const connections = new WeakMap<AudioNode, AudioNode>();
    const output = window as unknown as { stageVolumeProbes: number[] };
    output.stageVolumeProbes = [];
    // oxlint-disable-next-line typescript/unbound-method -- Each captured original is invoked with its node as this.
    const originalConnect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (this: AudioNode, ...args: unknown[]): unknown {
      if (args[0] instanceof AudioNode) connections.set(this, args[0]);
      return Reflect.apply(originalConnect, this, args);
    } as typeof originalConnect;
    // oxlint-disable-next-line typescript/unbound-method -- Reflect.apply restores the source node as this.
    const originalStart = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args: Parameters<typeof originalStart>): void {
      const target = connections.get(this);
      if (this.buffer && Math.abs(this.buffer.duration - 0.25) < 0.001 && target instanceof GainNode)
        output.stageVolumeProbes.push(target.gain.value);
      Reflect.apply(originalStart, this, args);
    };
  });
  await player.open();
  const a = '#TITLE Quiet stage\n#BPM 120\n#VOLWAV 77\n#WAV01 tone.wav\n#WAVCMD 01 01 33\n#00111:01\n#00319:01\n';
  const b = '#TITLE Loud stage\n#BPM 120\n#VOLWAV 141\n#WAV01 tone.wav\n#WAVCMD 01 01 50\n#00211:01\n#00619:01\n';
  const before = (await player.state()).loads;
  await player.page.evaluate(
    ({ a, b }) => {
      const frames = 4000,
        rate = 16000;
      const bytes = new Uint8Array(44 + frames * 4);
      const view = new DataView(bytes.buffer);
      for (const [offset, text] of [
        [0, 'RIFF'],
        [8, 'WAVE'],
        [12, 'fmt '],
        [36, 'data'],
      ] as const)
        bytes.set(new TextEncoder().encode(text), offset);
      view.setUint32(4, bytes.length - 8, true);
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 2, true);
      view.setUint32(24, rate, true);
      view.setUint32(28, rate * 4, true);
      view.setUint16(32, 4, true);
      view.setUint16(34, 16, true);
      view.setUint32(40, frames * 4, true);
      for (let frame = 0; frame < frames; frame++) {
        const value = Math.round(Math.sin((2 * Math.PI * 440 * frame) / rate) * 16000);
        view.setInt16(44 + frame * 4, value, true);
        view.setInt16(46 + frame * 4, value, true);
      }
      const files = [new File([a], 'quiet.bms'), new File([b], 'loud.bms'), new File([bytes], 'tone.wav')];
      for (const file of files) Object.defineProperty(file, 'webkitRelativePath', { value: file.name });
      const event = new Event('drop', { cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: { items: [], files, types: ['Files'] } });
      window.dispatchEvent(event);
    },
    { a, b },
  );
  await player.waitFor((state) => state.loads > before && !state.loading, 'stage audio charts');
  const hashes = [a, b].map((text) => createHash('md5').update(text).digest('hex')).join('');
  await player.dropText(
    'Volumes.lr2crs',
    `<courselist><course><title>Volume NONSTOP</title><line>7</line><type>1</type><hash>${'0'.repeat(32)}${hashes}</hash></course></courselist>`,
  );
  await player.openFolder('Volumes');
  await player.setOption(['Play options'], 'Auto play', true);
  await player.key('Enter');
  const result = await player.waitForResult(0);
  expect(result.results[0]!.judged.pgreat).toBe(4);
  const gains = await player.page.evaluate(
    () => (window as unknown as { stageVolumeProbes: number[] }).stageVolumeProbes,
  );
  expect(gains.some((gain) => Math.abs(gain - 0.77 * 0.33) < 1e-7)).toBe(true);
  expect(gains.some((gain) => Math.abs(gain - 1.41 * 0.5) < 1e-7)).toBe(true);
});
