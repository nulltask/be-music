import type { BindingApi } from '@tweakpane/core';
import type { ButtonApi, FolderApi, ListInputBindingApi } from 'tweakpane';

/** Native binding handle used where the menu stores controls of different value types. */
export type PaneBinding = BindingApi;

/** Convert value presets to Tweakpane's labelled list items. */
export function paneOptions<T>(values: readonly T[] | Record<string, T>): { text: string; value: T }[] {
  return Array.isArray(values)
    ? values.map((value) => ({ text: String(value), value }))
    : Object.entries(values).map(([text, value]) => ({ text, value }));
}

/** A native list binding, with public mutable options for theme discovery. */
export function selectBinding<O extends object, K extends keyof O>(
  parent: Pick<FolderApi, 'addBinding'>,
  object: O,
  key: K,
  label: string,
  options: readonly O[K][] | Record<string, O[K]>,
): ListInputBindingApi<O[K]> {
  return parent.addBinding(object, key, { label, options: paneOptions(options) }) as ListInputBindingApi<O[K]>;
}

export function setDisabled(control: { disabled: boolean } | undefined, disabled: boolean): void {
  if (control) control.disabled = disabled;
}

export function setButtonTitle(control: Pick<ButtonApi, 'title'> | undefined, title: string): void {
  if (control) control.title = title;
}

/** The renderer may not have created its ticker when pane monitoring starts. */
export function monitorFrameRate(ticker: { readonly FPS?: number } | undefined): number {
  const fps = ticker?.FPS;
  return typeof fps === 'number' && Number.isFinite(fps) ? Math.max(0, fps) : 0;
}
