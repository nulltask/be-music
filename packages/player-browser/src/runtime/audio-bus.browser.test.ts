import { expect, test } from 'vite-plus/test';
import { buildAudioBus } from './audio-bus.ts';
import { getMasterVolume, masterOutput, setMasterVolume } from './master-volume.ts';

test('mode changes keep both inputs connected and the playback fade leaves the recording signal intact', async () => {
  const volume = getMasterVolume();
  const context = new OfflineAudioContext(2, 4_800, 48_000);
  // The bus only uses BaseAudioContext operations. Offline rendering makes the signal independent of audio hardware.
  const bus = buildAudioBus(context as unknown as AudioContext, 'split');
  try {
    bus.setMasterGain(0.5);
    bus.setBusVolume('key', 0.5);
    bus.setBusVolume('bgm', 0.25);
    setMasterVolume(0.5);

    const makeSource = (mixer: AudioNode, start: number, end: number) => {
      const source = context.createConstantSource();
      source.connect(mixer);
      source.start(start);
      source.stop(end);
    };
    makeSource(bus.keyMixer, 0, 0.05);
    makeSource(bus.bgmMixer, 0.05, 0.1);
    bus.setMode('legacy');
    bus.setMode('off');

    // Listen to the real speaker path on channel 0 and the recorder tap on channel 1.
    const monitor = context.createChannelMerger(2);
    const speakers = masterOutput(context);
    speakers.disconnect(context.destination);
    speakers.connect(monitor, 0, 0);
    bus.outputNode.connect(monitor, 0, 1);
    monitor.connect(context.destination);
    bus.fadeOutAudibleTo(0, 50);

    const rendered = await context.startRendering();
    const playback = rendered.getChannelData(0);
    const recording = rendered.getChannelData(1);
    expect(recording[1_200]).toBeCloseTo(0.125, 5);
    expect(playback[1_200]).toBeCloseTo(0.03125, 5);
    expect(recording[3_600]).toBeCloseTo(0.0625, 5);
    expect(playback[3_600]).toBe(0);
  } finally {
    bus.dispose();
    setMasterVolume(volume);
  }
});
