import { localTimePresentation } from '../src/pages/local-time.ts';

const input = {
  dateTime: '2026-10-13T06:20:00Z',
  utc: '2026-10-13 06:20 UTC',
  precision: 'relative' as const,
  locale: 'ja',
  timeZone: 'Asia/Tokyo',
  now: Date.UTC(2026, 9, 15, 12),
};
const iterations = 1000;
const started = performance.now();
for (let index = 0; index < iterations; index++) localTimePresentation(input);
console.log(JSON.stringify({ name: 'localTimePresentation', iterations, durationMs: performance.now() - started }));
