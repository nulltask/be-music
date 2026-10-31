import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test';
import { LOCAL_TIME_SCRIPT } from './local-time.ts';

/** A stand-in for the page's `<time data-local>` elements. */
function timeElement(iso: string, local: string, utcText: string) {
  return { dateTime: iso, dataset: { local } as Record<string, string>, title: utcText, textContent: utcText };
}

/** Runs the page script as the browser would, against a fake document; returns the listeners it added. */
function run(elements: ReturnType<typeof timeElement>[], lang = 'en') {
  const listeners = new Map<string, () => void>();
  const document = {
    readyState: 'complete',
    documentElement: { lang },
    querySelectorAll: () => elements,
    addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
  };
  new Function('document', LOCAL_TIME_SCRIPT)(document);
  return listeners;
}

describe('LOCAL_TIME_SCRIPT', () => {
  const previousZone = process.env.TZ;
  beforeEach(() => {
    process.env.TZ = 'Asia/Tokyo';
  });
  afterEach(() => {
    process.env.TZ = previousZone;
    vi.useRealTimers();
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

  test('writes a relative time as how long ago it was, in the page’s language', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-15T12:00:00.000Z'));
    const at = (iso: string) => timeElement(iso, 'relative', 'utc');
    const now = at('2026-10-15T11:59:40.000Z');
    const minutes = at('2026-10-15T11:55:00.000Z');
    const hours = at('2026-10-15T09:00:00.000Z');
    const days = at('2026-10-12T12:00:00.000Z');
    const future = at('2026-10-15T12:00:05.000Z');
    run([now, minutes, hours, days, future], 'en');
    expect([now, minutes, hours, days, future].map((element) => element.textContent)).toEqual([
      'now',
      '5 minutes ago',
      '3 hours ago',
      '3 days ago',
      // A clock a little ahead of the viewer's still reads as now.
      'now',
    ]);
    const japanese = at('2026-10-12T12:00:00.000Z');
    run([japanese], 'ja');
    expect(japanese.textContent).toBe('3 日前');
    // The title keeps the exact local time.
    expect(japanese.title).toBe('2026-10-12 21:00 Asia/Tokyo · utc');
  });

  test('writes the local date once a relative time is 30 days old', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-15T12:00:00.000Z'));
    const month = timeElement('2026-09-15T11:00:00.000Z', 'relative', 'utc');
    const almost = timeElement('2026-09-15T12:00:01.000Z', 'relative', 'utc');
    run([month, almost]);
    expect(month.textContent).toBe('2026-09-15');
    expect(almost.textContent).toBe('29 days ago');
  });

  test('rewrites the times an htmx swap brings, once each', () => {
    const kept = timeElement('2026-10-13T06:20:00.000Z', 'minute', '2026-10-13 06:20 UTC');
    const elements = [kept];
    const listeners = run(elements);
    const swapped = timeElement('2026-10-13T07:00:00.000Z', 'minute', '2026-10-13 07:00 UTC');
    elements.push(swapped);
    listeners.get('htmx:after:settle')?.();
    expect(swapped.textContent).toBe('2026-10-13 16:00');
    // Already in local time: the title is not wrapped a second time.
    expect(kept.title).toBe('2026-10-13 15:20 Asia/Tokyo · 2026-10-13 06:20 UTC');
  });

  test('leaves a time it cannot read as it is', () => {
    const broken = timeElement('not a date', 'minute', '2026-10-13 06:20 UTC');
    run([broken]);
    expect(broken.textContent).toBe('2026-10-13 06:20 UTC');
  });
});
