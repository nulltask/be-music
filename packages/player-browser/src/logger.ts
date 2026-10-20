/**
 * Scoped console logger with a colored prefix label.
 *
 * Replaces the project's prior convention of writing `console.log('[scope] msg')` with a `logger('scope').info(msg)`
 * call so devtools renders the scope as a colored pill rather than as plain bracketed text. Each scope gets a
 * deterministic color (djb2 hash → fixed palette) so the same subsystem looks the same across reloads, and the bracket
 * characters around the scope are dropped.
 *
 * Levels follow the standard `console` triage: - `info`: state changes / one-shot lifecycle events. Visible under
 * "Info" in devtools by default. - `debug`: per-frame / high-volume diagnostic events. Filtered out by Chrome devtools'
 * "Verbose" toggle by default, so they stay out of the way unless the user opts in. - `warn` / `error`: as usual;
 * passed through to the matching `console.*` so the host's existing devtools surface for warnings (yellow background,
 * optional stack trace) keeps working.
 *
 * Usage:
 * ```ts
 * import { logger } from './logger.ts';
 * const log = logger('gameplay');
 * log.info('listeners attached', { count });
 * log.debug('frame report', report);
 * log.warn('AudioContext suspend threw', error);
 * ```
 */
export interface Logger {
  info(...args: unknown[]): void;
  debug(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/**
 * Palette picked to be readable on both light and dark devtools themes. Avoid pure red — it's reserved for
 * `console.error` / `console.warn` framing — and hyper-saturated cyans, which vibrate against the white background in
 * Chrome's light theme.
 */
const COLOR_PALETTE: ReadonlyArray<string> = [
  '#ffd166', // amber (matches the demo's accent)
  '#4ade80', // green
  '#60a5fa', // blue
  '#f472b6', // pink
  '#a78bfa', // violet
  '#fb923c', // orange
  '#22d3ee', // cyan
  '#facc15', // yellow
];

/**
 * Cache logger instances per scope so callers can re-acquire by scope name (`logger('gameplay')`) without rebuilding
 * the inline-style strings on every call. Cheap, but matters for the per-frame debug paths.
 */
const cache = new Map<string, Logger>();

export function logger(scope: string): Logger {
  const cached = cache.get(scope);
  if (cached) return cached;
  const created = createLogger(scope);
  cache.set(scope, created);
  return created;
}

function createLogger(scope: string): Logger {
  const color = pickColor(scope);
  // CSS-styled prefix using the `%c` directive. The scope label gets a tinted-background pill; the trailing `%c` resets
  // so the rest of the message renders with the host's default styling (otherwise the color would bleed into every
  // subsequent argument).
  const prefix = `%c${scope}%c`;
  const labelStyle = [
    `color: ${color}`,
    'font-weight: 600',
    'padding: 0 6px',
    'border-radius: 3px',
    `background: ${color}22`,
    `border: 1px solid ${color}55`,
  ].join('; ');
  const restStyle = '';
  return {
    info(...args: unknown[]): void {
      // eslint-disable-next-line no-console
      console.info(prefix, labelStyle, restStyle, ...args);
    },
    debug(...args: unknown[]): void {
      // eslint-disable-next-line no-console
      console.debug(prefix, labelStyle, restStyle, ...args);
    },
    warn(...args: unknown[]): void {
      // eslint-disable-next-line no-console
      console.warn(prefix, labelStyle, restStyle, ...args);
    },
    error(...args: unknown[]): void {
      // eslint-disable-next-line no-console
      console.error(prefix, labelStyle, restStyle, ...args);
    },
  };
}

/**
 * djb2 string hash, modded into the palette index. Stable across runs so a given scope name maps to the same color
 * every reload — keeps the user's "I know `gameplay` is amber" intuition usable across debugging sessions.
 */
function pickColor(scope: string): string {
  let hash = 5381;
  for (let index = 0; index < scope.length; index += 1) {
    // `Math.imul` keeps the multiplication 32-bit so the hash doesn't drift into IEEE 754 territory on long scope
    // names.
    hash = (Math.imul(hash, 33) ^ scope.charCodeAt(index)) | 0;
  }
  return COLOR_PALETTE[Math.abs(hash) % COLOR_PALETTE.length]!;
}
