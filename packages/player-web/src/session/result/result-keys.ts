/** The subset of a `KeyboardEvent` the result-screen key matchers read. */
export interface ResultKeyEvent {
  key: string;
  repeat: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/**
 * Whether a key press asks the result screen to retry the chart: a bare R (either case, so Caps Lock doesn't get in
 * the way). Presses with a modifier are left alone so browser shortcuts such as Ctrl / Cmd+R (reload) keep working,
 * and auto-repeats are ignored so a held key can't fire a second retry.
 */
export function isResultRetryKey(event: ResultKeyEvent): boolean {
  if (event.repeat) return false;
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
  return event.key === 'r' || event.key === 'R';
}
