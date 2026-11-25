export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The window's placement, saved when it closes and restored on the next launch. */
export interface WindowState {
  /** The bounds while neither maximized nor full screen. */
  bounds: Rectangle;
  maximized: boolean;
  fullScreen: boolean;
}

export const DEFAULT_WINDOW_SIZE = { width: 1280, height: 800 } as const;
export const MINIMUM_WINDOW_SIZE = { width: 640, height: 360 } as const;

/** How much of a restored window must lie on a display: enough of its top to grab the title bar. */
const VISIBLE_WIDTH = 120;
const VISIBLE_HEIGHT = 40;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseRectangle(value: unknown): Rectangle | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { x, y, width, height } = value as Record<string, unknown>;
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(width) || !isFiniteNumber(height)) {
    return null;
  }
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

/** Reads a saved state; `null` for anything malformed. */
export function parseWindowState(text: string): WindowState | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const bounds = parseRectangle(record.bounds);
  if (bounds === null) {
    return null;
  }
  return { bounds, maximized: record.maximized === true, fullScreen: record.fullScreen === true };
}

/**
 * The saved bounds when the window would still be reachable on one of the displays' work areas (a display may have
 * been unplugged since), grown to the minimum size; `undefined` to let the window open at the default size.
 */
export function restorableBounds(saved: Rectangle | undefined, workAreas: readonly Rectangle[]): Rectangle | undefined {
  if (saved === undefined) {
    return undefined;
  }
  const bounds = {
    ...saved,
    width: Math.max(saved.width, MINIMUM_WINDOW_SIZE.width),
    height: Math.max(saved.height, MINIMUM_WINDOW_SIZE.height),
  };
  const reachable = workAreas.some((area) => {
    const width = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
    const top = Math.max(bounds.y, area.y);
    const height = Math.min(bounds.y + VISIBLE_HEIGHT, area.y + area.height) - top;
    return width >= VISIBLE_WIDTH && height >= VISIBLE_HEIGHT && bounds.y >= area.y;
  });
  return reachable ? bounds : undefined;
}
