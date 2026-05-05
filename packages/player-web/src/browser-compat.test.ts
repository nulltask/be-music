import { describe, expect, test } from 'vitest';
import { checkBrowserCompat, summarizeBrowserCompat } from './browser-compat.ts';

describe('checkBrowserCompat', () => {
  test('returns a stable item set with both required and optional entries', () => {
    const report = checkBrowserCompat();
        // Stable IDs the host UI can rely on for filtering / styling — a regression here would silently break any persisted
    // dismissals or theme overrides keyed off the IDs.
    const ids = report.items.map((item) => item.id).sort();
    expect(ids).toEqual([
      'file-api',
      'media-recorder',
      'offscreen-canvas',
      'web-audio',
      'webassembly',
      'webcodecs',
      'webgl2',
      'webgpu',
      'worker',
    ]);
    const required = report.items.filter((item) => item.required).map((item) => item.id);
    expect(required).toContain('webgl2');
    expect(required).toContain('web-audio');
    expect(required).toContain('file-api');
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

  test('ok flips to false when a required feature is missing', () => {
    const report = checkBrowserCompat();
        // In the Vitest Node env there's no `document`, so WebGL2 detection must return `false` (the canvas-creation path
    // can't run). That alone is enough to flip `ok`. We don't assert false unconditionally — a future browser-running
    // env (jsdom) might satisfy more detectors — but the expected-vs-detected relationship has to hold.
    const expectedOk = report.items.every((item) => !item.required || item.supported);
    expect(report.ok).toBe(expectedOk);
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
