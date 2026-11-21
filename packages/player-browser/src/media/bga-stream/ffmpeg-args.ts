/**
 * ffmpeg.wasm command lines and core asset URLs shared by the whole-file and the streaming BGA transcodes.
 */

/**
 * Where the host serves the single-threaded ESM ffmpeg.wasm core: the player's Vite plugin (`be-music:ffmpeg-core`) in
 * development, emitted build assets (R2 behind the Worker) in production.
 */
export const FFMPEG_CORE_URL = '/ffmpeg-core/ffmpeg-core.js';
export const FFMPEG_WASM_URL = '/ffmpeg-core/ffmpeg-core.wasm';

/**
 * Fastest frame rate the streaming transcode emits. ASF (`.wmv`) often reports its 1 kHz timebase as the frame rate
 * (`1k tbr`): a constant-rate output at that rate would repeat every frame dozens of times.
 */
export const BGA_STREAM_MAX_FRAME_RATE = 60;

/**
 * Builds the `-vf scale=...` filter string for a target long-edge cap. We use `min(iw,N)` / `min(ih,N)` so small inputs
 * (legacy 256-px BGA) pass through unchanged, then `force_original_aspect_ratio=decrease` collapses one edge to
 * preserve aspect when the input originally exceeded the cap. `force_divisible_by=2` keeps yuv420p chroma aligned, and
 * `flags=fast_bilinear` picks the cheapest scaler. Commas inside `min()` are escaped (`\\,`) so the filter-graph parser
 * doesn't read them as filter-chain separators.
 */
/** How much bitrate a BGA video transcode spends: smaller and faster, or sharper. `standard` is the long-standing one. */
export type BGATranscodeQuality = 'low' | 'standard' | 'high' | 'very-high';

/** Every quality, smallest first. */
export const BGA_TRANSCODE_QUALITIES: readonly BGATranscodeQuality[] = ['low', 'standard', 'high', 'very-high'];

const QUALITY_CRF: Readonly<Record<BGATranscodeQuality, number>> = { low: 34, standard: 30, high: 25, 'very-high': 21 };
const QUALITY_BITS_PER_PIXEL: Readonly<Record<BGATranscodeQuality, number>> = {
  low: 0.05,
  standard: 0.08,
  high: 0.15,
  'very-high': 0.25,
};

/** libx264's `-crf` for `quality`: 30 at `standard` (`ultrafast`, BGA art tolerates it), lower for sharper. */
export function resolveBGATranscodeCRF(quality: BGATranscodeQuality = 'standard'): number {
  return QUALITY_CRF[quality] ?? QUALITY_CRF.standard;
}

/**
 * The H.264 bitrate a WebCodecs encode spends at `quality`: bits per pixel per frame (0.08 at `standard`, about what
 * libx264 `-crf 30 -preset ultrafast` spends: ~4 Mb/s at 1080p30, ~1 Mb/s at 480p30), at least 500 kb/s for the tiny
 * 256-px BGA.
 */
export function estimateBGATranscodeBitrate(
  width: number,
  height: number,
  frameRate: number,
  quality: BGATranscodeQuality = 'standard',
): number {
  const bitsPerPixel = QUALITY_BITS_PER_PIXEL[quality] ?? QUALITY_BITS_PER_PIXEL.standard;
  return Math.max(500_000, Math.round(width * height * frameRate * bitsPerPixel));
}

export function buildScaleFilterArg(maxLongEdge: number): string {
  return `scale='min(iw\\,${maxLongEdge})':'min(ih\\,${maxLongEdge})':force_original_aspect_ratio=decrease:force_divisible_by=2:flags=fast_bilinear`;
}

/**
 * What the streaming transcode's ffmpeg writes: `raw` is y4m frames for a WebCodecs encoder, `h264` is fragmented MP4
 * from the core's own libx264, for browsers without a usable `VideoEncoder`.
 */
export type BGAStreamOutput = 'raw' | 'h264';

export interface BGAStreamArgsOptions {
  input: string;
  output: string;
  mode: BGAStreamOutput;
  /** Long-edge cap in pixels, as {@link buildScaleFilterArg} takes it; `undefined` keeps the source size. */
  maxLongEdge?: number;
  /** The libx264 encode's quality (`-crf`), `standard` by default. */
  quality?: BGATranscodeQuality;
}

/**
 * The streaming transcode's command line. Both modes scale to even dimensions (4:2:0 chroma and H.264 need them), cap
 * the frame rate at {@link BGA_STREAM_MAX_FRAME_RATE}, and emit a constant frame rate, so frame `n` is shown at `n`
 * frame periods: y4m has no timestamps, and a variable-rate source keeps its timing through repeated frames.
 */
export function buildBGAStreamArgs({ input, output, mode, maxLongEdge, quality }: BGAStreamArgsOptions): string[] {
  const scale = maxLongEdge
    ? buildScaleFilterArg(maxLongEdge)
    : 'scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=fast_bilinear';
  const filter = `${scale},fps=fps='min(source_fps\\,${BGA_STREAM_MAX_FRAME_RATE})'`;
  const args = ['-i', input, '-vf', filter, '-fps_mode', 'cfr', '-an', '-sn', '-dn'];
  if (mode === 'raw') {
    args.push('-pix_fmt', 'yuv420p', '-f', 'yuv4mpegpipe', output);
    return args;
  }
  // `ultrafast` + `fastdecode,zerolatency` as in the whole-file libx264 transcode (no lookahead, so a fragment leaves as
  // soon as it is encoded). A key frame every second starts a fragment every second (`frag_keyframe`), whatever the
  // frame rate, and `empty_moov` puts the init segment first so playback can begin before the encode ends.
  // `-flush_packets 1` hands each packet to the device at once instead of waiting for a full I/O buffer.
  args.push(
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-tune',
    'fastdecode,zerolatency',
    '-crf',
    String(resolveBGATranscodeCRF(quality)),
    '-pix_fmt',
    'yuv420p',
    '-force_key_frames',
    'expr:gte(t,n_forced*1)',
    '-f',
    'mp4',
    '-movflags',
    'frag_keyframe+empty_moov+default_base_moof',
    '-flush_packets',
    '1',
    output,
  );
  return args;
}

/**
 * Reads the RFC 6381 codec string (`avc1.PPCCLL`) from the `avcC` box of an MP4 init segment, for
 * `MediaSource.addSourceBuffer`. `undefined` until the box is complete in `bytes`.
 */
export function readAVCCodecString(bytes: Uint8Array): string | undefined {
  for (let i = 0; i + 8 <= bytes.length; i++) {
    // 'avcC', then configurationVersion (1), AVCProfileIndication, profile_compatibility, AVCLevelIndication.
    if (bytes[i] !== 0x61 || bytes[i + 1] !== 0x76 || bytes[i + 2] !== 0x63 || bytes[i + 3] !== 0x43) continue;
    if (bytes[i + 4] !== 1) continue;
    const hex = (byte: number): string => byte.toString(16).padStart(2, '0').toUpperCase();
    return `avc1.${hex(bytes[i + 5]!)}${hex(bytes[i + 6]!)}${hex(bytes[i + 7]!)}`;
  }
  return undefined;
}
