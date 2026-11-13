import { html, nothing, render, type TemplateResult } from 'lit';
import type { CourseView } from '@be-music/player-scene-model';
import { CONNECTION_LABELS, RANDOM_MIX_FIELDS } from '../course-maker-panel.ts';
import { formatLR2RandomMixSetting } from '@be-music/skin-lr2/state';
import { playerText } from '../player-copy.ts';
import { RANDOM_MIX_DIFFICULTY_NAMES } from './random-mix-dialog.ts';
import { formatRandomMixSaveName, type RandomMixSaveRequest, type RandomMixSetup } from '../random-mix-save.ts';

// The RANDOM MIX save dialog: once a RANDOM MIX run is over (played through or given up) and its result left, the select
// screen asks whether to keep the run's course as one of the player's own. It is named by the date and time the run
// ended unless the player types another name, lists the stages drawn, and shows the settings the run was started with,
// which it cannot change: they are what drew these stages.

/** One line of the settings the dialog shows. */
export interface RandomMixSetupRow {
  label: string;
  value: string;
}

/** The settings a run was started with, as the dialog lists them, in the RANDOM MIX dialog's order. */
export function describeRandomMixSetup(setup: RandomMixSetup): RandomMixSetupRow[] {
  const t = playerText().course.randomMixDialog;
  const save = playerText().course.randomMixSave;
  const { conditions, settings } = setup;
  const onOff = (on: boolean): string => (on ? save.on : save.off);
  const level = (value: number): string => (value > 0 ? String(value) : t.anyLevel);
  const rows: RandomMixSetupRow[] = [
    { label: save.kind, value: setup.kind === 'nonstop' ? 'NONSTOP' : 'EXPERT' },
    { label: t.keys, value: t.keyMode(conditions.keyMode) },
  ];
  if (conditions.by === 'level') {
    rows.push({ label: t.byLevel, value: `${level(conditions.minLevel)} – ${level(conditions.maxLevel)}` });
  } else {
    const names = conditions.difficulties.map((difficulty) => RANDOM_MIX_DIFFICULTY_NAMES[difficulty] ?? difficulty);
    rows.push(
      { label: t.byDifficulty, value: names.length > 0 ? names.join(', ') : save.none },
      { label: t.estimateDifficulty, value: onOff(conditions.estimateDifficulty) },
    );
  }
  rows.push({ label: t.count, value: conditions.count === 'infinity' ? t.infinity : String(conditions.count) });
  for (const { setting, label } of RANDOM_MIX_FIELDS) {
    rows.push({ label: label(), value: formatLR2RandomMixSetting(setting, settings[setting]) });
  }
  if (setup.kind === 'nonstop') {
    rows.push({ label: t.defaultConnection, value: CONNECTION_LABELS[setup.defaultConnection] });
  }
  rows.push({ label: t.allowBPMChanges, value: onOff(conditions.allowBPMChanges) });
  return rows;
}

/**
 * Opens the save dialog. Resolves the name to save the course under when Save is pressed (the offered one when the field
 * is left blank), or `undefined` when the player does not save it (Don't save, Escape). A dialog already open is left
 * as it is and resolves `undefined`.
 */
export function promptRandomMixSave(request: RandomMixSaveRequest): Promise<string | undefined> {
  const dialog = document.querySelector<HTMLDialogElement>('#random-mix-save-dialog');
  if (dialog === null || dialog.open) return Promise.resolve(undefined);
  const offered = formatRandomMixSaveName(request.endedAt);
  let name = offered;
  render(
    template(request, offered, (value) => {
      name = value;
    }),
    dialog,
  );
  dialog.returnValue = '';
  // The dialog owns keyboard navigation; its keys must not reach the select screen behind it.
  dialog.onkeydown = (event) => event.stopPropagation();
  return new Promise((resolve) => {
    dialog.addEventListener(
      'close',
      () => resolve(dialog.returnValue === 'save' ? name.trim() || offered : undefined),
      { once: true },
    );
    dialog.showModal();
  });
}

function stageLine(stage: CourseView['stages'][number]): TemplateResult {
  return html`<li class="random-mix-save-stage">
    <span class="random-mix-save-title"
      >${stage.title}${stage.subtitle !== undefined && stage.subtitle !== '' ? html` <small>${stage.subtitle}</small>` : nothing}</span
    >
    ${stage.artist !== undefined && stage.artist !== '' ? html`<span class="random-mix-save-artist">${stage.artist}</span>` : nothing}
  </li>`;
}

function template(request: RandomMixSaveRequest, offered: string, setName: (name: string) => void): TemplateResult {
  const t = playerText().course.randomMixSave;
  return html`<form
    method="dialog"
    class="account-dialog-body random-mix-form"
    @keydown=${(event: KeyboardEvent) => {
      // Enter in the name field saves, not the form's first submit button (Don't save).
      if (event.key !== 'Enter' || !(event.target instanceof HTMLInputElement)) return;
      event.preventDefault();
      const form = event.currentTarget as HTMLFormElement;
      form.requestSubmit(form.querySelector<HTMLButtonElement>('button[value="save"]'));
    }}
  >
    <header>
      <h2 id="random-mix-save-dialog-title">${t.title}</h2>
      <p id="random-mix-save-dialog-hint">${t.hint}</p>
    </header>
    <div class="random-mix-row">
      <label class="label" for="random-mix-save-name">${t.name}</label>
      <input
        class="input random-mix-save-name"
        id="random-mix-save-name"
        type="text"
        autocomplete="off"
        .value=${offered}
        placeholder=${offered}
        @input=${(event: Event) => setName((event.currentTarget as HTMLInputElement).value)}
      />
    </div>
    <section class="random-mix-group" aria-labelledby="random-mix-save-stages">
      <h3 class="label" id="random-mix-save-stages">${t.stages(request.course.stages.length)}</h3>
      <ol class="random-mix-save-stages">
        ${request.course.stages.map(stageLine)}
      </ol>
    </section>
    <section class="random-mix-group" aria-labelledby="random-mix-save-settings">
      <h3 class="label" id="random-mix-save-settings">${t.settings}</h3>
      <dl class="random-mix-save-setup">
        ${describeRandomMixSetup(request.setup).map(
          (row) =>
            html`<div class="random-mix-save-row">
              <dt>${row.label}</dt>
              <dd>${row.value}</dd>
            </div>`,
        )}
      </dl>
      <p class="random-mix-note">${t.settingsFixed}</p>
    </section>
    <footer>
      <button type="submit" value="" class="btn" data-variant="outline">${t.discard}</button>
      <button type="submit" value="save" class="btn" autofocus>${t.save}</button>
    </footer>
  </form>`;
}
