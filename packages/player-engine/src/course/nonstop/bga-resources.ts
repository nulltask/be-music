import { parseBMSExBMP, parseBmsBGA } from '@be-music/chart-model';
import { resolveBMSBase, type BeMusicJSON } from '@be-music/chart-source';
import type { NonstopKeyAllocator } from './ids.ts';

/** One stage's BMP namespace, including image declarations and sub-region dependencies. */
export function createNonstopBMPAllocator(params: {
  source: BeMusicJSON;
  target: BeMusicJSON;
  stage: number;
  keys: NonstopKeyAllocator;
  stageKeys: string[];
  assetPath: (path: string) => string;
}): (key: string) => string | undefined {
  const { source, target, stage, keys, stageKeys, assetPath } = params;
  const visited = new Set<string>();
  const queue: Array<{ key: string; stitched: string }> = [];
  const base = resolveBMSBase(source);
  let exhausted = false;
  const allocate = (key: string): string | undefined => {
    const stitched = keys.keyFor(stage, key);
    if (stitched === undefined) {
      exhausted = true;
      return undefined;
    }
    if (!visited.has(key)) {
      visited.add(key);
      stageKeys.push(stitched);
      queue.push({ key, stitched });
    }
    return stitched;
  };
  return (key) => {
    if (exhausted) return undefined;
    const result = allocate(key);
    while (queue.length > 0 && !exhausted) {
      const entry = queue.pop()!;
      const exBMP = parseBMSExBMP(source.bms.exBMP[entry.key] ?? '');
      const explicit = source.resources.bmp[entry.key];
      const path =
        explicit ||
        exBMP?.filename ||
        (source.bmson.bga.header.some((header) => header.name === entry.key) ? entry.key : undefined);
      const mappedPath = path ? assetPath(path) : undefined;
      if (mappedPath) target.resources.bmp[entry.stitched] = mappedPath;
      if (exBMP) {
        // Keep the authored color fields; transparent-color rendering is a separate concern from resource remapping.
        target.bms.exBMP[entry.stitched] =
          `${exBMP.argbRaw} ${path === exBMP.filename ? mappedPath : assetPath(exBMP.filename)}`;
      }
      const argb = source.bms.argb[entry.key];
      if (argb !== undefined) target.bms.argb[entry.stitched] = argb;
      // A direct BMP/EXBMP resource overrides a same-slot BGA alias, as it does in standalone playback.
      if (path) continue;
      const raw = source.bms.bga[entry.key];
      const region = raw === undefined ? undefined : parseBmsBGA(raw, base, source.sourceFormat === 'bmson');
      if (!region) continue;
      const origin = allocate(region.sourceBMP);
      if (origin === undefined) break;
      target.bms.bga[entry.stitched] = [origin, region.sx, region.sy, region.ex, region.ey, region.dx, region.dy].join(
        ' ',
      );
    }
    return exhausted ? undefined : result;
  };
}
