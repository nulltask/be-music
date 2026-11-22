import { describe, expect, test, vi } from 'vite-plus/test';
import { checkBrowserCompat, summarizeBrowserCompat } from './compat.ts';

describe('checkBrowserCompat', () => {
  test('returns a stable item set with both required and optional entries', () => {
    const report = checkBrowserCompat();
    // Stable IDs the host UI can rely on for filtering / styling — a regression here would silently break any persisted
    // dismissals or theme overrides keyed off the IDs.
    const ids = report.items.map((item) => item.id).sort();
    expect(ids).toEqual([
      'audio-worklet',
      'compression-streams',
      'cross-origin-isolation',
      'file-api',
      'gpu',
      'indexed-db',
      'media-recorder',
      'offscreen-canvas',
      'service-worker',
      'web-audio',
      'web-crypto',
      'webassembly',
      'webcodecs',
      'webgpu',
      'worker',
    ]);
    // Only what the player cannot start without is required; a feature that switches one thing off is optional.
    const required = report.items.filter((item) => item.required).map((item) => item.id);
    expect(required.sort()).toEqual(['file-api', 'gpu', 'web-audio']);
  });

  test('every item carries a non-empty human-readable label and note', () => {
    const report = checkBrowserCompat();
    for (const item of report.items) {
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.note.length).toBeGreaterThan(0);
    }
  });

  test('does not crash in a non-browser env (Node test runner)', () => {
    // The detectors swallow their own exceptions, so even with no `document` / no `HTMLCanvasElement` they must still
    // return a structured report. This test pins the contract.
    const report = checkBrowserCompat();
    expect(typeof report.ok).toBe('boolean');
    expect(Array.isArray(report.items)).toBe(true);
  });

  test.each([true, false])('permits play only with all required features (WebGL2: %s)', (hasWebGL2) => {
    const getContext = vi.fn((kind: string) => (kind === 'webgl2' && hasWebGL2 ? {} : null));
    try {
      vi.stubGlobal('document', { createElement: () => ({ getContext }) });
      vi.stubGlobal('AudioContext', class {});
      vi.stubGlobal('File', class {});
      vi.stubGlobal('FileReader', class {});
      vi.stubGlobal('DataTransfer', class {});
      const report = checkBrowserCompat();
      expect(getContext).toHaveBeenCalledWith('webgl2');
      expect(report.ok).toBe(hasWebGL2);
      expect(report.items.filter(({ required }) => required)).toEqual([
        expect.objectContaining({ id: 'gpu', supported: hasWebGL2 }),
        expect.objectContaining({ id: 'web-audio', supported: true }),
        expect.objectContaining({ id: 'file-api', supported: true }),
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('summarizeBrowserCompat', () => {
  test('returns undefined when ok is true', () => {
    const summary = summarizeBrowserCompat({ ok: true, items: [] });
    expect(summary).toBeUndefined();
  });

  test('joins missing required labels with commas when ok is false', () => {
    const summary = summarizeBrowserCompat({
      ok: false,
      items: [
        { id: 'a', label: 'WebGL2', supported: false, required: true, note: '' },
        { id: 'b', label: 'Web Audio', supported: true, required: true, note: '' },
        { id: 'c', label: 'WebGPU', supported: false, required: false, note: '' },
        { id: 'd', label: 'Workers', supported: false, required: true, note: '' },
      ],
    });
    // Optional misses (`WebGPU`) are excluded — the summary is deliberately the "what's *blocking* you" line, not the
    // full feature inventory.
    expect(summary).toBe('Missing required: WebGL2, Workers');
  });

  test('returns undefined when ok is false but no required item is actually missing', () => {
    // Defensive — `ok: false` with no missing required items shouldn't happen in normal usage, but the helper must not
    // emit the misleading "Missing required: " (with empty list).
    const summary = summarizeBrowserCompat({
      ok: false,
      items: [{ id: 'a', label: 'WebGPU', supported: false, required: false, note: '' }],
    });
    expect(summary).toBeUndefined();
  });
});
