import { parseBMSExBMP, parseBmsBGA, type BMSSubRegionBGA } from '@be-music/chart-model';
import { normalizeObjectKey, resolveBMSBase, type BeMusicJSON } from '@be-music/chart-source';

/** Effective aliases only: an authored image declaration takes precedence even when its asset fails to load. */
export function collectBGASubRegions(chart: BeMusicJSON): Map<string, BMSSubRegionBGA> {
  const regions = new Map<string, BMSSubRegionBGA>();
  const base = resolveBMSBase(chart);
  const allowLongKeys = chart.sourceFormat === 'bmson';
  const direct = new Set(chart.bmson.bga.header.map((entry) => entry.name));
  for (const [key, path] of Object.entries(chart.resources.bmp)) if (path) direct.add(key);
  for (const [key, raw] of Object.entries(chart.bms.exBMP)) if (parseBMSExBMP(raw)) direct.add(key);
  for (const [rawSlot, raw] of Object.entries(chart.bms.bga)) {
    const slot = normalizeObjectKey(rawSlot, base, allowLongKeys);
    if (direct.has(slot)) continue;
    const region = parseBmsBGA(raw, base, allowLongKeys);
    if (region) regions.set(slot, region);
  }
  return regions;
}
