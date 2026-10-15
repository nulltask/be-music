/**
 * Offline time stretching with Signalsmith Stretch (MIT; `signalsmith-stretch`, WASM in an AudioWorklet): the signal is
 * rendered through a stretch node in an `OfflineAudioContext`. The library is loaded only when this is used.
 */

/** Room after the stretched signal for the stretcher's tail. */
const TAIL_SECONDS = 0.25;

interface StretchNode extends AudioNode {
  addBuffers(buffers: Float32Array[]): Promise<number>;
  schedule(change: {
    active?: boolean;
    input?: number;
    output?: number;
    rate?: number;
    semitones?: number;
  }): Promise<unknown> | void;
  latency(): Promise<number> | number;
}

/**
 * `channels` played `rate` times as fast at their own pitch (the result lasts `length / rate` samples), stretched by
 * Signalsmith Stretch. Rejects where AudioWorklet or WASM is unavailable; the caller falls back to WSOLA.
 */
export async function signalsmithStretchChannels(
  channels: readonly Float32Array[],
  sampleRate: number,
  rate: number,
): Promise<Float32Array<ArrayBuffer>[]> {
  const inputLength = channels[0]?.length ?? 0;
  const outputLength = Math.max(1, Math.round(inputLength / rate));
  const { default: SignalsmithStretch } = (await import('signalsmith-stretch')) as unknown as {
    default: (context: BaseAudioContext, options?: AudioWorkletNodeOptions) => Promise<StretchNode>;
  };
  const quantum = 128 / sampleRate;
  const tail = Math.round(TAIL_SECONDS * sampleRate);
  // Sized for up to a second of node latency before the signal. The worklet handles its messages between render
  // quanta, so the buffers and the start are set while the render is suspended after its first quantum.
  const context = new OfflineAudioContext(channels.length, outputLength + tail + Math.round(sampleRate), sampleRate);
  // One (unconnected) input: the processor renders nothing without it.
  const node = await SignalsmithStretch(context, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [channels.length],
  });
  node.connect(context.destination);
  let startSeconds = 0;
  void context.suspend(quantum).then(async () => {
    await node.addBuffers(channels.map((channel) => new Float32Array(channel)));
    const latency = await node.latency();
    // The node compensates for its own latency when a change is scheduled at least that far ahead.
    startSeconds = Math.ceil((quantum + latency) * sampleRate + 1) / sampleRate;
    await node.schedule({ active: true, input: 0, output: startSeconds, rate, semitones: 0 });
    await context.resume();
  });
  const rendered = await context.startRendering();
  const start = Math.round(startSeconds * sampleRate);
  return Array.from({ length: channels.length }, (_, channel) => {
    const out = new Float32Array(outputLength);
    out.set(rendered.getChannelData(channel).subarray(start, start + outputLength));
    return out;
  });
}
