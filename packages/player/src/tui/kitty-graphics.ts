const KITTY_GRAPHICS_ESCAPE_PREFIX = '\u001b_G';
const KITTY_GRAPHICS_ESCAPE_SUFFIX = '\u001b\\';
const DEFAULT_BASE64_CHUNK_SIZE = 4096;
const encodedChunkCache = new WeakMap<KittyGraphicsImage, Map<number, string[]>>();

export interface KittyGraphicsImage {
  pixelWidth: number;
  pixelHeight: number;
  cellWidth: number;
  cellHeight: number;
  rgb: Uint8Array;
}

export function supportsKittyGraphicsProtocol(env: NodeJS.ProcessEnv = process.env): boolean {
  const term = env.TERM?.toLowerCase() ?? '';
  const termProgram = env.TERM_PROGRAM?.toLowerCase() ?? '';
  return (
    typeof env.KITTY_WINDOW_ID === 'string' ||
    term.includes('kitty') ||
    term.includes('ghostty') ||
    termProgram === 'ghostty'
  );
}

export function buildKittyGraphicsDeleteImageSequence(imageId: number): string {
  const safeImageId = Math.max(1, Math.floor(imageId));
  return `${KITTY_GRAPHICS_ESCAPE_PREFIX}a=d,d=I,i=${safeImageId},q=2${KITTY_GRAPHICS_ESCAPE_SUFFIX}`;
}

export function buildKittyGraphicsRenderSequence(options: {
  imageId: number;
  placementId?: number;
  row: number;
  column: number;
  image: KittyGraphicsImage;
  zIndex?: number;
  doNotMoveCursor?: boolean;
  chunkSize?: number;
}): string {
  const safeImageId = Math.max(1, Math.floor(options.imageId));
  const safePlacementId =
    typeof options.placementId === 'number' && Number.isFinite(options.placementId)
      ? Math.max(1, Math.floor(options.placementId))
      : undefined;
  const safeRow = Math.max(1, Math.floor(options.row));
  const safeColumn = Math.max(1, Math.floor(options.column));
  const safePixelWidth = Math.max(1, Math.floor(options.image.pixelWidth));
  const safePixelHeight = Math.max(1, Math.floor(options.image.pixelHeight));
  const safeCellWidth = Math.max(1, Math.floor(options.image.cellWidth));
  const safeCellHeight = Math.max(1, Math.floor(options.image.cellHeight));
  const zIndex =
    typeof options.zIndex === 'number' && Number.isFinite(options.zIndex) ? Math.floor(options.zIndex) : undefined;
  const chunkSize = Math.max(256, Math.floor(options.chunkSize ?? DEFAULT_BASE64_CHUNK_SIZE));
  const chunks = resolveEncodedChunks(options.image, chunkSize);
  const parameters = [
    'a=T',
    't=d',
    'f=24',
    `s=${safePixelWidth}`,
    `v=${safePixelHeight}`,
    `c=${safeCellWidth}`,
    `r=${safeCellHeight}`,
    `i=${safeImageId}`,
    'q=2',
    safePlacementId ? `p=${safePlacementId}` : '',
    zIndex !== undefined ? `z=${zIndex}` : '',
    options.doNotMoveCursor === true ? 'C=1' : '',
  ]
    .filter((value) => value.length > 0)
    .join(',');
  const commands = chunks
    .map((chunk, index) => {
      const more = index + 1 < chunks.length ? 1 : 0;
      const prefix = index === 0 ? `${parameters},m=${more}` : `m=${more}`;
      return `${KITTY_GRAPHICS_ESCAPE_PREFIX}${prefix};${chunk}${KITTY_GRAPHICS_ESCAPE_SUFFIX}`;
    })
    .join('');
  return `\u001b[${safeRow};${safeColumn}H${commands}`;
}

function resolveEncodedChunks(image: KittyGraphicsImage, chunkSize: number): string[] {
  const cachedByChunkSize = encodedChunkCache.get(image);
  const cachedChunks = cachedByChunkSize?.get(chunkSize);
  if (cachedChunks) {
    return cachedChunks;
  }
  const chunks = splitBase64IntoChunks(Buffer.from(image.rgb).toString('base64'), chunkSize);
  const nextCachedByChunkSize = cachedByChunkSize ?? new Map<number, string[]>();
  nextCachedByChunkSize.set(chunkSize, chunks);
  if (!cachedByChunkSize) {
    encodedChunkCache.set(image, nextCachedByChunkSize);
  }
  return chunks;
}

function splitBase64IntoChunks(base64: string, chunkSize: number): string[] {
  if (base64.length <= 0) {
    return [''];
  }
  const chunks: string[] = [];
  for (let index = 0; index < base64.length; index += chunkSize) {
    chunks.push(base64.slice(index, index + chunkSize));
  }
  return chunks;
}
