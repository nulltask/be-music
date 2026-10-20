import type { LR2Skin } from '@be-music/skin-lr2';
import { describe, expect, it } from 'vite-plus/test';
import type { SelectFrame, SelectIntent } from '../types.ts';
import { isInsideLR2DefaultSearchBox, LR2SelectView } from './select-view.ts';

describe('isInsideLR2DefaultSearchBox', () => {
  it('accepts the LR2 default search-box chrome on the canonical 1280x720 design canvas', () => {
    expect(isInsideLR2DefaultSearchBox({ width: 1280, height: 720, x: 460, y: 561 })).toBe(true);
  });

  it('keeps the fallback rectangle boundaries inclusive to match the select-view click path', () => {
    expect(isInsideLR2DefaultSearchBox({ width: 1280, height: 720, x: 0, y: 540 })).toBe(true);
    expect(isInsideLR2DefaultSearchBox({ width: 1280, height: 720, x: 920, y: 582 })).toBe(true);
  });

  it('rejects clicks just outside the LR2 default search-box rectangle', () => {
    expect(isInsideLR2DefaultSearchBox({ width: 1280, height: 720, x: -0.01, y: 561 })).toBe(false);
    expect(isInsideLR2DefaultSearchBox({ width: 1280, height: 720, x: 920.01, y: 561 })).toBe(false);
    expect(isInsideLR2DefaultSearchBox({ width: 1280, height: 720, x: 460, y: 539.99 })).toBe(false);
    expect(isInsideLR2DefaultSearchBox({ width: 1280, height: 720, x: 460, y: 582.01 })).toBe(false);
  });

  it('does not apply the hardcoded fallback to custom design sizes', () => {
    expect(isInsideLR2DefaultSearchBox({ width: 640, height: 480, x: 460, y: 561 })).toBe(false);
    expect(isInsideLR2DefaultSearchBox({ width: 1280, height: 800, x: 460, y: 561 })).toBe(false);
  });
});

describe('LR2SelectView buttons', () => {
  type ButtonView = {
    emit: (intent: SelectIntent) => void;
    frame: Partial<SelectFrame> | undefined;
    dispatchButtonClick(button: { type: number; plusOnly?: number }, direction: 1 | -1): void;
  };

  /** A view (not attached, so nothing draws) whose buttons report the intents they send. */
  function createView(frame: Partial<SelectFrame> = {}) {
    const intents: SelectIntent[] = [];
    const view = new LR2SelectView({ family: 'lr2', skin: {} as LR2Skin }) as unknown as ButtonView;
    view.emit = (intent) => intents.push(intent);
    view.frame = frame;
    return { view, intents };
  }

  it('starts the bar under the cursor with PLAY (15) and AUTOPLAY (16), and shows its text file with READ TEXT (17)', () => {
    const { view, intents } = createView();
    view.dispatchButtonClick({ type: 15 }, 1);
    view.dispatchButtonClick({ type: 16 }, 1);
    view.dispatchButtonClick({ type: 17 }, 1);
    expect(intents).toEqual([
      { type: 'start', autoPlay: false },
      { type: 'start', autoPlay: true },
      { type: 'readtext' },
    ]);
  });

  it('toggles a panel, steps the sort and the hi-speed, and sets the difficulty filter', () => {
    const { view, intents } = createView();
    view.dispatchButtonClick({ type: 1 }, 1);
    view.dispatchButtonClick({ type: 12 }, -1);
    view.dispatchButtonClick({ type: 57, plusOnly: -1 }, 1);
    view.dispatchButtonClick({ type: 94 }, 1);
    view.dispatchButtonClick({ type: 13 }, 1);
    expect(intents).toEqual([
      { type: 'panel', panel: 1 },
      { type: 'play-option', key: 'sort', step: 1 },
      { type: 'play-option', key: 'hiSpeed', step: -1 },
      { type: 'set-play-option', key: 'difficultyFilter', value: 'HYPER' },
    ]);
  });

  it('runs the course maker’s buttons only while the player makes courses, stepping by the half clicked', () => {
    const { view, intents } = createView({ courseMaker: { defaultConnection: 'FADE' as never } });
    view.dispatchButtonClick({ type: 230 }, 1);
    view.dispatchButtonClick({ type: 231 }, 1);
    view.dispatchButtonClick({ type: 233 }, 1);
    view.dispatchButtonClick({ type: 242 }, -1);
    view.dispatchButtonClick({ type: 268 }, 1);
    expect(intents).toEqual([
      { type: 'course-maker', action: { kind: 'finish' } },
      { type: 'course-maker', action: { kind: 'cancel' } },
      { type: 'course-maker', action: { kind: 'delete' } },
      { type: 'course-maker', action: { kind: 'connection', slot: 2, step: -1 } },
      { type: 'course-maker', action: { kind: 'default-connection', step: 1 } },
    ]);
    const without = createView();
    without.view.dispatchButtonClick({ type: 230 }, 1);
    expect(without.intents).toEqual([]);
  });
});
