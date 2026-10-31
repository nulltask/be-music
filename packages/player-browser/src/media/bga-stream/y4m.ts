/**
 * Incremental YUV4MPEG2 (`.y4m`) reader for the streaming BGA transcode.
 *
 * ffmpeg.wasm writes the decoded BGA as `-f yuv4mpegpipe` into a character device, in pieces of whatever size its I/O
 * buffer flushes. Unlike a bare `rawvideo` stream, y4m carries the geometry and the frame rate in its header, so the
 * encoder side needs no separate probe pass; with `-fps_mode cfr` every frame lasts exactly one frame period, which
 * gives each one its timestamp.
 */

/** The stream header: the frame size and the frame rate as a fraction. */
export interface Y4MHeader {
  width: number;
  height: number;
  frameRateNumerator: number;
  frameRateDenominator: number;
}

export interface Y4MSink {
  header(header: Y4MHeader): void;
  /** One I420 frame in a buffer of its own, which the sink may keep or transfer. */
  frame(data: Uint8Array): void;
}

/** A header or frame line longer than this is not y4m. */
const MAX_LINE_BYTES = 4096;
const SIGNATURE = 'YUV4MPEG2';
const FRAME_MARKER = 'FRAME';

/** Bytes of one I420 frame: a full-size luma plane and two half-size chroma planes, rounded up. */
export function i420FrameBytes(width: number, height: number): number {
  return width * height + 2 * Math.ceil(width / 2) * Math.ceil(height / 2);
}

/** Reads the `YUV4MPEG2 W.. H.. F..:.. ...` line (without its newline). Only 4:2:0 chroma is accepted. */
export function parseY4MHeader(line: string): Y4MHeader {
  const [signature, ...params] = line.split(' ');
  if (signature !== SIGNATURE) throw new Error('y4m: missing YUV4MPEG2 signature');
  let width = 0;
  let height = 0;
  let frameRateNumerator = 0;
  let frameRateDenominator = 0;
  for (const param of params) {
    const value = param.slice(1);
    switch (param[0]) {
      case 'W':
        width = Number.parseInt(value, 10);
        break;
      case 'H':
        height = Number.parseInt(value, 10);
        break;
      case 'F': {
        const [numerator, denominator] = value.split(':');
        frameRateNumerator = Number.parseInt(numerator ?? '', 10);
        frameRateDenominator = Number.parseInt(denominator ?? '', 10);
        break;
      }
      case 'C':
        // `420`, `420jpeg`, `420mpeg2` and `420paldv` differ only in chroma siting; the planes are laid out the same.
        if (!value.startsWith('420')) throw new Error(`y4m: unsupported colorspace C${value}`);
        break;
      default:
        break;
    }
  }
  if (!(width > 0 && height > 0)) throw new Error('y4m: missing frame size');
  if (!(frameRateNumerator > 0 && frameRateDenominator > 0)) throw new Error('y4m: missing frame rate');
  return { width, height, frameRateNumerator, frameRateDenominator };
}

/**
 * Feeds y4m bytes in arbitrary pieces and reports the header once, then each frame. `push` copies what it needs, so a
 * caller may hand it a view into memory it reuses (ffmpeg.wasm's heap). Malformed input throws.
 */
export class Y4MParser {
  private readonly sink: Y4MSink;
  private line: number[] = [];
  private frameBytes = 0;
  private frame: Uint8Array | undefined;
  private frameFilled = 0;
  private headerRead = false;

  public constructor(sink: Y4MSink) {
    this.sink = sink;
  }

  public push(chunk: Uint8Array): void {
    let offset = 0;
    while (offset < chunk.length) {
      if (this.frame) {
        const take = Math.min(chunk.length - offset, this.frame.length - this.frameFilled);
        this.frame.set(chunk.subarray(offset, offset + take), this.frameFilled);
        this.frameFilled += take;
        offset += take;
        if (this.frameFilled === this.frame.length) {
          const frame = this.frame;
          this.frame = undefined;
          this.sink.frame(frame);
        }
        continue;
      }
      const newline = chunk.indexOf(0x0a, offset);
      const end = newline < 0 ? chunk.length : newline;
      if (this.line.length + end - offset > MAX_LINE_BYTES) throw new Error('y4m: header line too long');
      for (let i = offset; i < end; i++) this.line.push(chunk[i]!);
      offset = end;
      if (newline < 0) break;
      offset++;
      this.readLine(String.fromCharCode(...this.line));
      this.line = [];
    }
  }

  /** Whether the stream stopped between frames, i.e. nothing was cut off. */
  public get atFrameBoundary(): boolean {
    return this.frame === undefined && this.line.length === 0;
  }

  private readLine(line: string): void {
    if (!this.headerRead) {
      const header = parseY4MHeader(line);
      this.headerRead = true;
      this.frameBytes = i420FrameBytes(header.width, header.height);
      this.sink.header(header);
      return;
    }
    // Frame parameters after the marker (`FRAME Ixx`) only restate stream ones; they are ignored.
    if (line !== FRAME_MARKER && !line.startsWith(`${FRAME_MARKER} `)) throw new Error('y4m: missing FRAME marker');
    this.frame = new Uint8Array(this.frameBytes);
    this.frameFilled = 0;
  }
}
