/**
 * Decode a byte buffer with the named encoding via the platform `TextDecoder`. Throws if the
 * runtime doesn't recognise the encoding name (some browsers gate non-UTF-8 decoders).
 */
export function decodeText(bytes: Uint8Array, encoding: string): string {
  return new TextDecoder(encoding).decode(bytes);
}

/**
 * Lightweight read-text overlay. Injects a `<dialog>` at body root, populates it with the
 * decoded chart notes, and wires Escape / outside-click dismissal. Replaces any prior overlay
 * so repeated clicks just rebuild the panel against the latest song.
 */
export function showReadtextOverlay(opts: { title: string; filename: string; body: string }): void {
  if (typeof document === 'undefined') return;
  // Tear down any prior overlay so back-to-back clicks don't stack.
  const existing = document.getElementById('beatoraja-readtext-overlay');
  if (existing !== null && existing instanceof HTMLDialogElement) {
    existing.close();
    existing.remove();
  }
  const dialog = document.createElement('dialog');
  dialog.id = 'beatoraja-readtext-overlay';
  // Inline styles — avoids needing a CSS file edit for this one-off surface.
  dialog.style.maxWidth = 'min(640px, 80vw)';
  dialog.style.maxHeight = '70vh';
  dialog.style.padding = '0';
  dialog.style.border = '1px solid #333';
  dialog.style.borderRadius = '6px';
  dialog.style.background = '#111';
  dialog.style.color = '#eee';
  dialog.style.fontFamily = 'sans-serif';
  dialog.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.6)';

  const header = document.createElement('div');
  header.style.padding = '10px 14px';
  header.style.borderBottom = '1px solid #333';
  header.style.fontSize = '13px';
  header.textContent = `${opts.title}  〔${opts.filename}〕`;
  dialog.appendChild(header);

  const body = document.createElement('pre');
  body.textContent = opts.body;
  body.style.margin = '0';
  body.style.padding = '12px 14px';
  body.style.maxHeight = 'calc(70vh - 80px)';
  body.style.overflow = 'auto';
  body.style.whiteSpace = 'pre-wrap';
  body.style.wordBreak = 'break-word';
  body.style.fontFamily = 'inherit';
  body.style.fontSize = '13px';
  body.style.lineHeight = '1.5';
  dialog.appendChild(body);

  document.body.appendChild(dialog);
  // Native `<dialog>` Escape handling closes us; outside-click via the backdrop pattern.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) {
      dialog.close();
      dialog.remove();
    }
  });
  dialog.addEventListener('close', () => {
    dialog.remove();
  });
  dialog.showModal();
}
