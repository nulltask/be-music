import { describe, expect, it } from 'vite-plus/test';
import { isInsideLr2DefaultSearchBox, PixiSongSelectView } from './select.ts';
import type { BrowserCourseEntry, BrowserFolderNode } from '../../collection/types.ts';

describe('isInsideLr2DefaultSearchBox', () => {
  it('accepts the LR2 default search-box chrome on the canonical 1280x720 design canvas', () => {
    expect(isInsideLr2DefaultSearchBox({ width: 1280, height: 720, x: 460, y: 561 })).toBe(true);
  });

  it('keeps the fallback rectangle boundaries inclusive to match the select-view click path', () => {
    expect(isInsideLr2DefaultSearchBox({ width: 1280, height: 720, x: 0, y: 540 })).toBe(true);
    expect(isInsideLr2DefaultSearchBox({ width: 1280, height: 720, x: 920, y: 582 })).toBe(true);
  });

  it('rejects clicks just outside the LR2 default search-box rectangle', () => {
    expect(isInsideLr2DefaultSearchBox({ width: 1280, height: 720, x: -0.01, y: 561 })).toBe(false);
    expect(isInsideLr2DefaultSearchBox({ width: 1280, height: 720, x: 920.01, y: 561 })).toBe(false);
    expect(isInsideLr2DefaultSearchBox({ width: 1280, height: 720, x: 460, y: 539.99 })).toBe(false);
    expect(isInsideLr2DefaultSearchBox({ width: 1280, height: 720, x: 460, y: 582.01 })).toBe(false);
  });

  it('does not apply the hardcoded fallback to custom design sizes', () => {
    expect(isInsideLr2DefaultSearchBox({ width: 640, height: 480, x: 460, y: 561 })).toBe(false);
    expect(isInsideLr2DefaultSearchBox({ width: 1280, height: 800, x: 460, y: 561 })).toBe(false);
  });
});

describe('PixiSongSelectView PLAY / AUTOPLAY buttons', () => {
  it('start the focused course bar (button types 15 / 16)', () => {
    const dan = {
      id: 'dan#0',
      definition: { name: 'Dan', kind: 'grade', stages: [], constraints: [], trophies: [] },
      stages: [{ title: 'a' }],
      playable: true,
    } as unknown as BrowserCourseEntry;
    const started: string[] = [];
    // Not mounted, so nothing renders; the cursor sits on the course bar inside its course folder.
    const view = new PixiSongSelectView({
      onCourseSelected: () => started.push('play'),
      onCourseAutoPlay: () => started.push('auto'),
    }) as unknown as {
      session: { browseStack: BrowserFolderNode[] };
      selectedIndex: number;
      dispatchButtonClick(button: { type: number }): void;
    };
    view.session.browseStack = [{ label: 'Dan', songs: [], courses: [dan] }];
    view.selectedIndex = 0;
    view.dispatchButtonClick({ type: 15 });
    view.dispatchButtonClick({ type: 16 });
    expect(started).toEqual(['play', 'auto']);
  });
});
