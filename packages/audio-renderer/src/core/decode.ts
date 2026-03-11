import { extname } from 'node:path';
import { OggVorbisDecoder } from '@wasm-audio-decoders/ogg-vorbis';
import { clampSignedUnit, isAbortError, throwIfAborted } from '@be-music/utils';
import { MPEGDecoder } from 'mpg123-decoder';
import { OggOpusDecoder } from 'ogg-opus-decoder';

export interface DecodedAudio {
  sampleRate: number;
  left: Float32Array;
  right?: Float32Array;
}

const MPG123_SUPPRESSED_LOG_PATTERNS = [
  /\bcoreaudio\.c:\d+\]\s*warning:\s*didn't have any audio data in callback \(buffer underflow\)/i,
];

export function createFallbackTone(sampleKey: string, sampleRate: number, seconds: number): {
  left: Float32Array;
  right: Float32Array;
} {
  const frameLength = Math.max(1, Math.round(sampleRate * seconds));
  const left = new Float32Array(frameLength);
  const right = new Float32Array(frameLength);
  const seed = Number.parseInt(sampleKey, 36);
  const frequency = 220 + ((Number.isFinite(seed) ? seed : 1) % 36) * 18;

  for (let index = 0; index < frameLength; index += 1) {
    const envelope = Math.max(0, 1 - index / frameLength);
    const value = Math.sin((2 * Math.PI * frequency * index) / sampleRate) * envelope * 0.3;
    left[index] = value;
    right[index] = value;
  }

  return { left, right };
}

export async function decodeAudioSample(buffer: Buffer, pathHint?: string, signal?: AbortSignal): Promise<DecodedAudio> {
  throwIfAborted(signal);
  if (isWavBuffer(buffer)) {
    return decodeWav(buffer, signal);
  }
  if (isMp3Buffer(buffer)) {
    return decodeMp3(buffer, signal);
  }
  if (isOggBuffer(buffer)) {
    return decodeOggLike(buffer, signal);
  }

  const extension = pathHint ? extname(pathHint).toLowerCase() : '';
  if (extension === '.ogg' || extension === '.oga' || extension === '.opus') {
    return decodeOggLike(buffer, signal);
  }
  if (extension === '.mp3') {
    return decodeMp3(buffer, signal);
  }
  if (extension === '.wav') {
    return decodeWav(buffer, signal);
  }

  try {
    return decodeWav(buffer, signal);
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    try {
      return decodeMp3(buffer, signal);
    } catch (nestedError) {
      if (isAbortError(nestedError)) {
        throw nestedError;
      }
      return decodeOggLike(buffer, signal);
    }
  }
}

export function resampleLinear(
  input: Float32Array,
  inputRate: number,
  outputRate: number,
  signal?: AbortSignal,
): Float32Array {
  if (inputRate === outputRate) {
    return input;
  }

  const outputLength = Math.max(1, Math.round((input.length * outputRate) / inputRate));
  const output = new Float32Array(outputLength);
  const ratio = inputRate / outputRate;

  for (let index = 0; index < outputLength; index += 1) {
    if ((index & 0x7ff) === 0) {
      throwIfAborted(signal);
    }
    const source = index * ratio;
    const left = Math.floor(source);
    const right = Math.min(left + 1, input.length - 1);
    const fraction = source - left;
    output[index] = input[left] * (1 - fraction) + input[right] * fraction;
  }

  return output;
}

async function decodeOggLike(buffer: Buffer, signal?: AbortSignal): Promise<DecodedAudio> {
  throwIfAborted(signal);
  if (isOggOpusBuffer(buffer)) {
    return decodeOggOpus(buffer, signal);
  }

  try {
    return await decodeOggVorbis(buffer, signal);
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    return decodeOggOpus(buffer, signal);
  }
}

function decodeWav(buffer: Buffer, signal?: AbortSignal): DecodedAudio {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (readAscii(view, 0, 4) !== 'RIFF' || readAscii(view, 8, 4) !== 'WAVE') {
    throw new Error('Unsupported file format. Only RIFF/WAVE is supported for samples.');
  }

  let offset = 12;
  let format:
    | {
      audioFormat: number;
      channels: number;
      sampleRate: number;
      blockAlign: number;
      bitsPerSample: number;
    }
    | undefined;
  let pcmOffset = -1;
  let pcmSize = 0;

  while (offset + 8 <= view.byteLength) {
    throwIfAborted(signal);
    const id = readAscii(view, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const bodyOffset = offset + 8;

    if (id === 'fmt ') {
      format = {
        audioFormat: view.getUint16(bodyOffset, true),
        channels: view.getUint16(bodyOffset + 2, true),
        sampleRate: view.getUint32(bodyOffset + 4, true),
        blockAlign: view.getUint16(bodyOffset + 12, true),
        bitsPerSample: view.getUint16(bodyOffset + 14, true),
      };
    }

    if (id === 'data') {
      pcmOffset = bodyOffset;
      pcmSize = size;
    }

    offset = bodyOffset + size + (size % 2);
  }

  if (!format || pcmOffset < 0 || pcmSize <= 0) {
    throw new Error('Invalid WAV file. Missing fmt/data chunks.');
  }

  const frameCount = Math.floor(pcmSize / format.blockAlign);
  const channels = Math.max(1, format.channels);
  const channelBuffers = Array.from({ length: channels }, () => new Float32Array(frameCount));

  for (let frame = 0; frame < frameCount; frame += 1) {
    if ((frame & 0x7ff) === 0) {
      throwIfAborted(signal);
    }
    for (let channel = 0; channel < channels; channel += 1) {
      const sampleOffset = pcmOffset + frame * format.blockAlign + channel * (format.bitsPerSample / 8);
      channelBuffers[channel][frame] = decodeSample(view, sampleOffset, format.audioFormat, format.bitsPerSample);
    }
  }

  return {
    sampleRate: format.sampleRate,
    left: channelBuffers[0],
    right: channelBuffers[1],
  };
}

async function decodeOggVorbis(buffer: Buffer, signal?: AbortSignal): Promise<DecodedAudio> {
  throwIfAborted(signal);
  const decoder = new OggVorbisDecoder();
  await decoder.ready;
  throwIfAborted(signal);
  try {
    throwIfAborted(signal);
    const decoded = await decoder.decodeFile(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));
    throwIfAborted(signal);
    const channels = decoded.channelData ?? [];
    if (channels.length === 0) {
      throw new Error('Failed to decode OGG file: no channel data.');
    }

    return {
      sampleRate: decoded.sampleRate,
      left: channels[0],
      right: channels[1],
    };
  } finally {
    decoder.free();
  }
}

async function decodeMp3(buffer: Buffer, signal?: AbortSignal): Promise<DecodedAudio> {
  return withSuppressedMpg123Warnings(async () => {
    throwIfAborted(signal);
    const decoder = new MPEGDecoder();
    await decoder.ready;
    throwIfAborted(signal);
    try {
      throwIfAborted(signal);
      const decoded = decoder.decode(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));
      throwIfAborted(signal);
      const channels = decoded.channelData ?? [];
      if (channels.length === 0) {
        throw new Error('Failed to decode MP3 file: no channel data.');
      }

      return {
        sampleRate: decoded.sampleRate,
        left: channels[0],
        right: channels[1],
      };
    } finally {
      decoder.free();
    }
  });
}

async function decodeOggOpus(buffer: Buffer, signal?: AbortSignal): Promise<DecodedAudio> {
  throwIfAborted(signal);
  const decoder = new OggOpusDecoder();
  await decoder.ready;
  throwIfAborted(signal);
  try {
    throwIfAborted(signal);
    const decoded = await decoder.decodeFile(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));
    throwIfAborted(signal);
    const channels = decoded.channelData ?? [];
    if (channels.length === 0) {
      throw new Error('Failed to decode Opus file: no channel data.');
    }

    return {
      sampleRate: decoded.sampleRate,
      left: channels[0],
      right: channels[1],
    };
  } finally {
    decoder.free();
  }
}

function decodeSample(view: DataView, offset: number, audioFormat: number, bitsPerSample: number): number {
  if (audioFormat === 3 && bitsPerSample === 32) {
    return clampSignedUnit(view.getFloat32(offset, true));
  }

  if (audioFormat !== 1) {
    throw new Error(`Unsupported WAV encoding format: ${audioFormat}`);
  }

  switch (bitsPerSample) {
    case 8:
      return (view.getUint8(offset) - 128) / 128;
    case 16:
      return view.getInt16(offset, true) / 32768;
    case 24: {
      const byte0 = view.getUint8(offset);
      const byte1 = view.getUint8(offset + 1);
      const byte2 = view.getUint8(offset + 2);
      let sample = byte0 | (byte1 << 8) | (byte2 << 16);
      if (sample & 0x800000) {
        sample |= ~0xffffff;
      }
      return sample / 8388608;
    }
    case 32:
      return view.getInt32(offset, true) / 2147483648;
    default:
      throw new Error(`Unsupported PCM bit depth: ${bitsPerSample}`);
  }
}

function isWavBuffer(buffer: Buffer): boolean {
  if (buffer.byteLength < 12) {
    return false;
  }
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  return readAscii(view, 0, 4) === 'RIFF' && readAscii(view, 8, 4) === 'WAVE';
}

function isOggBuffer(buffer: Buffer): boolean {
  if (buffer.byteLength < 4) {
    return false;
  }
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  return readAscii(view, 0, 4) === 'OggS';
}

function isOggOpusBuffer(buffer: Buffer): boolean {
  if (buffer.byteLength < 32) {
    return false;
  }
  return buffer.includes(Buffer.from('OpusHead', 'ascii'));
}

function isMp3Buffer(buffer: Buffer): boolean {
  if (buffer.byteLength >= 3) {
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    if (readAscii(view, 0, 3) === 'ID3') {
      return true;
    }
  }
  if (buffer.byteLength < 2) {
    return false;
  }
  const header0 = buffer[0];
  const header1 = buffer[1];
  return header0 === 0xff && (header1 & 0xe0) === 0xe0;
}

function readAscii(view: DataView, offset: number, length: number): string {
  let result = '';
  for (let index = 0; index < length; index += 1) {
    result += String.fromCharCode(view.getUint8(offset + index));
  }
  return result;
}

async function withSuppressedMpg123Warnings<T>(fn: () => Promise<T>): Promise<T> {
  const originalConsoleError = console.error;
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  console.error = (...args: unknown[]) => {
    const message = args.map((value) => String(value)).join(' ');
    if (MPG123_SUPPRESSED_LOG_PATTERNS.some((pattern) => pattern.test(message))) {
      return;
    }
    originalConsoleError(...args);
  };
  process.stderr.write = ((
    chunk: string | Uint8Array,
    encoding?: BufferEncoding | ((error?: Error | null) => void),
    callback?: (error?: Error | null) => void,
  ): boolean => {
    const message = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    if (MPG123_SUPPRESSED_LOG_PATTERNS.some((pattern) => pattern.test(message))) {
      if (typeof encoding === 'function') {
        encoding();
      }
      callback?.();
      return true;
    }
    if (typeof encoding === 'function') {
      return originalStderrWrite(chunk, encoding);
    }
    return originalStderrWrite(chunk, encoding, callback);
  }) as typeof process.stderr.write;

  try {
    return await fn();
  } finally {
    console.error = originalConsoleError;
    process.stderr.write = originalStderrWrite;
  }
}
