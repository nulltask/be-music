import type { OptionBinding, OptionButton, OptionContainer } from './ui/options-controls.ts';
import { toChoices, type OptionChoice } from './ui/options-values.ts';

/** A binding handle, where the menu stores controls of different value types. */
export type PaneBinding = OptionBinding<unknown>;

/** Value presets as a select's labelled choices. */
export function paneOptions<T>(values: readonly T[] | Record<string, T>): OptionChoice<T>[] {
  return toChoices(values);
}

/** A select binding, whose `options` can be replaced as themes are discovered. */
export function selectBinding<O extends object, K extends keyof O>(
  parent: Pick<OptionContainer, 'addBinding'>,
  object: O,
  key: K,
  label: string,
  options: readonly O[K][] | Record<string, O[K]>,
): OptionBinding<O[K]> {
  return parent.addBinding(object, key, { label, options: paneOptions(options) });
}

export function setDisabled(control: { disabled: boolean } | undefined, disabled: boolean): void {
  if (control) control.disabled = disabled;
}

export function setButtonTitle(control: Pick<OptionButton, 'title'> | undefined, title: string): void {
  if (control) control.title = title;
}

/** The renderer may not have created its ticker when the FPS monitor starts. */
export function monitorFrameRate(ticker: { readonly FPS?: number } | undefined): number {
  const fps = ticker?.FPS;
  return typeof fps === 'number' && Number.isFinite(fps) ? Math.max(0, fps) : 0;
}
