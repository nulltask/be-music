/** Separate SWBGA textures from ordinary BGA planes and from definitions sharing the same BMP ids. */
export function keyBoundBGAResourceKey(definitionId: string, bmpKey: string): string {
  return `${String.fromCharCode(0)}swbga:${definitionId}:${bmpKey}`;
}
