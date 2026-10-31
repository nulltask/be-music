import { describe, expect, it } from 'vite-plus/test';
import {
  BGAStreamFeeder,
  PROVISIONAL_DURATION_SECONDS,
  type FeedableMediaSource,
  type FeedableSourceBuffer,
} from './media-source.ts';
import type { BGAVideoStream, BGAVideoStreamState } from './stream.ts';

class FakeStream {
  public chunks: Uint8Array[] = [];
  public state: BGAVideoStreamState = 'running';
  public codec: string | undefined;
  public listeners = new Set<() => void>();
  public get settled(): boolean {
    return this.state !== 'running';
  }
  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  public push(...bytes: number[]): void {
    this.chunks.push(Uint8Array.from(bytes));
    this.notify();
  }
  public notify(): void {
    for (const listener of this.listeners) listener();
  }
}

class FakeSourceBuffer extends EventTarget implements FeedableSourceBuffer {
  public updating = false;
  public appends: number[][] = [];
  public removals: [number, number][] = [];
  public quotaFull = false;
  public ranges: [number, number][] = [];
  public get buffered(): TimeRanges {
    const ranges = this.ranges;
    return { length: ranges.length, start: (i) => ranges[i]![0], end: (i) => ranges[i]![1] } as TimeRanges;
  }
  public appendBuffer(data: BufferSource): void {
    if (this.quotaFull) throw new DOMException('full', 'QuotaExceededError');
    this.appends.push([...new Uint8Array(data as Uint8Array)]);
    this.updating = true;
  }
  public remove(start: number, end: number): void {
    this.removals.push([start, end]);
    this.updating = true;
  }
  public finishUpdate(): void {
    this.updating = false;
    this.dispatchEvent(new Event('updateend'));
  }
}

class FakeMediaSource extends EventTarget implements FeedableMediaSource {
  public readyState: ReadyState = 'closed';
  public duration = Number.NaN;
  public types: string[] = [];
  public endings: (EndOfStreamError | undefined)[] = [];
  public sourceBuffer = new FakeSourceBuffer();
  public addSourceBuffer(type: string): FeedableSourceBuffer {
    this.types.push(type);
    return this.sourceBuffer;
  }
  public endOfStream(error?: EndOfStreamError): void {
    this.endings.push(error);
    this.readyState = 'ended';
  }
  public open(): void {
    this.readyState = 'open';
    this.dispatchEvent(new Event('sourceopen'));
  }
}

class FakeMedia extends EventTarget {
  public currentTime = 0;
}

function setup(): { stream: FakeStream; source: FakeMediaSource; media: FakeMedia; feeder: BGAStreamFeeder } {
  const stream = new FakeStream();
  const source = new FakeMediaSource();
  const media = new FakeMedia();
  const feeder = new BGAStreamFeeder(source, media, stream as unknown as BGAVideoStream);
  return { stream, source, media, feeder };
}

describe('BGAStreamFeeder', () => {
  it('waits for the codec, then appends everything pending in one go and ends with the stream', () => {
    const { stream, source } = setup();
    source.open();
    expect(source.duration).toBe(PROVISIONAL_DURATION_SECONDS);
    stream.push(1, 2);
    expect(source.types).toEqual([]);
    stream.codec = 'avc1.42C01E';
    stream.push(3);
    expect(source.types).toEqual(['video/mp4; codecs="avc1.42C01E"']);
    expect(source.sourceBuffer.appends).toEqual([[1, 2, 3]]);
    // Arrives while the buffer is busy: appended on `updateend`.
    stream.push(4);
    stream.push(5);
    expect(source.sourceBuffer.appends).toHaveLength(1);
    source.sourceBuffer.finishUpdate();
    expect(source.sourceBuffer.appends).toEqual([
      [1, 2, 3],
      [4, 5],
    ]);
    stream.state = 'done';
    stream.notify();
    expect(source.endings).toEqual([]);
    source.sourceBuffer.finishUpdate();
    expect(source.endings).toEqual([undefined]);
  });

  it('feeds bytes that arrived before the source opened', () => {
    const { stream, source } = setup();
    stream.codec = 'avc1.640028';
    stream.push(9);
    source.open();
    expect(source.sourceBuffer.appends).toEqual([[9]]);
  });

  it('ends with a decode error when the stream fails before any bytes', () => {
    const { stream, source } = setup();
    source.open();
    stream.state = 'failed';
    stream.notify();
    expect(source.endings).toEqual(['decode']);
  });

  it('makes room behind the playhead when the buffer is full, then retries', () => {
    const { stream, source, media } = setup();
    stream.codec = 'avc1.42C01E';
    source.open();
    source.sourceBuffer.ranges = [[0, 30]];
    source.sourceBuffer.quotaFull = true;
    media.currentTime = 4;
    stream.push(1);
    // Nothing old enough to remove yet.
    expect(source.sourceBuffer.removals).toEqual([]);
    media.currentTime = 25;
    media.dispatchEvent(new Event('timeupdate'));
    expect(source.sourceBuffer.removals).toEqual([[0, 15]]);
    source.sourceBuffer.quotaFull = false;
    source.sourceBuffer.finishUpdate();
    expect(source.sourceBuffer.appends).toEqual([[1]]);
  });

  it('lets go of the stream when the source closes or the video is emptied', () => {
    const closed = setup();
    closed.source.dispatchEvent(new Event('sourceclose'));
    expect(closed.stream.listeners.size).toBe(0);
    const emptied = setup();
    emptied.media.dispatchEvent(new Event('emptied'));
    expect(emptied.stream.listeners.size).toBe(0);
  });
});
