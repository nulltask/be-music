/**
 * Feature-detection probe for the browser APIs the web player relies on. Run once at boot; the result drives the
 * readiness badge in the drop card so a user on an old browser sees *why* the player can't start instead of getting an
 * opaque WebGL / AudioContext error mid-load.
 *
 * The detection lives in `player-web` (not the player) so any host shell — the player, a future hosted build, an embedded
 * iframe — gets the same readiness verdict from a single source of truth as the actual runtime feature usage.
 */

/**
 * One row of the compatibility report. `id` is stable across versions so a host could persist user-dismissed warnings;
 * the `label` is the human-readable name shown in the badge.
 */
export interface BrowserCompatItem {
  id: string;
  label: string;
  supported: boolean;
  /**
   * `true` when the player can't function at all without this feature (rendering / audio / chart loading). Missing
   * required features flip {@link BrowserCompatReport.ok} to `false`.
   */
  required: boolean;
  /**
   * One-line note explaining what depends on this feature, shown as a tooltip / aria-description on the badge.
   */
  note: string;
}

export interface BrowserCompatReport {
  /**
   * `true` iff every `required: true` item is supported. The drop card uses this to swap "Drop to load" for the
   * unsupported message.
   */
  ok: boolean;
  items: ReadonlyArray<BrowserCompatItem>;
}

/**
 * Synchronously probes every feature. Each detector swallows its own exceptions so a single failed probe (e.g.
 * `getContext` on a locked-down canvas) can't crash the rest of the page.
 */
export function checkBrowserCompat(): BrowserCompatReport {
  const webgpu = detectWebGPU();
  const items: BrowserCompatItem[] = [
    // What the player cannot start without: something to draw with, something to play the sound through, and a way to
    // take a dropped folder.
    {
      id: 'gpu',
      label: 'WebGPU / WebGL2',
      required: true,
      supported: webgpu || detectWebGL2(),
      note: 'Draws the player: WebGPU where there is one, WebGL2 otherwise',
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
      supported: detectFileAPI(),
      note: 'Loads dropped BMS folders and skins',
    },
    // Each of these switches one feature off, or makes it slower, when it is missing.
    {
      id: 'webgpu',
      label: 'WebGPU',
      required: false,
      supported: webgpu,
      note: 'Preferred renderer; WebGL2 draws without it',
    },
    {
      id: 'worker',
      label: 'Workers',
      required: false,
      supported: detectWorker(),
      note: 'Parses charts and transcodes BGA off the page; charts still parse on the page without them',
    },
    {
      id: 'webassembly',
      label: 'WebAssembly',
      required: false,
      supported: detectWebAssembly(),
      note: 'Legacy BGA video (ffmpeg.wasm) and tempo changes that keep the pitch',
    },
    {
      id: 'audio-worklet',
      label: 'AudioWorklet',
      required: false,
      supported: detectAudioWorklet(),
      note: 'Tempo changes that keep the pitch, and the sound of a WebCodecs recording',
    },
    {
      id: 'webcodecs',
      label: 'WebCodecs',
      required: false,
      supported: detectWebCodecs(),
      note: 'Hardware-accelerated BGA transcoding and gameplay recording',
    },
    {
      id: 'media-recorder',
      label: 'MediaRecorder',
      required: false,
      supported: detectMediaRecorder(),
      note: 'Gameplay recording where WebCodecs is missing',
    },
    {
      id: 'offscreen-canvas',
      label: 'OffscreenCanvas',
      required: false,
      supported: detectOffscreenCanvas(),
      note: 'Resizing beatoraja skin textures',
    },
    {
      id: 'cross-origin-isolation',
      label: 'Cross-origin isolation',
      required: false,
      supported: detectCrossOriginIsolation(),
      note: 'Faster BGA transcoding (SharedArrayBuffer flow control)',
    },
    {
      id: 'web-crypto',
      label: 'Web Crypto',
      required: false,
      supported: detectWebCrypto(),
      note: 'Chart hashes that key records, replays and the Leaderboard',
    },
    {
      id: 'indexed-db',
      label: 'IndexedDB',
      required: false,
      supported: detectIndexedDB(),
      note: 'Saved courses and the local data viewer',
    },
    {
      id: 'compression-streams',
      label: 'Compression Streams',
      required: false,
      supported: detectCompressionStreams(),
      note: 'Leaderboard uploads and replay slots',
    },
    {
      id: 'service-worker',
      label: 'Service Worker',
      required: false,
      supported: detectServiceWorker(),
      note: 'Offline play and installing the player',
    },
  ];
  const ok = items.every((item) => !item.required || item.supported);
  return { ok, items };
}

/**
 * Compact summary of the missing features, suitable for a single status line. Returns `undefined` when every required
 * feature is supported (callers can branch on that to skip rendering).
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
    // `failIfMajorPerformanceCaveat: false` matches Pixi's default — we want to know whether ANY WebGL2 context is
    // reachable, even on integrated GPUs the browser flags as "slow".
    return canvas.getContext('webgl2') !== null;
  } catch {
    return false;
  }
}

function detectAudioContext(): boolean {
  if (typeof globalThis === 'undefined') return false;
  // Safari on iOS still ships only the prefixed `webkitAudioContext` for some versions; treat both as "Web Audio is
  // reachable".
  return 'AudioContext' in globalThis || 'webkitAudioContext' in (globalThis as unknown as Record<string, unknown>);
}

function detectFileAPI(): boolean {
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
  // `captureStream` is the bridge between the canvas and the recorder. Without it, MediaRecorder existing alone doesn't
  // help us — we'd never feed it a video track.
  if (typeof HTMLCanvasElement === 'undefined') return false;
  return typeof HTMLCanvasElement.prototype.captureStream === 'function';
}

function detectOffscreenCanvas(): boolean {
  return typeof globalThis !== 'undefined' && 'OffscreenCanvas' in globalThis;
}

function detectAudioWorklet(): boolean {
  return typeof globalThis !== 'undefined' && 'AudioWorkletNode' in globalThis;
}

function detectCrossOriginIsolation(): boolean {
  return typeof SharedArrayBuffer !== 'undefined' && globalThis.crossOriginIsolated === true;
}

function detectWebCrypto(): boolean {
  return typeof crypto !== 'undefined' && crypto.subtle !== undefined;
}

function detectIndexedDB(): boolean {
  return typeof globalThis !== 'undefined' && 'indexedDB' in globalThis;
}

function detectCompressionStreams(): boolean {
  return typeof globalThis !== 'undefined' && 'CompressionStream' in globalThis && 'DecompressionStream' in globalThis;
}

function detectServiceWorker(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
}
