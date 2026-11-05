import { describe, expect, it } from 'vite-plus/test';
import { isResolutionDetectCancelled, isStillShowing, wantsFirstRunResolutionDetect } from './render-resolution.ts';

describe('wantsFirstRunResolutionDetect', () => {
  it('benchmarks a high-density display before any pick', () => {
    expect(wantsFirstRunResolutionDetect({ stored: undefined, search: '', devicePixelRatio: 2 })).toBe(true);
  });

  it('keeps a resolution picked by hand or by an earlier benchmark', () => {
    expect(wantsFirstRunResolutionDetect({ stored: 1.5, search: '', devicePixelRatio: 2 })).toBe(false);
  });

  it('leaves a resolution pinned by ?resolution= alone', () => {
    expect(wantsFirstRunResolutionDetect({ stored: undefined, search: '?resolution=1', devicePixelRatio: 2 })).toBe(
      false,
    );
    expect(
      wantsFirstRunResolutionDetect({ stored: undefined, search: '?e2e=1&resolution=2', devicePixelRatio: 3 }),
    ).toBe(false);
  });

  it('has nothing to choose on a 1× display', () => {
    expect(wantsFirstRunResolutionDetect({ stored: undefined, search: '', devicePixelRatio: 1 })).toBe(false);
    expect(wantsFirstRunResolutionDetect({ stored: undefined, search: '', devicePixelRatio: 0 })).toBe(false);
  });
});

describe('isStillShowing', () => {
  const select = { entered: true };

  it('is the measured select screen while it is on the stage', () => {
    expect(isStillShowing(select, select)).toBe(true);
  });

  it('is not once the select screen left the stage, or another one is up', () => {
    expect(isStillShowing(select, { entered: false })).toBe(false);
    const left = { entered: false };
    expect(isStillShowing(left, left)).toBe(false);
    expect(isStillShowing(select, { entered: true })).toBe(false);
  });

  it('is not without a select screen', () => {
    expect(isStillShowing(undefined, undefined)).toBe(false);
    expect(isStillShowing(select, undefined)).toBe(false);
  });
});

describe('isResolutionDetectCancelled', () => {
  const select = { entered: true };

  it('stops when the page is hidden', () => {
    expect(isResolutionDetectCancelled({ visible: false, select })).toBe(true);
    expect(isResolutionDetectCancelled({ visible: false, whileShowing: select, select })).toBe(true);
  });

  it('runs on whatever screen shows when started from the button', () => {
    expect(isResolutionDetectCancelled({ visible: true, select: undefined })).toBe(false);
  });

  it('stops a first-run benchmark once its select screen is no longer showing', () => {
    expect(isResolutionDetectCancelled({ visible: true, whileShowing: select, select })).toBe(false);
    expect(isResolutionDetectCancelled({ visible: true, whileShowing: select, select: { entered: true } })).toBe(true);
    expect(isResolutionDetectCancelled({ visible: true, whileShowing: select, select: undefined })).toBe(true);
    const leaving = { entered: false };
    expect(isResolutionDetectCancelled({ visible: true, whileShowing: leaving, select: leaving })).toBe(true);
  });
});
