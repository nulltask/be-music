import { html, render } from 'lit';
import { optionLabel } from './labels.ts';
// The Options dialog's key config (the Keys tab): one page per key config group (5 / 7 / 10 / 14 KEY, 9 KEY), a row per
// lane with the key it takes. Clicking a lane's key waits for the next key press and gives the lane that key; Esc
// cancels. Built with the dialog as `this` (`OptionsDialog`); the keys are `lane-keys.ts`', and a play reads them as it
// starts, so the rows are disabled during one.
import { keyboardEventToTokens, PLAY_SCENE_KEY_CODES } from '@be-music/player-browser/host';
import {
  LANE_KEY_CONFIG,
  laneKeyLabel,
  type LaneKeyConfigLane,
  type LaneKeyGroup,
} from '@be-music/player-engine/lanes';
import { assignLaneKey, effectiveLaneKey, resetLaneKeys } from '../../lane-keys.ts';
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

const PROMPTS = {
  en: { waiting: 'Press a key… (Esc cancels)', refused: 'That key cannot be used — press another' },
  ja: { waiting: 'キーを押してください… (Esc で取り消し)', refused: 'そのキーは使えません。別のキーを押してください' },
} as const;

/** Builds the key config into `folder`. */
export function buildKeyConfigFolder(this: OptionsDialog, folder: OptionContainer): void {
  const groups = Object.keys(GROUP_TITLES) as LaneKeyGroup[];
  const pages = folder.addTab({ pages: groups.map((group) => ({ title: GROUP_TITLES[group] })) }).pages;
  const views = new Map<LaneKeyGroup, Map<string, () => void>>();
  let waiting: { group: LaneKeyGroup; id: string; refused?: boolean } | undefined;

  const prompts = () => PROMPTS[playerLang() === 'ja' ? 'ja' : 'en'];
  const paint = (): void => {
    for (const lanes of views.values()) for (const update of lanes.values()) update();
  };
  const stop = (): void => {
    document.removeEventListener('keydown', onKey, true);
    waiting = undefined;
    paint();
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
    // A play keeps Esc, Space, F5, Backspace and the arrows for itself; a key with no lane token cannot be a lane's.
    if (token === undefined || PLAY_SCENE_KEY_CODES.has(event.code)) {
      waiting.refused = true;
      paint();
      return;
    }
    this.guiState.laneKeys = assignLaneKey(this.guiState.laneKeys, waiting.group, waiting.id, token);
    this.scheduleSettingsSave();
    stop();
  };
  const dialog = document.querySelector('#options-modal');
  dialog?.addEventListener('close', () => {
    if (waiting !== undefined) stop();
  });

  groups.forEach((group, groupIndex) => {
    const page = pages[groupIndex];
    if (page === undefined) return;
    const lanes = new Map<string, () => void>();
    views.set(group, lanes);
    for (const lane of LANE_KEY_CONFIG[group]) {
      const label = laneKeyConfigLabel(group, lane);
      const content = document.createElement('div');
      content.className = 'options-key-row';
      let language = playerLang();
      const update = (): void => {
        const active = waiting?.group === group && waiting.id === lane.id;
        const text = active
          ? waiting?.refused
            ? prompts().refused
            : prompts().waiting
          : laneKeyLabel(effectiveLaneKey(this.guiState.laneKeys, group, lane.id));
        render(
          html`<span class="options-label-wrap"
              ><span class="label options-label">${optionLabel(label, language)}</span
              ><span data-option-help-host></span
            ></span>
            <button
              type="button"
              class="btn options-key"
              data-variant="outline"
              data-size="sm"
              aria-pressed=${String(active)}
              @click=${() => {
                if (waiting?.group === group && waiting.id === lane.id) {
                  stop();
                  return;
                }
                if (waiting === undefined) document.addEventListener('keydown', onKey, true);
                waiting = { group, id: lane.id };
                paint();
              }}
            >
              ${text}
            </button>`,
          content,
        );
      };
      const row = page.addElement(content, (nextLanguage) => {
        language = nextLanguage === 'ja' ? 'ja' : 'en';
        update();
      });
      row.element.dataset.optionLabel = label;
      this.trackPlayOption(row);
      lanes.set(lane.id, update);
    }
    this.trackPlayOption(
      page.addButton({ title: 'Reset keys to defaults' }).on('click', () => {
        if (waiting !== undefined) stop();
        this.guiState.laneKeys = resetLaneKeys(this.guiState.laneKeys, group);
        this.scheduleSettingsSave();
        paint();
      }),
    );
  });
  paint();
}
