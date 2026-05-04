/**
 * Feature-detection probe for the browser APIs the web player
 * relies on. Run once at boot; the result drives the readiness
 * badge in the drop card so a user on an old browser sees *why*
 * the player can't start instead of getting an opaque WebGL /
 * AudioContext error mid-load.
 *
 * The detection lives in `player-web-core` (not the demo) so any
 * host shell — the demo, a future hosted build, an embedded
 * iframe — gets the same readiness verdict from a single source
 * of truth as the actual runtime feature usage.
 */

/**
 * One row of the compatibility report. `id` is stable across
 * versions so a host could persist user-dismissed warnings; the
 * `label` is the human-readable name shown in the badge.
 */
export interface BrowserCompatItem {
  id: string;
  label: string;
  supported: boolean;
  /**
   * `true` when the player can't function at all without this
   * feature (rendering / audio / chart loading). Missing required
   * features flip {@link BrowserCompatReport.ok} to `false`.
   */
  required: boolean;
  /**
   * One-line note explaining what depends on this feature, shown
   * as a tooltip / aria-description on the badge.
   */
  note: string;
}

export interface BrowserCompatReport {
  /**
   * `true` iff every `required: true` item is supported. The
   * drop card uses this to swap "Drop to load" for the
   * unsupported message.
   */
  ok: boolean;
  items: ReadonlyArray<BrowserCompatItem>;
}

/**
 * Synchronously probes every feature. Each detector swallows its
 * own exceptions so a single failed probe (e.g. `getContext` on a
 * locked-down canvas) can't crash the rest of the page.
 */
export function checkBrowserCompat(): BrowserCompatReport {
  const items: BrowserCompatItem[] = [
    {
      id: 'webgl2',
      label: 'WebGL2',
      required: true,
      supported: detectWebGL2(),
      note: 'Pixi rendering pipeline (or WebGPU)',
    },
    {
      id: 'web-audio',
      label: 'Web Audio',
      required: true,
      supported: detectAudioContext(),
      note: 'Keysound and BGM playback',
    },
    {
      id: 'file-api',
      label: 'Drag & Drop',
      required: true,
      supported: detectFileApi(),
      note: 'Loads BMS folders / LR2 themes from drag-drop',
    },
    {
      id: 'webassembly',
      label: 'WebAssembly',
      required: true,
      supported: detectWebAssembly(),
      note: 'BGA video transcode (ffmpeg.wasm)',
    },
    {
      id: 'worker',
      label: 'Workers',
      required: true,
      supported: detectWorker(),
      note: 'Off-main-thread BGA transcoding',
    },
    {
      id: 'webgpu',
      label: 'WebGPU',
      required: false,
      supported: detectWebGPU(),
      note: 'Preferred GPU path; auto-falls-back to WebGL2',
    },
    {
      id: 'webcodecs',
      label: 'WebCodecs',
      required: false,
      supported: detectWebCodecs(),
      note: 'Hardware-accelerated BGA encode',
    },
    {
      id: 'media-recorder',
      label: 'MediaRecorder',
      required: false,
      supported: detectMediaRecorder(),
      note: 'Gameplay → WebM recording',
    },
    {
      id: 'offscreen-canvas',
      label: 'OffscreenCanvas',
      required: false,
      supported: detectOffscreenCanvas(),
      note: 'LR2 bitmap-font conversion',
    },
  ];
  const ok = items.every((item) => !item.required || item.supported);
  return { ok, items };
}

/**
 * Compact summary of the missing features, suitable for a single
 * status line. Returns `undefined` when every required feature is
 * supported (callers can branch on that to skip rendering).
 */
export function summarizeBrowserCompat(report: BrowserCompatReport): string | undefined {
  if (report.ok) return undefined;
  const missing = report.items.filter((item) => item.required && !item.supported).map((item) => item.label);
  if (missing.length === 0) return undefined;
  return `Missing required: ${missing.join(', ')}`;
}

function detectWebGL2(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    // `failIfMajorPerformanceCaveat: false` matches Pixi's default
    // — we want to know whether ANY WebGL2 context is reachable,
    // even on integrated GPUs the browser flags as "slow".
    return canvas.getContext('webgl2') !== null;
  } catch {
    return false;
  }
}

function detectAudioContext(): boolean {
  if (typeof globalThis === 'undefined') return false;
  // Safari on iOS still ships only the prefixed `webkitAudioContext`
  // for some versions; treat both as "Web Audio is reachable".
  return 'AudioContext' in globalThis || 'webkitAudioContext' in (globalThis as unknown as Record<string, unknown>);
}

function detectFileApi(): boolean {
  if (typeof globalThis === 'undefined') return false;
  return 'File' in globalThis && 'FileReader' in globalThis && 'DataTransfer' in globalThis;
}

function detectWebAssembly(): boolean {
  return typeof globalThis !== 'undefined' && 'WebAssembly' in globalThis;
}

function detectWorker(): boolean {
  return typeof globalThis !== 'undefined' && 'Worker' in globalThis;
}

function detectWebGPU(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

function detectWebCodecs(): boolean {
  return typeof globalThis !== 'undefined' && 'VideoEncoder' in globalThis;
}

function detectMediaRecorder(): boolean {
  if (typeof globalThis === 'undefined') return false;
  if (!('MediaRecorder' in globalThis)) return false;
  // `captureStream` is the bridge between the canvas and the
  // recorder. Without it, MediaRecorder existing alone doesn't
  // help us — we'd never feed it a video track.
  if (typeof HTMLCanvasElement === 'undefined') return false;
  return typeof HTMLCanvasElement.prototype.captureStream === 'function';
}

function detectOffscreenCanvas(): boolean {
  return typeof globalThis !== 'undefined' && 'OffscreenCanvas' in globalThis;
}
