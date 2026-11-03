// The Options dialog's key config (the Keys tab): the key map the built-in skins' screens read (LR2's or beatoraja's),
// then one page per key config group (5 / 7 / 10 / 14 KEY, 9 KEY), a row per lane with the key it takes, and on the
// 5 / 7 / 10 / 14 KEY page each side's START and SELECT. Clicking a row's key waits for the next key press and gives the
// row that key; Esc cancels. A lane cannot take START's or SELECT's key, nor they a lane's. Built with the dialog as
// `this` (`OptionsDialog`); the keys are `lane-keys.ts`' and `control-keys.ts`', and a play reads them as it starts, so
// the rows are disabled during one.
import {
  CONTROL_KEY_CONFIG,
  effectiveControlKey,
  keyboardEventToTokens,
  PLAY_SCENE_KEY_CODES,
  resolveControlButtons,
  type ControlKeyId,
} from '@be-music/player-browser/host';
import {
  LANE_KEY_CONFIG,
  laneKeyLabel,
  type LaneKeyConfigLane,
  type LaneKeyGroup,
} from '@be-music/player-engine/lanes';
import { assignLaneKey, effectiveLaneKey, resetLaneKeys } from '../../lane-keys.ts';
import { assignControlKey } from '../../control-keys.ts';
import { playerLang } from '../../player-copy.ts';
import type { OptionContainer } from '../options-controls.ts';
import type { OptionsDialog } from './index.ts';

/** Each group's page title. */
const GROUP_TITLES: Readonly<Record<LaneKeyGroup, string>> = { beat: '5 / 7 / 10 / 14 KEY', popn: '9 KEY' };

/** A lane's name in the key config (`1P scratch`, `2P key 3`, `Key 9`), which `labels.ts` translates. */
export function laneKeyConfigLabel(group: LaneKeyGroup, lane: LaneKeyConfigLane): string {
  if (group === 'popn') return `Key ${lane.id}`;
  if (lane.scratch) return `${lane.side} scratch`;
  const keys = LANE_KEY_CONFIG.beat.filter((entry) => entry.side === lane.side && !entry.scratch);
  return `${lane.side} key ${keys.findIndex((entry) => entry.id === lane.id) + 1}`;
}

/** START's or SELECT's name in the key config (`1P START`), which `labels.ts` translates. */
export function controlKeyConfigLabel(id: ControlKeyId): string {
  const [side, button] = id.split('-');
  return `${side} ${button!.toUpperCase()}`;
}

/** A row of the key config waiting for its key: a lane of a group, or START / SELECT. */
type KeyConfigRow = { readonly group: LaneKeyGroup; readonly id: string } | { readonly control: ControlKeyId };

function sameRow(left: KeyConfigRow | undefined, right: KeyConfigRow): boolean {
  if (left === undefined) return false;
  if ('control' in left || 'control' in right) {
    return 'control' in left && 'control' in right && left.control === right.control;
  }
  return left.group === right.group && left.id === right.id;
}

const PROMPTS = {
  en: { waiting: 'Press a key… (Esc cancels)', refused: 'That key cannot be used — press another' },
  ja: { waiting: 'キーを押してください… (Esc で取り消し)', refused: 'そのキーは使えません。別のキーを押してください' },
} as const;

/** Builds the key config into `folder`. */
export function buildKeyConfigFolder(this: OptionsDialog, folder: OptionContainer): void {
  this.trackPlayOption(
    folder
      .addBinding(this.guiState, 'builtInControlScheme', {
        label: 'Built-in skin controls',
        options: [
          { text: 'LR2', value: 'lr2' },
          { text: 'beatoraja', value: 'beatoraja' },
        ],
      })
      .on('change', () => this.scheduleSettingsSave()),
  );
  const groups = Object.keys(GROUP_TITLES) as LaneKeyGroup[];
  const pages = folder.addTab({ pages: groups.map((group) => ({ title: GROUP_TITLES[group] })) }).pages;
  const rows: { readonly row: KeyConfigRow; readonly button: HTMLButtonElement }[] = [];
  let waiting: KeyConfigRow | undefined;

  const prompts = () => PROMPTS[playerLang() === 'ja' ? 'ja' : 'en'];
  const keyOf = (row: KeyConfigRow): string =>
    'control' in row
      ? effectiveControlKey(this.guiState.controlKeys, row.control)
      : effectiveLaneKey(this.guiState.laneKeys, row.group, row.id);
  const paint = (): void => {
    for (const { row, button } of rows) {
      const active = sameRow(waiting, row);
      button.textContent = active ? prompts().waiting : laneKeyLabel(keyOf(row));
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  };
  const stop = (): void => {
    document.removeEventListener('keydown', onKey, true);
    waiting = undefined;
    paint();
  };
  /**
   * Whether `token` is another row's key it cannot take: START's or SELECT's, or a turntable's second key, for a 5 / 7 /
   * 10 / 14 KEY lane; a lane's (its turntable keys too) for START or SELECT. The screens could not tell them apart.
   */
  const takenByOtherKind = (row: KeyConfigRow, token: string): boolean => {
    if (!('control' in row)) {
      if (row.group !== 'beat') return false;
      // A turntable's second key (Ctrl, and Space on the 1P side) stays the turntable's.
      const buttons = resolveControlButtons({ laneKeys: this.guiState.laneKeys }).get(token) ?? [];
      if (buttons.some((button) => button.endsWith('-scratch-ccw'))) return true;
      return CONTROL_KEY_CONFIG.some((entry) => effectiveControlKey(this.guiState.controlKeys, entry.id) === token);
    }
    const buttons = resolveControlButtons({ laneKeys: this.guiState.laneKeys }).get(token) ?? [];
    return buttons.some((button) => !button.endsWith('-start') && !button.endsWith('-select'));
  };
  // The next key press, ahead of the dialog (whose Esc would close it) and of the screens behind it.
  const onKey = (event: KeyboardEvent): void => {
    if (waiting === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    if (event.code === 'Escape') {
      stop();
      return;
    }
    const token = keyboardEventToTokens(event)[0];
    const button = rows.find(({ row }) => sameRow(waiting, row))?.button;
    // A play keeps Esc, Pause, F5, Backspace and the arrows for itself; a key with no token cannot be a row's.
    if (token === undefined || PLAY_SCENE_KEY_CODES.has(event.code) || takenByOtherKind(waiting, token)) {
      if (button) button.textContent = prompts().refused;
      return;
    }
    if ('control' in waiting) {
      this.guiState.controlKeys = assignControlKey(this.guiState.controlKeys, waiting.control, token);
    } else {
      this.guiState.laneKeys = assignLaneKey(this.guiState.laneKeys, waiting.group, waiting.id, token);
    }
    this.scheduleSettingsSave();
    stop();
  };
  const dialog = document.querySelector('#options-modal');
  dialog?.addEventListener('close', () => {
    if (waiting !== undefined) stop();
  });

  const addRow = (page: OptionContainer, label: string, row: KeyConfigRow): void => {
    const content = document.createElement('div');
    content.className = 'options-key-row';
    const name = document.createElement('span');
    name.className = 'label options-label';
    name.textContent = label;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn options-key';
    button.dataset.variant = 'outline';
    button.dataset.size = 'sm';
    button.addEventListener('click', () => {
      if (sameRow(waiting, row)) {
        stop();
        return;
      }
      if (waiting === undefined) document.addEventListener('keydown', onKey, true);
      waiting = row;
      paint();
    });
    content.append(name, button);
    const option = page.addElement(content);
    option.element.dataset.optionLabel = label;
    this.trackPlayOption(option);
    rows.push({ row, button });
  };

  groups.forEach((group, groupIndex) => {
    const page = pages[groupIndex];
    if (page === undefined) return;
    for (const lane of LANE_KEY_CONFIG[group]) addRow(page, laneKeyConfigLabel(group, lane), { group, id: lane.id });
    // START and SELECT go with the 5 / 7 / 10 / 14 KEY lanes, whose keys the screens read them with.
    if (group === 'beat') {
      for (const entry of CONTROL_KEY_CONFIG) addRow(page, controlKeyConfigLabel(entry.id), { control: entry.id });
    }
    this.trackPlayOption(
      page.addButton({ title: 'Reset keys to defaults' }).on('click', () => {
        if (waiting !== undefined) stop();
        this.guiState.laneKeys = resetLaneKeys(this.guiState.laneKeys, group);
        if (group === 'beat') this.guiState.controlKeys = {};
        this.scheduleSettingsSave();
        paint();
      }),
    );
  });
  paint();
}
