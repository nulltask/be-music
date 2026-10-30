import type { BeMusicJSON } from '@be-music/chart-source';

/** charatbeatHDX's initial-only LONGMODE: 0 = CN, 1 = HCN. Preserve the vendor's documented case. */
export function parseHDXLongNoteMode(declaration: string): 2 | 3 | undefined {
  const match = /^charatbeatHDX:LONGMODE[\t ]+([01])[\t ]*$/.exec(declaration);
  return match ? (match[1] === '0' ? 2 : 3) : undefined;
}

/** Last valid whole declaration; unrelated or malformed later options do not erase the earlier setting. */
export function resolveHDXLongNoteMode(json: Pick<BeMusicJSON, 'bms'>): 2 | 3 | undefined {
  let mode: 2 | 3 | undefined;
  for (const declaration of json.bms.options ?? (json.bms.option ? [json.bms.option] : [])) {
    const next = parseHDXLongNoteMode(declaration);
    if (next !== undefined) mode = next;
  }
  return mode;
}
