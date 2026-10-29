import { encode } from 'fast-png';
import { expect, test } from 'vite-plus/test';
import { decodePNGToRGBA8 } from './png.ts';

test.each([3, 4] as const)('retains native RGB and encoded alpha presence (%s channels)', (channels) => {
  const data = channels === 3 ? new Uint8Array([127, 128, 129]) : new Uint8Array([255, 228, 173, 1]);
  const bytes = encode({ width: 1, height: 1, channels, depth: 8, data });
  const original = bytes.slice();
  const wrapped = new Uint8Array(bytes.length + 11);
  wrapped.set(bytes, 5);
  const image = decodePNGToRGBA8(wrapped.subarray(5, bytes.length + 5));
  expect(image).toEqual({
    width: 1,
    height: 1,
    hasAlphaChannel: channels === 4,
    data: channels === 3 ? new Uint8Array([127, 128, 129, 255]) : data,
  });
  expect(bytes).toEqual(original);
  expect(wrapped.subarray(5, bytes.length + 5)).toEqual(original);
});

test('converts 16-bit samples into owned RGBA8 without Canvas premultiplication', () => {
  const bytes = encode({
    width: 1,
    height: 1,
    channels: 4,
    depth: 16,
    data: new Uint16Array([65535, 32768, 16384, 257]),
  });
  const image = decodePNGToRGBA8(bytes);
  expect([...image.data]).toEqual([255, 128, 64, 1]);
  expect(image.hasAlphaChannel).toBe(true);
});

test.each([
  [
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAMAAAAoyzS7AAAAA1BMVEV/f3+QyhsjAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==',
    false,
    [127, 127, 127, 255],
  ],
  [
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAMAAAAoyzS7AAAAA1BMVEV/f3+QyhsjAAAAAXRSTlOArV5bRgAAAApJREFUeJxjYAAAAAIAAUivpHEAAAAASUVORK5CYII=',
    true,
    [127, 127, 127, 128],
  ],
  [
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABAgAAAACb+Tj3AAAAAnRSTlMAAQGU/a4AAAAKSURBVHicY0gAAABiAGGxmHnyAAAAAElFTkSuQmCC',
    true,
    [85, 85, 85, 0, 170, 170, 170, 255],
  ],
  [
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAABnRSTlMAfwB/AH+KMzNPAAAAD0lEQVR4nGOor69n+M8AAAl2An3QNTIfAAAAAElFTkSuQmCC',
    true,
    [127, 127, 127, 0, 0, 255, 0, 255],
  ],
] as const)('decodes palette/packed/tRNS pixels from encoded metadata (%s)', (base64, hasAlphaChannel, rgba) => {
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  const original = bytes.slice();
  const image = decodePNGToRGBA8(bytes);
  expect(image.hasAlphaChannel).toBe(hasAlphaChannel);
  expect([...image.data]).toEqual([...rgba]);
  expect(bytes).toEqual(original);
});

test('rejects malformed/truncated PNG input', () => {
  expect(() => decodePNGToRGBA8(new Uint8Array())).toThrow();
  expect(() => decodePNGToRGBA8(new Uint8Array([137, 80, 78, 71]))).toThrow();
});

// Authored Adam7 goldens use all five PNG row filters, with independent expected samples.
test.each([
  [
    1,
    false,
    'iVBORw0KGgoAAAANSUhEUgAAABEAAAARAQAAAAFkEUrBAAAAAnRSTlMAAQGU/a4AAAA3SURBVHicY2BgZGBiYGZgYWDAYIGZIA4D03/mBiDnP+N/oDiEtYrhGhNQkjmU4TVY2apVDchiAE7gDJPnrgPwAAAAAElFTkSuQmCC',
  ],
  [
    1,
    true,
    'iVBORw0KGgoAAAANSUhEUgAAABEAAAARAQMAAAF2pOUvAAAABlBMVEUAAP//AADF+ovTAAAAAnRSTlMAgewsfo4AAAA3SURBVHicY2BgZGBiYGZgYWDAYIGZIA4D03/mBiDnP+N/oDiEtYrhGhNQkjmU4TVY2apVDchiAE7gDJPnrgPwAAAAAElFTkSuQmCC',
  ],
  [
    2,
    false,
    'iVBORw0KGgoAAAANSUhEUgAAABEAAAARAgAAAAEjsTARAAAAAnRSTlMAAQGU/a4AAABuSURBVHicFYqhEcMwEATv/0VcjJBpMhPgKlSAkPlTQcFgQ4MAFRJmpFD3kTHyadHOzgIChSEANCqs0Zs01ro8RketRSr+6m77HDbgPMWhOdt0hAy4y8rtp4kUm3rvLSSWCyt5yXe4fkixd4zxeQNk3x2hJoeocwAAAABJRU5ErkJggg==',
  ],
  [
    2,
    true,
    'iVBORw0KGgoAAAANSUhEUgAAABEAAAARAgMAAAExBJ//AAAADFBMVEUAAP9VAKqqAFX/AAD1fJFuAAAAAnRSTlMAgewsfo4AAABuSURBVHicFYqhEcMwEATv/0VcjJBpMhPgKlSAkPlTQcFgQ4MAFRJmpFD3kTHyadHOzgIChSEANCqs0Zs01ro8RketRSr+6m77HDbgPMWhOdt0hAy4y8rtp4kUm3rvLSSWCyt5yXe4fkixd4zxeQNk3x2hJoeocwAAAABJRU5ErkJggg==',
  ],
  [
    4,
    false,
    'iVBORw0KGgoAAAANSUhEUgAAABEAAAARBAAAAAGs8cWxAAAAAnRSTlMAAQGU/a4AAACbSURBVHicY+BgYGxgYOpoYPZhqWDwYfSoaGCqAPLUZrO4mDCsU2N81MHk4sKsElbRtYHFxcXExYFhzQOVjAWMD1yAPCbh8Nn3mXWMjZVZlICAoXLvR1PG2UBVTEpCSkrMjdrGxixCIAmQOkYQCwiEFJigDCUFZhsIQ0mOBcpQkmKYtefeByGTsIoJjHuUIHrEmKAMoI5GCENJEgDLYSoCb5pq2gAAAABJRU5ErkJggg==',
  ],
  [
    4,
    true,
    'iVBORw0KGgoAAAANSUhEUgAAABEAAAARBAMAAAG+RGpfAAAAMFBMVEUAAP8RAO4iAN0zAMxEALtVAKpmAJl3AIiIAHeZAGaqAFW7AETMADPdACLuABH/AABlhrbpAAAAAnRSTlMAgewsfo4AAACbSURBVHicY+BgYGxgYOpoYPZhqWDwYfSoaGCqAPLUZrO4mDCsU2N81MHk4sKsElbRtYHFxcXExYFhzQOVjAWMD1yAPCbh8Nn3mXWMjZVZlICAoXLvR1PG2UBVTEpCSkrMjdrGxixCIAmQOkYQCwiEFJigDCUFZhsIQ0mOBcpQkmKYtefeByGTsIoJjHuUIHrEmKAMoI5GCENJEgDLYSoCb5pq2gAAAABJRU5ErkJggg==',
  ],
] as const)('decodes low-bit Adam7 (%s bits, indexed=%s)', (depth, indexed, base64) => {
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  const image = decodePNGToRGBA8(bytes);
  expect([image.width, image.height, image.hasAlphaChannel]).toEqual([17, 17, true]);
  const mask = (1 << depth) - 1;
  for (let y = 0; y < 17; y++)
    for (let x = 0; x < 17; x++) {
      const sample = (x + y) & mask;
      const value = Math.round((sample * 255) / mask);
      expect([...image.data.subarray((y * 17 + x) * 4, (y * 17 + x + 1) * 4)]).toEqual(
        indexed
          ? [value, 0, 255 - value, sample === 0 ? 0 : sample === 1 ? 129 : 255]
          : [value, value, value, sample === 1 ? 0 : 255],
      );
    }
});
test.each([
  'iVBORw0KGgoAAAANSUhEUgAAABEAAAARAgAAAAEjsTARAAAAbElEQVR4nBWKIRaDMBAF/+7GcJioWgSCU+QAUfi1kZHVSAQiB8GhUpt79FX1M2revAEECkMAaFRYozdprHWdn45ai1R81d2OV9iBMcShOdt0hwy4y8bto4kUm3rvLSSWHzayyPW4nqTYO8b4B0c+HWQ051+mAAAAAElFTkSuQmCC',
  'iVBORw0KGgoAAAANSUhEUgAAABEAAAARAgAAAAEjsTARAAAAb0lEQVR4nBWKIRKDMBBF/+6mgsNEYduZCk7BAaLi10ZGopEVFTlIHSq13INB8XnqzZv3gEBhCACNCmv0Jo21Ts+7o9YiFYe622cMK7Dv4tCUbNhCAtwlc/vrTIoNvfcWZpYTmbzld7t+SbElxvi6AGcyHaazZidGAAAAAElFTkSuQmCC',
])('rejects malformed Adam7 scanlines (%s)', (base64) => {
  expect(() => decodePNGToRGBA8(Uint8Array.from(atob(base64), (character) => character.charCodeAt(0)))).toThrow();
});
