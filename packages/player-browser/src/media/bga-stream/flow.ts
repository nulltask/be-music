/**
 * Flow control between the decode and the encode worker of the streaming BGA transcode.
 *
 * ffmpeg.wasm decodes a legacy BGA many times faster than real time — often faster than the encoder takes the frames —
 * and its `exec` can't yield, so the only way to hold it back is to block its thread inside the output device's
 * `write`. `Atomics.wait` does that without spinning, on a counter of the frames the encoder has taken. It needs a
 * `SharedArrayBuffer`, i.e. a cross-origin isolated page; without one the transcode encodes with libx264 in the decode
 * worker itself, which paces itself.
 */

/** Raw frames the decoder may run ahead of the encoder (3 MB each at 1080p). */
export const MAX_FRAMES_IN_FLIGHT = 4;
/** How long one wait lasts before the counter is read again; the main thread terminates a decoder that's stuck. */
const WAIT_SLICE_MS = 1000;

/** Whether this page can share memory with its workers (and so run the WebCodecs path with flow control). */
export function canShareFlowControl(): boolean {
  return typeof SharedArrayBuffer !== 'undefined' && globalThis.crossOriginIsolated === true;
}

/** The counter both workers see: index 0 holds the frames the encoder has taken. */
export function createFlowCounter(): Int32Array<SharedArrayBuffer> {
  return new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
}

/** Decoder side: blocks until at most {@link MAX_FRAMES_IN_FLIGHT} of the `produced` frames are untaken. */
export function waitForEncoder(flow: Int32Array<SharedArrayBuffer>, produced: number): void {
  for (;;) {
    const taken = Atomics.load(flow, 0);
    if (produced - taken <= MAX_FRAMES_IN_FLIGHT) return;
    Atomics.wait(flow, 0, taken, WAIT_SLICE_MS);
  }
}

/** Encoder side: one more frame taken; wakes a waiting decoder. */
export function signalFrameTaken(flow: Int32Array<SharedArrayBuffer>): void {
  Atomics.add(flow, 0, 1);
  Atomics.notify(flow, 0);
}
