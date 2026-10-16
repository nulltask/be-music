import { describe, expect, test } from 'vite-plus/test';
import { makeChart, makeChartWith, makeCourse } from '../test-support/library.ts';
import {
  chartMatchesDifficultyFilter,
  chartMatchesKeysFilter,
  courseMatchesKeysFilter,
  entryMatchesListFilters,
  keysFilterKeyMode,
} from './filter.ts';

describe('chartMatchesDifficultyFilter', () => {
  test('lists every chart under ALL and the charts of the named #DIFFICULTY otherwise', () => {
    const hyper = makeChartWith('h', 'P', { difficulty: 3 });
    expect(chartMatchesDifficultyFilter(hyper, 'ALL')).toBe(true);
    expect(chartMatchesDifficultyFilter(hyper, 'HYPER')).toBe(true);
    expect(chartMatchesDifficultyFilter(hyper, 'ANOTHER')).toBe(false);
    expect(chartMatchesDifficultyFilter(makeChartWith('i', 'P', { difficulty: 5 }), 'INSANE')).toBe(true);
    expect(chartMatchesDifficultyFilter(makeChartWith('b', 'P', { difficulty: 1 }), 'BEGINNER')).toBe(true);
  });

  test('leaves a chart that names no difficulty out of every filter but ALL', () => {
    expect(chartMatchesDifficultyFilter(makeChart('none', 'P'), 'BEGINNER')).toBe(false);
    expect(chartMatchesDifficultyFilter(makeChartWith('zero', 'P', { difficulty: 0 }), 'NORMAL')).toBe(false);
    expect(chartMatchesDifficultyFilter(makeChart('none', 'P'), 'ALL')).toBe(true);
  });
});

describe('chartMatchesKeysFilter', () => {
  test('lists a chart under its own key mode only', () => {
    const sevenKeys = makeChartWith('7', 'P', { channels: ['11', '18'] });
    expect(chartMatchesKeysFilter(sevenKeys, 'ALL')).toBe(true);
    expect(chartMatchesKeysFilter(sevenKeys, 'KEYS_7')).toBe(true);
    expect(chartMatchesKeysFilter(sevenKeys, 'KEYS_5')).toBe(false);
  });

  test('lists a 24-key chart under the 24-key filter, not under 7 keys', () => {
    const keyboard = makeChartWith('k', 'P', { channels: ['11', '1A'] });
    expect(chartMatchesKeysFilter(keyboard, 'KEYS_24')).toBe(true);
    expect(chartMatchesKeysFilter(keyboard, 'KEYS_7')).toBe(false);
  });

  test('names the key mode of each filter', () => {
    expect(keysFilterKeyMode('ALL')).toBeUndefined();
    expect(keysFilterKeyMode('KEYS_9')).toBe(9);
    expect(keysFilterKeyMode('KEYS_48')).toBe(48);
  });
});

describe('courseMatchesKeysFilter', () => {
  test("lists a course under its key mode (LR2's `line`)", () => {
    expect(courseMatchesKeysFilter(makeCourse('c', {}, 7), 'KEYS_7')).toBe(true);
    expect(courseMatchesKeysFilter(makeCourse('c', {}, 7), 'KEYS_14')).toBe(false);
  });

  test('keeps a course that names no key mode and a NEW COURSE bar under every filter', () => {
    expect(courseMatchesKeysFilter(makeCourse('beatoraja'), 'KEYS_5')).toBe(true);
    expect(courseMatchesKeysFilter(makeCourse('new', { newCourse: true }, 7), 'KEYS_5')).toBe(true);
  });
});

describe('entryMatchesListFilters', () => {
  const filters = { keysFilter: 'KEYS_5', difficultyFilter: 'HYPER' } as const;

  test('keeps every folder bar, as LR2 lists every folder whatever the filters', () => {
    expect(entryMatchesListFilters({ kind: 'folder', folder: { label: 'P', songs: [] } }, filters)).toBe(true);
  });

  test('filters a chart by both filters and a course by its key mode', () => {
    const fiveKeysHyper = makeChartWith('a', 'P', { channels: ['11'], difficulty: 3 });
    const fiveKeysNormal = makeChartWith('b', 'P', { channels: ['11'], difficulty: 2 });
    expect(entryMatchesListFilters({ kind: 'song', song: fiveKeysHyper }, filters)).toBe(true);
    expect(entryMatchesListFilters({ kind: 'song', song: fiveKeysNormal }, filters)).toBe(false);
    expect(entryMatchesListFilters({ kind: 'course', course: makeCourse('c', {}, 7) }, filters)).toBe(false);
    expect(entryMatchesListFilters({ kind: 'course', course: makeCourse('c', {}, 5) }, filters)).toBe(true);
  });
});
