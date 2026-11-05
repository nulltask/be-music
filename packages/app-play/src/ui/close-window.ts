/** Requests a browser window close, reporting when the browser keeps this context alive. */
export function requestPlayerWindowClose(
  win: Pick<Window, 'close' | 'closed' | 'setTimeout'>,
  onBlocked: () => void,
): void {
  win.close();
  win.setTimeout(() => {
    if (!win.closed) onBlocked();
  }, 250);
}
