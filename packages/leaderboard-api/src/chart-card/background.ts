import { CHART_CARD_BACKGROUND } from '../pages/icons.generated.ts';
import type { IndexedImage } from './png.ts';

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

let background: Promise<IndexedImage> | undefined;

/** The charts' share card background (og-chart.svg as scripts/build-icons.ts prepared it), decoded once an isolate. */
export function chartCardBackground(): Promise<IndexedImage> {
  background ??= (async () => {
    const stream = new Blob([fromBase64(CHART_CARD_BACKGROUND.pixels)])
      .stream()
      .pipeThrough(new DecompressionStream('deflate'));
    const pixels = new Uint8Array(await new Response(stream).arrayBuffer());
    return {
      width: CHART_CARD_BACKGROUND.width,
      height: CHART_CARD_BACKGROUND.height,
      palette: fromBase64(CHART_CARD_BACKGROUND.palette),
      pixels,
    };
  })().catch((error: unknown) => {
    background = undefined;
    throw error;
  });
  return background;
}

/** Changes whenever the background does, so card URLs and stored cards follow it. */
export const CHART_CARD_BACKGROUND_HASH = CHART_CARD_BACKGROUND.hash;
