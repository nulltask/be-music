import { describe, expect, test } from 'vite-plus/test';
import { localTimePresentation, type LocalTimePrecision } from './local-time.ts';

const now = Date.UTC(2026, 9, 15, 12);
const present = (dateTime: string, precision: LocalTimePrecision = 'minute', locale = 'en', utc = 'utc') =>
  localTimePresentation({ dateTime, precision, locale, utc, timeZone: 'Asia/Tokyo', now });

describe('localTimePresentation', () => {
  test('formats in the viewer’s zone, keeping UTC text in the title', () => {
    const minute = present('2026-10-13T06:20:00.000Z', 'minute', 'en', '2026-10-13 06:20 UTC');
    expect(minute?.text).toBe('2026-10-13 15:20');
    expect(minute?.title).toBe('2026-10-13 15:20 Asia/Tokyo · 2026-10-13 06:20 UTC');
    expect(present('2026-10-13T20:00:00.000Z', 'day')?.text).toBe('2026-10-14');
  });

  test('formats relative seconds, minutes, hours, days, and future clocks in the page’s language', () => {
    const dates = [
      '2026-10-15T11:59:40Z',
      '2026-10-15T11:55:00Z',
      '2026-10-15T09:00:00Z',
      '2026-10-12T12:00:00Z',
      '2026-10-15T12:00:05Z',
    ];
    expect(dates.map((date) => present(date, 'relative')?.text)).toEqual([
      'now',
      '5 minutes ago',
      '3 hours ago',
      '3 days ago',
      'now',
    ]);
    const japanese = present('2026-10-12T12:00:00Z', 'relative', 'ja');
    expect(japanese?.text).toBe('3 日前');
    expect(japanese?.title).toBe('2026-10-12 21:00 Asia/Tokyo · utc');
  });

  test('switches to the local date at thirty days', () => {
    expect(present('2026-09-15T11:00:00Z', 'relative')?.text).toBe('2026-09-15');
    expect(present('2026-09-15T12:00:01Z', 'relative')?.text).toBe('29 days ago');
  });

  test('uses the requested timezone independently of the runtime timezone', () => {
    expect(
      localTimePresentation({
        dateTime: '2026-10-13T06:20:00Z',
        precision: 'minute',
        utc: 'utc',
        timeZone: 'UTC',
        locale: 'en',
        now,
      }),
    ).toEqual({ text: '2026-10-13 06:20', title: '2026-10-13 06:20 UTC · utc' });
  });

  test('leaves an unreadable date to the server fallback', () => {
    expect(present('not a date')).toBeUndefined();
  });
});
