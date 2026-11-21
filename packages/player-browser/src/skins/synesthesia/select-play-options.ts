import type { Graphics } from 'pixi.js';
import {
  CLASSIC_HI_SPEED_STEPS,
  DEFAULT_PLAY_OPTIONS,
  formatGaugeLabel,
  HISPEED_MAX,
  HISPEED_MIN,
  HISPEED_STEP,
} from '@be-music/player-scene-model';
import { formatPlayVariantLabel, type BeMusicSelectActions } from '@be-music/player-skin-sdk';
import { addHitArea, type PixiSelectFrame, type SkinTextOptions } from '../pixi-kit/index.ts';
import { SYN_DIM, SYN_DISPLAY_FONT, SYN_TEXT_FONT, SYN_VOID, SYN_WHITE } from './style.ts';

interface QuickOption {
  label: string;
  value: string;
  step?: (direction: -1 | 1) => void;
  reset?: () => void;
}

const DOUBLE_MODES = new Set(['10 KEYS', '14 KEYS', '24d KEYS']);
const ROW_HEIGHT = 29;
export const LANDSCAPE_QUICK_OPTIONS_INSET = 61;

export function drawQuickPlayOptions(
  graphics: Graphics,
  addText: (text: string, x: number, y: number, options: SkinTextOptions) => void,
  frame: PixiSelectFrame,
  accent: number,
  portrait: boolean,
): void {
  const { playOptions: options, actions, focusedChart } = frame;
  const double = focusedChart !== undefined && DOUBLE_MODES.has(formatPlayVariantLabel(focusedChart));
  const coverMode = options.hiddenSudden1P;
  const sudden = options.laneCover && (coverMode === 'SUDDEN' || coverMode === 'HID+SUD');
  const hidden = coverMode === 'HIDDEN' || coverMode === 'HID+SUD';
  const measured = options.floatingHiSpeed || options.normalHiSpeedLevel > 0;
  const cycle = (key: Parameters<BeMusicSelectActions['cyclePlayOption']>[0]) => ({
    step: (direction: -1 | 1) => actions.cyclePlayOption(key, direction),
    reset: () => actions.setPlayOption(key, DEFAULT_PLAY_OPTIONS[key]),
  });
  const stepHiSpeed = (direction: -1 | 1): void => {
    if (options.floatingHiSpeed) {
      actions.setPlayOption('hiSpeed', stepNumber(options.hiSpeed, direction * 0.5, 0.5, 10));
    } else if (options.normalHiSpeedLevel > 0) {
      actions.setPlayOption('normalHiSpeedLevel', stepNumber(options.normalHiSpeedLevel, direction, 1, 20));
    } else if (options.classicHiSpeed) {
      const steps = CLASSIC_HI_SPEED_STEPS;
      const index = steps.indexOf(options.hiSpeed);
      const next =
        index < 0 ? (direction === 1 ? 0 : steps.length - 1) : (index + direction + steps.length) % steps.length;
      actions.setPlayOption('hiSpeed', steps[next]!);
    } else {
      actions.setPlayOption('hiSpeed', stepNumber(options.hiSpeed, direction * HISPEED_STEP, HISPEED_MIN, HISPEED_MAX));
    }
  };
  const setSudden = (enabled: boolean): void => {
    if (enabled && !options.laneCover) actions.setPlayOption('laneCover', true);
    actions.setPlayOption('hiddenSudden1P', enabled ? (hidden ? 'HID+SUD' : 'SUDDEN') : hidden ? 'HIDDEN' : 'OFF');
  };
  const items: QuickOption[] = [
    {
      label: double ? 'NOTES 1P' : 'NOTES',
      value: options.random1P === 'OFF' ? 'NORMAL' : options.random1P,
      ...cycle('random1P'),
    },
    { label: 'GAUGE', value: formatGaugeLabel(options.gauge1P) ?? '', ...cycle('gauge1P') },
    {
      label: 'HS-FIX',
      value: options.hsFix,
      ...(measured || options.classicHiSpeed ? {} : cycle('hsFix')),
    },
    {
      label: options.floatingHiSpeed ? 'FLOATING HS' : 'HI-SPEED',
      value:
        options.normalHiSpeedLevel > 0 && !options.floatingHiSpeed
          ? `LV ${options.normalHiSpeedLevel}`
          : String(options.hiSpeed),
      step: stepHiSpeed,
      reset: () => {
        if (options.normalHiSpeedLevel > 0 && !options.floatingHiSpeed)
          actions.setPlayOption('normalHiSpeedLevel', DEFAULT_PLAY_OPTIONS.normalHiSpeedLevel);
        actions.setPlayOption('hiSpeed', DEFAULT_PLAY_OPTIONS.hiSpeed);
      },
    },
    { label: 'SUDDEN+', value: sudden ? 'ON' : 'OFF', step: () => setSudden(!sudden), reset: () => setSudden(false) },
    {
      label: 'COVER HEIGHT',
      value: `${Math.round(options.shutter * 100)}%`,
      step: (direction) => actions.setPlayOption('shutter', stepNumber(options.shutter, direction * 0.05, 0.05, 0.95)),
      reset: () => actions.setPlayOption('shutter', DEFAULT_PLAY_OPTIONS.shutter),
    },
  ];
  if (double)
    items.push(
      {
        label: 'NOTES 2P',
        value: options.random2P === 'OFF' ? 'NORMAL' : options.random2P,
        ...cycle('random2P'),
      },
      { label: 'DP FLIP', value: options.dpFlip ? 'ON' : 'OFF', ...cycle('dpFlip') },
    );
  const columns = portrait ? 4 : items.length;
  const width = (frame.designWidth - 32 - 6 * (columns - 1)) / columns;
  const top = frame.designHeight - (portrait ? 94 : LANDSCAPE_QUICK_OPTIONS_INSET);
  for (const [index, item] of items.entries()) {
    const x = 16 + (index % columns) * (width + 6);
    const y = top + Math.floor(index / columns) * (ROW_HEIGHT + 5);
    const controlWidth = 18;
    const resetX = x + width - controlWidth;
    const nextX = resetX - controlWidth;
    const valueX = x + (resetX - x) / 2;
    const valueY = y + 20;
    graphics
      .rect(x, y, width, ROW_HEIGHT)
      .fill({ color: SYN_VOID, alpha: 0.96 })
      .stroke({ color: accent, width: 1, alpha: 0.32 });
    graphics.rect(resetX, y + 5, 1, ROW_HEIGHT - 10).fill({ color: accent, alpha: 0.23 });

    const textStyle: SkinTextOptions = { fontFamily: SYN_DISPLAY_FONT, anchorX: 0.5, anchorY: 0.5, marquee: false };
    addText(item.label, valueX, y + 8, {
      ...textStyle,
      size: 7,
      letterSpacing: 0.8,
      fill: SYN_DIM,
      maxWidth: resetX - x - 8,
    });
    addText(item.value, valueX, valueY, {
      ...textStyle,
      size: 10,
      fill: item.step ? SYN_WHITE : SYN_DIM,
      maxWidth: nextX - x - controlWidth - 4,
    });

    if (item.step !== undefined && item.reset !== undefined) {
      const { step, reset } = item;
      const iconStyle: SkinTextOptions = { ...textStyle, fontFamily: SYN_TEXT_FONT, size: 12, fill: accent };
      addText('‹', x + controlWidth / 2, valueY, iconStyle);
      addText('›', nextX + controlWidth / 2, valueY, iconStyle);
      addText('↺', resetX + controlWidth / 2, y + ROW_HEIGHT / 2, iconStyle);
      addHitArea(x, y, controlWidth, ROW_HEIGHT, 'pointer', () => step(-1));
      addHitArea(nextX, y, controlWidth, ROW_HEIGHT, 'pointer', () => step(1));
      addHitArea(resetX, y, controlWidth, ROW_HEIGHT, 'pointer', reset);
    }
  }
}

function stepNumber(value: number, step: number, min: number, max: number): number {
  if (step > 0 && value >= max) return min;
  if (step < 0 && value <= min) return max;
  return Math.min(max, Math.max(min, value + step));
}
