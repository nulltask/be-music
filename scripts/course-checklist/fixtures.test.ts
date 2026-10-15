import { describe, expect, test } from 'vite-plus/test';
import { parseLr2CourseFile } from '../../packages/player/src/course/lr2crs.ts';
import { fixtureBms, lr2CourseList, sineWav } from './fixtures.ts';

describe('course checklist fixtures', () => {
  test('writes a playable WAV header for the sample length', () => {
    const wav = sineWav(440, 0.1, 1000, true);
    const view = new DataView(wav.buffer);
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF');
    expect(view.getUint32(40, true)).toBe(Math.floor(22050 * 0.1) * 2);
    expect(wav.length).toBe(44 + view.getUint32(40, true));
  });

  test('spreads the notes over the lanes, measure by measure', () => {
    const bms = fixtureBms({
      title: 'T',
      measures: 1,
      perMeasure: 2,
      lanes: ['11', '12'],
      playLevel: 1,
      difficulty: 1,
    });
    expect(bms).toContain('#TITLE T\r\n');
    // Lanes take the notes in turn: lane 11 the first cell's keysound 01, lane 12 the second cell's 02.
    expect(bms).toContain('#00111:0100\r\n');
    expect(bms).toContain('#00112:0002\r\n');
  });

  test('writes course lists LR2 reads back with their kinds and stages', () => {
    const md5 = 'a'.repeat(32);
    const courses = parseLr2CourseFile(
      lr2CourseList([
        { title: 'G', type: 2, md5s: [md5, md5] },
        { title: 'N', type: 1, md5s: [md5, md5] },
      ]),
    );
    expect(courses.map((course) => [course.name, course.kind, course.stages.length])).toEqual([
      ['G', 'grade', 2],
      ['N', 'nonstop', 2],
    ]);
  });
});
