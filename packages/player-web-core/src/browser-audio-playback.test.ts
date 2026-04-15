import { createEmptyJson } from '@be-music/json';
import { describe, expect, test } from 'vitest';
import {
  BrowserAudioPlayback,
  type BrowserAudioBufferSourceNodeLike,
  type BrowserAudioContextLike,
  type BrowserDecodedAudioBuffer,
  type BrowserAudioDestinationLike,
  type BrowserAudioGainNodeLike,
} from './browser-audio-playback.ts';
import type { BrowserSongAssetSource } from './types.ts';

class FakeGainNode implements BrowserAudioGainNodeLike {
  public readonly gain = { value: 1 };
  public readonly destinations: BrowserAudioDestinationLike[] = [];

  public connect(destination: BrowserAudioDestinationLike): void {
    this.destinations.push(destination);
  }
}

class FakeBufferSourceNode implements BrowserAudioBufferSourceNodeLike {
  public buffer = null;
  public readonly starts: Array<{ when: number; offset?: number; duration?: number }> = [];
  public readonly destinations: Array<BrowserAudioGainNodeLike | BrowserAudioDestinationLike> = [];

  public connect(destination: BrowserAudioGainNodeLike | BrowserAudioDestinationLike): void {
    this.destinations.push(destination);
  }

  public start(when: number, offset?: number, duration?: number): void {
    this.starts.push({ when, offset, duration });
  }
}

class FakeAudioContext implements BrowserAudioContextLike {
  public currentTime = 10;
  public state = 'suspended';
  public readonly destination: BrowserAudioDestinationLike = {};
  public readonly decodedAudio: Uint8Array[] = [];
  public readonly gainNodes: FakeGainNode[] = [];
  public readonly sourceNodes: FakeBufferSourceNode[] = [];
  public resumeCalls = 0;
  public suspendCalls = 0;
  public closeCalls = 0;
  public readonly pendingDecodes: Array<{ bytes: Uint8Array; resolve: (value: BrowserDecodedAudioBuffer) => void }> = [];

  public decodeAudioData(audioData: ArrayBuffer): Promise<BrowserDecodedAudioBuffer> {
    const bytes = new Uint8Array(audioData);
    this.decodedAudio.push(bytes);
    return new Promise((resolve) => {
      this.pendingDecodes.push({ bytes, resolve });
    });
  }

  public createBufferSource(): FakeBufferSourceNode {
    const node = new FakeBufferSourceNode();
    this.sourceNodes.push(node);
    return node;
  }

  public createGain(): FakeGainNode {
    const node = new FakeGainNode();
    this.gainNodes.push(node);
    return node;
  }

  public async resume(): Promise<void> {
    this.state = 'running';
    this.resumeCalls += 1;
  }

  public async suspend(): Promise<void> {
    this.state = 'suspended';
    this.suspendCalls += 1;
  }

  public async close(): Promise<void> {
    this.state = 'closed';
    this.closeCalls += 1;
  }
}

describe('player-web-core browser audio playback', () => {
  test('starts before all sample decodes finish and schedules audio in real time', async () => {
    const json = createEmptyJson('bms');
    json.metadata.bpm = 120;
    json.resources.wav['01'] = 'keys/kick.wav';
    json.events.push({
      measure: 0,
      channel: '11',
      position: [0, 1],
      value: '01',
    });

    const source: BrowserSongAssetSource = {
      id: 'source',
      kind: 'directory',
      label: 'Source',
      files: new Map([['keys/kick.wav', Uint8Array.of(1, 2, 3, 4)]]),
    };
    const audioContext = new FakeAudioContext();
    const playback = new BrowserAudioPlayback(json, source, 'chart.bms', {
      createAudioContext: () => audioContext,
      startLeadSeconds: 0.125,
    });

    const preparation = await playback.prepare();
    const leadSeconds = playback.start();
    playback.update(0);

    expect(preparation.status).toBe('ready');
    expect(preparation.decodedSampleCount).toBe(0);
    expect(audioContext.decodedAudio).toHaveLength(1);
    expect(audioContext.pendingDecodes).toHaveLength(1);
    expect(audioContext.sourceNodes).toHaveLength(0);

    await playback.pause();
    await playback.resume();

    audioContext.pendingDecodes[0]?.resolve({ duration: 1 });
    await flushPromises();
    await flushPromises();
    playback.update(0);
    await playback.dispose();

    expect(leadSeconds).toBeCloseTo(0.125, 9);
    expect(audioContext.sourceNodes).toHaveLength(1);
    expect(audioContext.sourceNodes[0]?.starts).toEqual([{ when: 10.125, offset: 0, duration: 1 }]);
    expect(audioContext.resumeCalls).toBe(2);
    expect(audioContext.suspendCalls).toBe(1);
    expect(audioContext.closeCalls).toBe(1);
  });

  test('manual mode skips autoplay note scheduling but still allows manual triggers', async () => {
    const json = createEmptyJson('bms');
    json.metadata.bpm = 120;
    json.resources.wav['01'] = 'audio/bgm.wav';
    json.resources.wav['02'] = 'audio/key.wav';
    json.events.push(
      {
        measure: 0,
        channel: '01',
        position: [0, 1],
        value: '01',
      },
      {
        measure: 0,
        channel: '11',
        position: [0, 1],
        value: '02',
      },
    );

    const source: BrowserSongAssetSource = {
      id: 'source',
      kind: 'directory',
      label: 'Source',
      files: new Map([
        ['audio/bgm.wav', Uint8Array.of(1, 2, 3, 4)],
        ['audio/key.wav', Uint8Array.of(5, 6, 7, 8)],
      ]),
    };
    const audioContext = new FakeAudioContext();
    const playback = new BrowserAudioPlayback(json, source, 'chart.bms', {
      createAudioContext: () => audioContext,
      startLeadSeconds: 0.125,
      mode: 'manual',
    });

    const preparation = await playback.prepare();
    playback.start();
    audioContext.pendingDecodes.splice(0).forEach((decode) => decode.resolve({ duration: 1 }));
    await flushPromises();
    await flushPromises();
    playback.update(0);

    expect(preparation.scheduledTriggerCount).toBe(1);
    expect(audioContext.sourceNodes).toHaveLength(1);
    expect(audioContext.sourceNodes[0]?.starts).toEqual([{ when: 10.125, offset: 0, duration: 1 }]);

    playback.triggerEvent(json.events[1]!);

    expect(audioContext.sourceNodes).toHaveLength(2);
    expect(audioContext.sourceNodes[1]?.starts).toEqual([{ when: 10.01, offset: 0, duration: 1 }]);

    await playback.dispose();
  });

  test('timeline start seconds skips leading silence when starting preview-like playback', async () => {
    const json = createEmptyJson('bms');
    json.metadata.bpm = 120;
    json.resources.wav['01'] = 'audio/lead.wav';
    json.events.push({
      measure: 1,
      channel: '01',
      position: [0, 1],
      value: '01',
    });

    const source: BrowserSongAssetSource = {
      id: 'source',
      kind: 'directory',
      label: 'Source',
      files: new Map([['audio/lead.wav', Uint8Array.of(1, 2, 3, 4)]]),
    };
    const audioContext = new FakeAudioContext();
    const playback = new BrowserAudioPlayback(json, source, 'chart.bms', {
      createAudioContext: () => audioContext,
      startLeadSeconds: 0.125,
      timelineStartSeconds: 2,
    });

    await playback.prepare();
    playback.start();
    audioContext.pendingDecodes[0]?.resolve({ duration: 1 });
    await flushPromises();
    await flushPromises();
    playback.update(2);
    await playback.dispose();

    expect(audioContext.sourceNodes).toHaveLength(1);
    expect(audioContext.sourceNodes[0]?.starts).toEqual([{ when: 10.125, offset: 0, duration: 1 }]);
  });
});

async function flushPromises(): Promise<void> {
  await Promise.resolve();
}
