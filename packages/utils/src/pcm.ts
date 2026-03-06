const HOST_IS_LITTLE_ENDIAN = new Uint8Array(new Uint16Array([0x00ff]).buffer)[0] === 0xff;

export function writeStereoPcm16Le(
  destination: Buffer,
  byteOffset: number,
  left: ArrayLike<number>,
  right: ArrayLike<number>,
  startFrame = 0,
  frameCount: number = Math.min(left.length, right.length) - startFrame,
): void {
  const framesToWrite = resolveFrameCount(destination, byteOffset, left, right, startFrame, frameCount);
  if (framesToWrite <= 0) {
    return;
  }
  if (HOST_IS_LITTLE_ENDIAN && (byteOffset & 1) === 0) {
    const samples = new Int16Array(destination.buffer, destination.byteOffset + byteOffset, framesToWrite * 2);
    fillInterleavedInt16(samples, left, right, startFrame, framesToWrite);
    return;
  }
  writeStereoPcm16Fallback(destination, byteOffset, left, right, startFrame, framesToWrite, false);
}

export function writeStereoPcm16Be(
  destination: Buffer,
  byteOffset: number,
  left: ArrayLike<number>,
  right: ArrayLike<number>,
  startFrame = 0,
  frameCount: number = Math.min(left.length, right.length) - startFrame,
): void {
  const framesToWrite = resolveFrameCount(destination, byteOffset, left, right, startFrame, frameCount);
  if (framesToWrite <= 0) {
    return;
  }
  if ((byteOffset & 1) === 0) {
    const bytes = framesToWrite * 4;
    const segment = destination.subarray(byteOffset, byteOffset + bytes);
    const samples = new Int16Array(segment.buffer, segment.byteOffset, framesToWrite * 2);
    fillInterleavedInt16(samples, left, right, startFrame, framesToWrite);
    if (HOST_IS_LITTLE_ENDIAN) {
      segment.swap16();
    }
    return;
  }
  writeStereoPcm16Fallback(destination, byteOffset, left, right, startFrame, framesToWrite, true);
}

function resolveFrameCount(
  destination: Buffer,
  byteOffset: number,
  left: ArrayLike<number>,
  right: ArrayLike<number>,
  startFrame: number,
  frameCount: number,
): number {
  const safeStartFrame = Math.max(0, Math.floor(startFrame));
  const availableSourceFrames = Math.min(left.length, right.length) - safeStartFrame;
  if (availableSourceFrames <= 0) {
    return 0;
  }
  const requestedFrames = Number.isFinite(frameCount) ? Math.max(0, Math.floor(frameCount)) : availableSourceFrames;
  if (requestedFrames <= 0) {
    return 0;
  }
  const availableDestinationFrames = Math.floor(Math.max(0, destination.byteLength - byteOffset) / 4);
  if (availableDestinationFrames <= 0) {
    return 0;
  }
  return Math.min(requestedFrames, availableSourceFrames, availableDestinationFrames);
}

function fillInterleavedInt16(
  destination: Int16Array,
  left: ArrayLike<number>,
  right: ArrayLike<number>,
  startFrame: number,
  frameCount: number,
): void {
  let sourceFrame = startFrame;
  let sampleIndex = 0;
  for (let frame = 0; frame < frameCount; frame += 1) {
    destination[sampleIndex] = floatToInt16Local(left[sourceFrame]!);
    destination[sampleIndex + 1] = floatToInt16Local(right[sourceFrame]!);
    sourceFrame += 1;
    sampleIndex += 2;
  }
}

function writeStereoPcm16Fallback(
  destination: Buffer,
  byteOffset: number,
  left: ArrayLike<number>,
  right: ArrayLike<number>,
  startFrame: number,
  frameCount: number,
  bigEndian: boolean,
): void {
  let pointer = byteOffset;
  let sourceFrame = startFrame;
  for (let frame = 0; frame < frameCount; frame += 1) {
    const leftSample = floatToInt16Local(left[sourceFrame]!);
    const rightSample = floatToInt16Local(right[sourceFrame]!);
    if (bigEndian) {
      destination.writeInt16BE(leftSample, pointer);
      destination.writeInt16BE(rightSample, pointer + 2);
    } else {
      destination.writeInt16LE(leftSample, pointer);
      destination.writeInt16LE(rightSample, pointer + 2);
    }
    sourceFrame += 1;
    pointer += 4;
  }
}

function floatToInt16Local(value: number): number {
  const clamped = value <= -1 ? -1 : value >= 1 ? 1 : value;
  if (clamped >= 0) {
    return Math.round(clamped * 32767);
  }
  return Math.round(clamped * 32768);
}
