import { evaluateControlFlow, type RandomDraws } from '@be-music/chart-model';
import type { BeMusicJSON } from '@be-music/chart-source';

/** LR2's loader groups WAV declarations by the first two original filename bytes, in active file order. */
export function resolveLR2ExtraSoundFamilies(chart: BeMusicJSON, draws: RandomDraws = []): number[] {
  const families = Array<number>(1296).fill(0);
  const groups = new Map<string, number>();
  const source = chart.preservation.bms.sourceLines;
  if (source.length === 0 && Object.keys(chart.resources.wav).length > 0)
    throw new RangeError('LR2 EXTRA requires the original WAV declaration order; reload the source chart.');
  for (const entry of evaluateControlFlow({ bms: { controlFlow: source } }, draws)) {
    if (entry.kind !== 'header' || !/^WAV[0-9A-Z]{2}$/i.test(entry.command)) continue;
    const sound = Number.parseInt(entry.command.slice(3), 36);
    const path = entry.value;
    let prefix = chart.bms.wavNameBytePrefixes?.[path];
    if (prefix === undefined) {
      // ASCII prefixes are identical in LR2's supported byte encodings. A text-only
      // caller must supply the original bytes for any other spelling.
      const first = path.slice(0, 2);
      if (!first || Array.from(first).some((character) => character.charCodeAt(0) > 127))
        throw new RangeError('LR2 EXTRA requires original filename bytes; parse the source with parseBMSBytes.');
      prefix = Array.from(first, (character) => character.charCodeAt(0).toString(16).padStart(2, '0')).join('');
    }
    if (!/^(?:[0-9a-f]{2}){1,2}$/i.test(prefix)) throw new RangeError('Invalid original WAV filename byte prefix.');
    prefix = prefix.toLowerCase();
    let group = groups.get(prefix);
    if (group === undefined) {
      group = groups.size;
      groups.set(prefix, group);
    }
    families[sound] = group;
  }
  return families;
}
