import { html, nothing, render, type TemplateResult } from 'lit';
import {
  RANDOM_MIX_DIFFICULTIES,
  RANDOM_MIX_MAX_COUNT,
  RANDOM_MIX_MAX_LOOPS,
  RANDOM_MIX_NONSTOP_MAX_COUNT,
  resolveRandomMixCount,
  type RandomMixConditions,
  type RandomMixCount,
} from '@be-music/player-engine/course';
import { playerText } from '../player-copy.ts';

// The RANDOM MIX dialog: deciding a RANDOM MIX bar asks which charts to draw from (key modes, a level range or the
// difficulties), how many stages (or endless) and how many draws in a row (or endless), then OK starts the mix. It opens
// on the conditions last confirmed, and says how many charts match; OK is off while none does.

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
  /** How many charts fit `conditions`. */
  countMatches: (conditions: RandomMixConditions) => number;
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
  request: Omit<RandomMixDialogRequest, 'countMatches'>,
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

/**
 * Opens the RANDOM MIX dialog. Resolves the conditions confirmed with OK, or `undefined` when it was cancelled (Escape,
 * Cancel). A dialog already open is left as it is and resolves `undefined`.
 */
export function promptRandomMixConditions(request: RandomMixDialogRequest): Promise<RandomMixConditions | undefined> {
  const dialog = document.querySelector<HTMLDialogElement>('#random-mix-dialog');
  if (dialog === null || dialog.open) return Promise.resolve(undefined);
  let conditions = resolveRandomMixDialogConditions(request);
  const update = (next: Partial<RandomMixConditions>): void => {
    conditions = { ...conditions, ...next };
    draw();
  };
  const draw = (): void => {
    render(template(request, conditions, update), dialog);
  };
  draw();
  dialog.returnValue = '';
  // The dialog owns keyboard navigation; its keys must not reach the select screen behind it.
  dialog.onkeydown = (event) => event.stopPropagation();
  return new Promise((resolve) => {
    dialog.addEventListener(
      'close',
      () => {
        const confirmed = dialog.returnValue === 'ok' && request.countMatches(conditions) > 0;
        resolve(confirmed ? conditions : undefined);
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
  conditions: RandomMixConditions,
  update: (next: Partial<RandomMixConditions>) => void,
): TemplateResult {
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
            </div>`
      }
    </fieldset>
    <div class="random-mix-group">
      ${countField('random-mix-count', t.count, conditions.count, countMax, !nonstop, (count) => update({ count }))}
      ${nonstop ? html`<p class="random-mix-note">${t.nonstopLimit(RANDOM_MIX_NONSTOP_MAX_COUNT)}</p>` : nothing}
      ${countField('random-mix-loops', t.loops, conditions.loops, RANDOM_MIX_MAX_LOOPS, true, (loops) =>
        update({ loops }),
      )}
    </div>
    <p class="random-mix-matches" role="status" aria-live="polite" data-empty=${matches === 0}>
      ${matches > 0 ? t.matches(matches) : t.noMatch}
    </p>
    <footer>
      <button type="submit" value="" class="btn" data-variant="outline">${t.cancel}</button>
      <button type="submit" value="ok" class="btn" ?disabled=${matches === 0} autofocus>${t.ok}</button>
    </footer>
  </form>`;
}
