import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test';
import { LOCAL_TIME_SCRIPT } from './local-time.ts';

/** A stand-in for the page's `<time data-local>` elements. */
function timeElement(iso: string, local: string, utcText: string) {
  return { dateTime: iso, dataset: { local }, title: utcText, textContent: utcText };
}

/** Runs the page script as the browser would, against a fake document. */
function run(elements: ReturnType<typeof timeElement>[]) {
  const document = { readyState: 'complete', querySelectorAll: () => elements, addEventListener: () => undefined };
  new Function('document', LOCAL_TIME_SCRIPT)(document);
}

describe('LOCAL_TIME_SCRIPT', () => {
  const previousZone = process.env.TZ;
  beforeEach(() => {
    process.env.TZ = 'Asia/Tokyo';
  });
  afterEach(() => {
    process.env.TZ = previousZone;
  });

  test('rewrites UTC times in the viewer’s zone, keeping the UTC text in the title', () => {
    const minute = timeElement('2026-10-13T06:20:00.000Z', 'minute', '2026-10-13 06:20 UTC');
    const day = timeElement('2026-10-13T20:00:00.000Z', 'day', '2026-10-13 20:00 UTC');
    run([minute, day]);
    expect(minute.textContent).toBe('2026-10-13 15:20');
    expect(minute.title).toBe('2026-10-13 15:20 Asia/Tokyo · 2026-10-13 06:20 UTC');
    // Late in the UTC day is already the next day in Tokyo.
    expect(day.textContent).toBe('2026-10-14');
  });

  test('leaves a time it cannot read as it is', () => {
    const broken = timeElement('not a date', 'minute', '2026-10-13 06:20 UTC');
    run([broken]);
    expect(broken.textContent).toBe('2026-10-13 06:20 UTC');
  });
});
