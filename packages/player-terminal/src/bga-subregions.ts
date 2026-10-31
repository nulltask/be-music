import { getANSIFrameAlpha, setANSIFrameAlpha } from './bga-alpha.ts';
import { parseBmsBGA, resolveBMSExBMPColorKey, type BmsARGB, type BMSSubRegionBGA } from '@be-music/chart-model';
import { resolveBMSBase, type BeMusicJSON } from '@be-music/chart-source';
import { createSolidANSIFrame, type ANSIFrame, type FrameMode } from './bga-frame.ts';
import { mapFrameSource, type FrameSource } from './bga-frame-source.ts';

export interface BGAResource {
  path: string;
  colorKey?: BmsARGB;
  swBGAColorKey?: BmsARGB;
  /** Source-to-destination order, including chained sub-regions. */
  regions: BMSSubRegionBGA[];
}

/** Resolve the complete dependency chain before starting I/O, so missing or cyclic aliases cannot deadlock loads. */
export function resolveBGAResource(
  chart: BeMusicJSON,
  resources: Readonly<Record<string, string>>,
  key: string,
): BGAResource | undefined {
  const regions: BMSSubRegionBGA[] = [];
  const seen = new Set<string>();
  const base = resolveBMSBase(chart);
  let current = key;
  while (!resources[current]) {
    if (seen.has(current)) return undefined;
    seen.add(current);
    const raw = chart.bms.bga[current];
    const region = typeof raw === 'string' ? parseBmsBGA(raw, base, chart.sourceFormat === 'bmson') : undefined;
    if (!region) return undefined;
    regions.push(region);
    current = region.sourceBMP;
  }
  const colorKey = resolveBMSExBMPColorKey(chart, current);
  return { path: resources[current]!, regions: regions.reverse(), ...(colorKey ? { colorKey } : {}) };
}

/** Draw source pixels at the authored offset on the BMS 256×256 canvas, clipping both source and destination. */
export function cropBGASubRegion(source: ANSIFrame, region: BMSSubRegionBGA, mode: FrameMode): ANSIFrame {
  const frame = createSolidANSIFrame(256, 256, 0, 0, 0, mode === 'base' ? 1 : 0);
  const left = Math.max(0, region.dx, region.dx - region.sx);
  const top = Math.max(0, region.dy, region.dy - region.sy);
  const right = Math.min(256, region.dx + region.ex - region.sx, region.dx + source.width - region.sx);
  const bottom = Math.min(256, region.dy + region.ey - region.sy, region.dy + source.height - region.sy);
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const from = (region.sy + y - region.dy) * source.width + region.sx + x - region.dx;
      if (!source.opaqueMask[from]) continue;
      const to = y * 256 + x;
      frame.rgb.set(source.rgb.subarray(from * 3, from * 3 + 3), to * 3);
      setANSIFrameAlpha(frame, to, getANSIFrameAlpha(source, from));
    }
  }
  return frame;
}

export function cropBGAFrameSource(
  source: FrameSource,
  regions: readonly BMSSubRegionBGA[],
  mode: FrameMode,
): FrameSource {
  if (regions.length === 0) return source;
  return mapFrameSource(source, (frame) => {
    let result = frame;
    for (const region of regions) result = cropBGASubRegion(result, region, mode);
    return result;
  });
}
