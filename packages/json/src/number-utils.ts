export function normalizeAsciiBase36Code(code: number): number {
  if (code >= 0x30 && code <= 0x39) {
    return code;
  }
  const uppercase = code & 0xdf;
  if (uppercase >= 0x41 && uppercase <= 0x5a) {
    return uppercase;
  }
  return -1;
}
