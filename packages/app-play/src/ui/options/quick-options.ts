import { resolveGaugeTypes } from '@be-music/player-engine/ruleset';
import { HISPEED_MAX, HISPEED_MIN, HISPEED_STEP, PLAY_OPTION_CHOICES } from '@be-music/player-scene-model';
import { selectBinding, type PaneBinding } from '../../pane-controls.ts';
import { OptionFolder } from '../options-controls.ts';
import type { OptionsDialog } from './index.ts';
import { laneOptionItems } from './play-option-items.ts';
import { hiSpeedControl, onGrid } from './play-options.ts';
// The quick options panel: the options a player changes most between charts and during one, in a panel that opens and
// closes at the stage's bottom right, on the select and play screens. Its controls set the same values as the Options
// dialog's, with the same effects; the ones a play reads as it starts are disabled during one, as in the dialog. Built
// with the dialog as `this` (`OptionsDialog`).

/** The panel's heading, which `labels.ts` translates. */
export const QUICK_OPTIONS_TITLE = 'Quick options';

/** The labels of the panel's rows, top to bottom: the dialog's own, so they read and translate the same. */
export const QUICK_OPTION_LABELS = [
  'Random 1P',
  'Gauge',
  'Auto play',
  'HS-FIX',
  'Hi-speed',
  'Effect 1P',
  'Cover height',
] as const;

/** Builds the panel into `container`, folded until opened; returns it. */
export function buildQuickOptionsPanel(this: OptionsDialog, container: HTMLElement): OptionFolder {
  const panel = OptionFolder.panel(container, { title: QUICK_OPTIONS_TITLE, expanded: false });
  panel.element.classList.add('quick-options-panel');
  const track = (controller: PaneBinding): PaneBinding => this.trackPlayOption(controller);
  // A change here shows in the dialog too, which reads the same values.
  const changed = (): void => this.gui?.refresh();

  this.quickRandom1PController = selectBinding(
    panel,
    this.guiState,
    'random1P',
    'Random 1P',
    Object.fromEntries(laneOptionItems(this.guiState.judgeRuleset).map((item) => [item.text, item.value])),
  );
  track(
    this.quickRandom1PController.on('change', ({ value }) => {
      this.setPlayOptions({ random1P: value });
      this.refreshRulesetChoices();
      changed();
    }),
  );
  this.quickGaugeController = selectBinding(
    panel,
    this.guiState,
    'gauge',
    'Gauge',
    resolveGaugeTypes(this.guiState.judgeRuleset),
  );
  track(
    this.quickGaugeController.on('change', ({ value }) => {
      this.setPlayOptions({ gauge1P: value });
      changed();
    }),
  );
  track(
    panel.addBinding(this.guiState, 'autoPlay', { label: 'Auto play' }).on('change', ({ value }) => {
      this.setPlayOptions({ autoPlay: value });
      changed();
    }),
  );
  this.quickHsFixController = selectBinding(panel, this.guiState, 'hsFix', 'HS-FIX', PLAY_OPTION_CHOICES.hsFix!);
  track(
    this.quickHsFixController.on('change', ({ value }) => {
      this.setPlayOptions({ hsFix: value });
      changed();
    }),
  );
  // The hi-speed, the covers and their height apply to a running play live, so they stay enabled during one.
  const regular = (): boolean =>
    !this.guiState.classicHiSpeed && !this.guiState.floatingHiSpeed && !(this.guiState.normalHiSpeedLevel > 0);
  this.quickHiSpeedController = panel
    .addBinding(
      hiSpeedControl(this.guiState, regular, onGrid(HISPEED_STEP), (value) => this.deps.rememberHiSpeed(value, 'menu')),
      'hiSpeed',
      { label: 'Hi-speed', min: HISPEED_MIN, max: HISPEED_MAX, step: HISPEED_STEP },
    )
    .on('change', changed);
  selectBinding(panel, this.guiState, 'hiddenSudden1P', 'Effect 1P', PLAY_OPTION_CHOICES.hiddenSudden1P!).on(
    'change',
    ({ value }) => {
      this.setCoverOptions({ hiddenSudden1P: value });
      changed();
    },
  );
  panel
    .addBinding(this.guiState, 'shutter', { label: 'Cover height', min: 0, max: 1, step: 0.01 })
    .on('change', ({ value }) => {
      this.setCoverOptions({ shutter: value });
      changed();
    });
  return panel;
}
