/**
 * `@be-music/lr2-skin/ids`: LR2's skin vocabulary as named tables — the ops, timers, numbers, texts, buttons, sliders,
 * bar bodies / lamps and runtime-bound images a skin refers to by number. beatoraja keeps the same numbers for its
 * LR2-compatible ids, so `@be-music/beatoraja-skin` names its copies after these. See `docs/lr2-skin.md`.
 */
export { LR2_OP, type LR2Op } from './ops.ts';
export { LR2_TIMER, LR2_LANE_INDEX_MAX, LR2_LANE_TIMER_BANK_SIZE, type LR2Timer } from './timers.ts';
export { LR2_NUM, type LR2Num } from './numbers.ts';
export { LR2_TEXT, type LR2Text } from './texts.ts';
export { LR2_BUTTON, type LR2Button } from './buttons.ts';
export { LR2_SLIDER, type LR2Slider } from './sliders.ts';
export {
  LR2_BAR_BODY,
  LR2_BAR_BODY_KINDS,
  LR2_BAR_LAMP,
  LR2_BAR_LAMP_KINDS,
  type LR2BarBody,
  type LR2BarLamp,
} from './bar.ts';
export { LR2_GR, type LR2Gr } from './graphics.ts';
