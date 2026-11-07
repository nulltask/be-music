import { html, nothing, render, type TemplateResult } from 'lit';
import {
  RANDOM_MIX_DIFFICULTIES,
  RANDOM_MIX_MAX_COUNT,
  RANDOM_MIX_NONSTOP_MAX_COUNT,
  resolveRandomMixCount,
  type LR2RandomMixSettings,
  type NonstopConnection,
  type RandomMixConditions,
  type RandomMixCount,
} from '@be-music/player-engine/course';
import { connectionSelect, RANDOM_MIX_FIELDS, randomMixSelect } from '../course-maker-panel.ts';
import { playerText } from '../player-copy.ts';

// The RANDOM MIX dialog: deciding a RANDOM MIX bar asks which charts to draw from (key modes, a level range or the
// difficulties) and how many stages (or endless), with the draw settings the Options dialog's My courses also sets
// (LR2's favorite level, BPM range and BPM limits, and a NONSTOP mix's connection), then OK starts the mix. It opens on
// what was last confirmed, and says how many charts match; OK is off while none does.

const DIFFICULTY_NAMES: Readonly<Record<number, string>> = {
  1: 'BEGINNER',
  2: 'NORMAL',
  3: 'HYPER',
  4: 'ANOTHER',
  5: 'INSANE',
};

/** What the dialog is opened with. */
export interface RandomMixDialogRequest {
  /** The course folder the RANDOM MIX bar is in: a NONSTOP mix has at most five stages and no endless count. */
  kind: 'expert' | 'nonstop';
  /** The key modes the library has, ascending: the ones offered. */
  keyModes: readonly number[];
  /** The conditions the dialog opens on (the last ones confirmed). */
  initial: RandomMixConditions;
  /** LR2's RANDOM MIX settings, as the Options dialog's My courses last set them. */
  settings: LR2RandomMixSettings;
  /** The connection a NONSTOP draw gets after every stage (LR2's button 268). */
  defaultConnection: NonstopConnection;
  /** How many charts fit `conditions`. */
  countMatches: (conditions: RandomMixConditions) => number;
  /**
   * Whether a chart that fits can be stage 1 under the draw settings (`hasRandomMixFirstStage`): a BPM range lets only
   * a chart that keeps one BPM be stage 1, and the BPM limits apply, which the count does not read. Asked on OK only.
   */
  canStart: (choice: RandomMixDialogChoice) => boolean;
}

/** What OK confirms: the conditions, LR2's RANDOM MIX settings and the NONSTOP connection. */
export interface RandomMixDialogChoice {
  conditions: RandomMixConditions;
  settings: LR2RandomMixSettings;
  defaultConnection: NonstopConnection;
}

/** Toggles `value` in a sorted set of numbers. */
export function toggleRandomMixValue(values: readonly number[], value: number, on: boolean): number[] {
  const set = new Set(values);
  if (on) set.add(value);
  else set.delete(value);
  return [...set].sort((a, b) => a - b);
}

/**
 * The conditions as the dialog first shows them: key modes the library lacks are dropped (all offered ones when none is
 * left), and a NONSTOP mix's count is capped.
 */
export function resolveRandomMixDialogConditions(
  request: Pick<RandomMixDialogRequest, 'kind' | 'keyModes' | 'initial'>,
): RandomMixConditions {
  const offered = request.initial.keyModes.filter((keyMode) => request.keyModes.includes(keyMode));
  return {
    ...request.initial,
    keyModes: offered.length > 0 ? offered : [...request.keyModes],
    count: resolveRandomMixCount(request.kind, request.initial.count),
  };
}

/** An integer in `[min, max]` from a number input; `fallback` while the input is empty or not a number. */
function readInteger(input: HTMLInputElement, min: number, max: number, fallback: number): number {
  const value = Number.parseInt(input.value, 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/** How the dialog closed: what it held then (kept as the next one's start, OK or not) and whether OK confirmed it. */
export interface RandomMixDialogResult {
  choice: RandomMixDialogChoice;
  confirmed: boolean;
}

/**
 * Opens the RANDOM MIX dialog. Resolves what it held when it closed and whether OK confirmed it (Escape and Cancel do
 * not). A dialog already open is left as it is and resolves `undefined`.
 */
export function promptRandomMixConditions(request: RandomMixDialogRequest): Promise<RandomMixDialogResult | undefined> {
  const dialog = document.querySelector<HTMLDialogElement>('#random-mix-dialog');
  if (dialog === null || dialog.open) return Promise.resolve(undefined);
  let choice: RandomMixDialogChoice = {
    conditions: resolveRandomMixDialogConditions(request),
    settings: { ...request.settings },
    defaultConnection: request.defaultConnection,
  };
  // Set when OK found no chart that can be stage 1; any change clears it.
  let blocked = false;
  const update = (next: Partial<RandomMixDialogChoice>): void => {
    choice = { ...choice, ...next };
    blocked = false;
    draw();
  };
  const block = (): void => {
    blocked = true;
    draw();
  };
  const draw = (): void => {
    render(template(request, choice, update, { blocked, block }), dialog);
  };
  draw();
  dialog.returnValue = '';
  // The dialog owns keyboard navigation; its keys must not reach the select screen behind it.
  dialog.onkeydown = (event) => event.stopPropagation();
  return new Promise((resolve) => {
    dialog.addEventListener(
      'close',
      () => {
        const confirmed =
          dialog.returnValue === 'ok' && request.countMatches(choice.conditions) > 0 && request.canStart(choice);
        resolve({ choice, confirmed });
      },
      { once: true },
    );
    dialog.showModal();
  });
}

/** A count field: a number from 1 to `max`, or Infinity when `infinite` is allowed. */
function countField(
  id: string,
  label: string,
  value: RandomMixCount,
  max: number,
  infinite: boolean,
  set: (value: RandomMixCount) => void,
): TemplateResult {
  const t = playerText().course.randomMixDialog;
  const endless = value === 'infinity';
  return html`<div class="random-mix-row">
    <label class="label" for=${id}>${label}</label>
    <div class="random-mix-count">
      <input
        class="input random-mix-number"
        id=${id}
        type="number"
        min="1"
        max=${max}
        step="1"
        inputmode="numeric"
        .value=${endless ? '' : String(value)}
        ?disabled=${endless}
        @input=${(event: Event) => {
          // Kept as typed, so Enter (which submits before a change event) confirms what is shown.
          const input = event.currentTarget as HTMLInputElement;
          if (input.value.trim() !== '') set(readInteger(input, 1, max, endless ? 1 : value));
        }}
        @change=${(event: Event) => {
          const input = event.currentTarget as HTMLInputElement;
          const next = readInteger(input, 1, max, endless ? 1 : value);
          input.value = String(next);
          set(next);
        }}
      />
      ${
        infinite
          ? html`<label class="random-mix-check">
              <input
                class="input"
                type="checkbox"
                .checked=${endless}
                @change=${(event: Event) =>
                  set((event.currentTarget as HTMLInputElement).checked ? 'infinity' : Math.min(max, 5))}
              />
              <span>${t.infinity}</span>
            </label>`
          : nothing
      }
    </div>
  </div>`;
}

function template(
  request: RandomMixDialogRequest,
  choice: RandomMixDialogChoice,
  set: (next: Partial<RandomMixDialogChoice>) => void,
  start: { blocked: boolean; block: () => void },
): TemplateResult {
  const { conditions, settings } = choice;
  const update = (next: Partial<RandomMixConditions>): void => set({ conditions: { ...conditions, ...next } });
  const t = playerText().course.randomMixDialog;
  const matches = request.countMatches(conditions);
  const nonstop = request.kind === 'nonstop';
  const countMax = nonstop ? RANDOM_MIX_NONSTOP_MAX_COUNT : RANDOM_MIX_MAX_COUNT;
  const levelInput = (id: string, label: string, key: 'minLevel' | 'maxLevel') =>
    html`<label class="random-mix-level" for=${id}>
      <span class="label">${label}</span>
      <input
        class="input random-mix-number"
        id=${id}
        type="number"
        min="1"
        max="99"
        step="1"
        inputmode="numeric"
        placeholder=${t.anyLevel}
        .value=${conditions[key] > 0 ? String(conditions[key]) : ''}
        @input=${(event: Event) => {
          const input = event.currentTarget as HTMLInputElement;
          update({ [key]: input.value.trim() === '' ? 0 : readInteger(input, 1, 99, conditions[key]) });
        }}
        @change=${(event: Event) => {
          const input = event.currentTarget as HTMLInputElement;
          const value = input.value.trim() === '' ? 0 : readInteger(input, 1, 99, conditions[key]);
          input.value = value > 0 ? String(value) : '';
          update({ [key]: value });
        }}
      />
    </label>`;
  return html`<form
    method="dialog"
    class="account-dialog-body random-mix-form"
    @keydown=${(event: KeyboardEvent) => {
      // Enter in a field confirms with OK, not with Cancel, the form's first submit button.
      if (event.key !== 'Enter' || !(event.target instanceof HTMLInputElement)) return;
      event.preventDefault();
      const form = event.currentTarget as HTMLFormElement;
      const ok = form.querySelector<HTMLButtonElement>('button[value="ok"]');
      if (ok !== null && !ok.disabled) form.requestSubmit(ok);
    }}
    @submit=${(event: SubmitEvent) => {
      // OK keeps the dialog open, and says why, when no chart that fits can be stage 1 under the draw settings.
      if ((event.submitter as HTMLButtonElement | null)?.value !== 'ok' || request.canStart(choice)) return;
      event.preventDefault();
      start.block();
    }}
  >
    <header>
      <h2 id="random-mix-dialog-title">${t.title}</h2>
      <p id="random-mix-dialog-hint">${t.hint}</p>
    </header>
    <fieldset class="random-mix-group">
      <legend class="label">${t.keys}</legend>
      <div class="random-mix-choices">
        ${request.keyModes.map(
          (keyMode) =>
            html`<label class="random-mix-check">
              <input
                class="input"
                type="checkbox"
                name="key-mode"
                value=${keyMode}
                .checked=${conditions.keyModes.includes(keyMode)}
                @change=${(event: Event) =>
                  update({
                    keyModes: toggleRandomMixValue(
                      conditions.keyModes,
                      keyMode,
                      (event.currentTarget as HTMLInputElement).checked,
                    ),
                  })}
              />
              <span>${t.keyMode(keyMode)}</span>
            </label>`,
        )}
      </div>
    </fieldset>
    <fieldset class="random-mix-group">
      <legend class="label">${t.narrowBy}</legend>
      <div class="random-mix-choices" role="radiogroup">
        ${(['level', 'difficulty'] as const).map(
          (by) =>
            html`<label class="random-mix-check">
              <input
                class="input"
                type="radio"
                name="random-mix-by"
                value=${by}
                .checked=${conditions.by === by}
                @change=${() => update({ by })}
              />
              <span>${by === 'level' ? t.byLevel : t.byDifficulty}</span>
            </label>`,
        )}
      </div>
      ${
        conditions.by === 'level'
          ? html`<div class="random-mix-levels">
              ${levelInput('random-mix-min-level', t.minLevel, 'minLevel')}
              <span class="random-mix-dash" aria-hidden="true">–</span>
              ${levelInput('random-mix-max-level', t.maxLevel, 'maxLevel')}
            </div>`
          : html`<div class="random-mix-choices" aria-label=${t.difficulty}>
                ${RANDOM_MIX_DIFFICULTIES.map(
                  (difficulty) =>
                    html`<label class="random-mix-check">
                      <input
                        class="input"
                        type="checkbox"
                        name="difficulty"
                        value=${difficulty}
                        .checked=${conditions.difficulties.includes(difficulty)}
                        @change=${(event: Event) =>
                          update({
                            difficulties: toggleRandomMixValue(
                              conditions.difficulties,
                              difficulty,
                              (event.currentTarget as HTMLInputElement).checked,
                            ),
                          })}
                      />
                      <span>${DIFFICULTY_NAMES[difficulty]}</span>
                    </label>`,
                )}
              </div>
              <label class="random-mix-check">
                <input
                  class="input"
                  type="checkbox"
                  name="estimate-difficulty"
                  .checked=${conditions.estimateDifficulty}
                  @change=${(event: Event) =>
                    update({ estimateDifficulty: (event.currentTarget as HTMLInputElement).checked })}
                />
                <span>${t.estimateDifficulty}</span>
              </label>`
      }
    </fieldset>
    <div class="random-mix-group">
      ${countField('random-mix-count', t.count, conditions.count, countMax, !nonstop, (count) => update({ count }))}
      ${nonstop ? html`<p class="random-mix-note">${t.nonstopLimit(RANDOM_MIX_NONSTOP_MAX_COUNT)}</p>` : nothing}
    </div>
    <fieldset class="random-mix-group">
      <legend class="label">${t.settings}</legend>
      <div class="random-mix-settings">
        ${RANDOM_MIX_FIELDS.map(
          ({ setting, label }) =>
            html`<label class="random-mix-setting"
              ><span class="label">${label()}</span> ${randomMixSelect(setting, settings[setting], (value) =>
                set({ settings: { ...settings, [setting]: value } }),
              )}</label
            >`,
        )}
        ${
          nonstop
            ? html`<label class="random-mix-setting"
                ><span class="label">${t.defaultConnection}</span>
                ${connectionSelect(choice.defaultConnection, (defaultConnection) => set({ defaultConnection }))}</label
              >`
            : nothing
        }
      </div>
      <label class="random-mix-check">
        <input
          class="input"
          type="checkbox"
          name="allow-bpm-changes"
          .checked=${conditions.allowBPMChanges}
          @change=${(event: Event) => update({ allowBPMChanges: (event.currentTarget as HTMLInputElement).checked })}
        />
        <span>${t.allowBPMChanges}</span>
      </label>
    </fieldset>
    <p class="random-mix-matches" role="status" aria-live="polite" data-empty=${matches === 0 || start.blocked}>
      ${matches === 0 ? t.noMatch : start.blocked ? t.noFirstStage(matches) : t.matches(matches)}
    </p>
    <footer>
      <button type="submit" value="" class="btn" data-variant="outline">${t.cancel}</button>
      <button type="submit" value="ok" class="btn" ?disabled=${matches === 0} autofocus>${t.ok}</button>
    </footer>
  </form>`;
}
