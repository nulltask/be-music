import { DEFAULT_LR2_RANDOM_MIX_SETTINGS, DEFAULT_RANDOM_MIX_CONDITIONS } from '@be-music/player-engine/course';
import type { CourseDefinition } from '@be-music/player-engine/course';
import type { LibraryCourse } from '@be-music/player-scene-model';
import { describe, expect, test, vi } from 'vite-plus/test';
import {
  finishRandomMix,
  formatRandomMixSaveName,
  saveFinishedRandomMix,
  type RandomMixSetup,
} from './random-mix-save.ts';

const setup: RandomMixSetup = {
  kind: 'expert',
  conditions: { ...DEFAULT_RANDOM_MIX_CONDITIONS },
  settings: { ...DEFAULT_LR2_RANDOM_MIX_SETTINGS },
  defaultConnection: 'fade',
};

function course(stages: string[]): LibraryCourse {
  const definition = {
    name: 'RANDOM MIX',
    kind: 'expert',
    stages: stages.map((title) => ({ md5: title.repeat(32), title })),
    constraints: [],
    trophies: [],
    release: false,
    source: { format: 'beatoraja-json' },
  } as unknown as CourseDefinition;
  return { id: 'maker:expert#0', definition, stages: stages.map((title) => ({ title })), playable: true };
}

describe('formatRandomMixSaveName', () => {
  test('names a run by the local date and time it ended, zero-padded', () => {
    expect(formatRandomMixSaveName(new Date(2026, 10, 9, 21, 34, 56))).toBe('2026-11-09 21:34');
    expect(formatRandomMixSaveName(new Date(2027, 0, 2, 3, 4))).toBe('2027-01-02 03:04');
  });
});

describe('finishRandomMix / saveFinishedRandomMix', () => {
  const endedAt = new Date(2026, 10, 9, 21, 34);

  test('lists every stage drawn and saves the kept draw', () => {
    const played = course(['a', 'b', 'c']);
    const kept = played.definition;
    const finished = finishRandomMix({ setup, kept }, played, endedAt);
    expect(finished.request).toMatchObject({ setup, endedAt });
    expect(finished.request.course.stages.map((stage) => stage.title)).toEqual(['a', 'b', 'c']);
    expect(finished.course).toBe(kept);
    const maker = { saveRandomMix: vi.fn((saved: CourseDefinition, name: string) => ({ ...saved, name })) };
    expect(saveFinishedRandomMix(maker, finished, ' Mine ').name).toBe('Mine');
    expect(maker.saveRandomMix).toHaveBeenLastCalledWith(kept, 'Mine');
  });

  test('saves a run that was not kept as its own course, under the offered name when none is typed', () => {
    const played = course(['a']);
    const finished = finishRandomMix({ setup }, played, endedAt);
    expect(finished.course).toBe(played.definition);
    const maker = { saveRandomMix: vi.fn((saved: CourseDefinition, name: string) => ({ ...saved, name })) };
    expect(saveFinishedRandomMix(maker, finished, '   ').name).toBe('2026-11-09 21:34');
  });
});
