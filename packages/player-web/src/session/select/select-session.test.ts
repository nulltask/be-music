import { describe, expect, it } from 'vite-plus/test';
import type { CoreSongSelectViewOptions } from '../../scene/core/select.ts';
import { SelectSession, type SelectSessionContext } from './select-session.ts';
import { makeChart, makeCollection } from './test-support.ts';

/** A session on a scene that draws nothing, recording the cues it plays. */
function createSession(options: CoreSongSelectViewOptions = {}): { session: SelectSession; cues: string[] } {
  const cues: string[] = [];
  const ctx: SelectSessionContext = {
    options,
    disposed: false,
    themeDesignSize: undefined,
    beMusicRenderer: undefined,
    beMusicNeedsFrame: false,
    songImages: undefined,
    render: () => {},
    refreshChartPreview: () => {},
    noteCursorChange: () => {},
    playOneShotSound: async (name) => {
      cues.push(name);
    },
    applyLr2Timers: () => {},
  };
  return { session: new SelectSession(ctx), cues };
}

function titles(session: SelectSession): string[] {
  return session.currentEntries().map((entry) => (entry.kind === 'song' ? entry.song.title : entry.kind));
}

describe('SelectSession key filter', () => {
  it('lists a 24-key chart under no key filter of LR2’s, rather than folding it onto 7 or 14 keys', () => {
    const { session } = createSession();
    session.setCollection(
      makeCollection([
        makeChart('seven', 'pack', { channels: ['11', '18'] }),
        makeChart('fourteen', 'pack', { channels: ['11', '21', '28'] }),
        makeChart('keyboard', 'pack', { modeHint: 'keyboard-24k' }),
        makeChart('keyboard double', 'pack', { modeHint: 'keyboard-24k-double' }),
      ]),
    );
    session.setPlayOptions({ keysFilter: 'KEYS_7' });
    expect(titles(session)).toEqual(['seven']);
    session.setPlayOptions({ keysFilter: 'KEYS_14' });
    expect(titles(session)).toEqual(['fourteen']);
    session.setPlayOptions({ keysFilter: 'ALL' });
    expect(titles(session)).toEqual(['seven', 'fourteen', 'keyboard', 'keyboard double']);
  });
});
