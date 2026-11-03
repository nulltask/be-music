import { html, render, type TemplateResult } from 'lit';
import { summarizeBrowserCompat, type BrowserCompatReport } from '@be-music/player-browser/collection';
import { playerText } from './player-copy.ts';

/**
 * Renders the browser-compatibility check, folded inside the drop card under the Leaderboard row. Feature support
 * doesn't change at runtime so this is a one-shot side-effect — call once at boot and the DOM stays in sync for the
 * session.
 *
 * The panel is the *only* place the compat verdict surfaces. When required features are missing it flips into a red
 * "Browser not supported" mode, opens, and lists each missing item with its dependency note, so the user can identify
 * exactly what's blocking them.
 */
export function renderBrowserCompatPanel(report: BrowserCompatReport): void {
  const panel = document.querySelector<HTMLElement>('#compat-panel');
  const requiredList = document.querySelector<HTMLUListElement>('#compat-panel-required');
  const optionalList = document.querySelector<HTMLUListElement>('#compat-panel-optional');
  const statusLabel = document.querySelector<HTMLDivElement>('#compat-panel-status');
  if (!panel || !requiredList || !optionalList || !statusLabel) return;

  // `--ok` / `--fail` toggles the badge palette and the check-vs-cross mark visibility (the two icon `<path>`s share
  // the SVG, only one is shown at a time per CSS).
  panel.classList.toggle('compat-panel--ok', report.ok);
  panel.classList.toggle('compat-panel--fail', !report.ok);
  // Folded while everything required works; a missing feature opens it, since that is what the player needs to see.
  if (panel instanceof HTMLDetailsElement) panel.open = !report.ok;

  const shell = playerText().shell;
  if (report.ok) {
    // Distinguish "everything works" from "core works but you're missing some optional niceties" — the latter is still
    // a green verdict but the count tells power users at a glance whether Web­Codecs / WebGPU / etc. are reachable.
    const missingOptional = report.items.filter((item) => !item.required && !item.supported).length;
    render(missingOptional > 0 ? shell.optionalMissing(missingOptional) : shell.browserReady, statusLabel);
  } else {
    const summary = summarizeBrowserCompat(report);
    const missing = summary?.startsWith('Missing required: ') ? summary.slice('Missing required: '.length) : undefined;
    render(missing !== undefined ? shell.missingRequired(missing) : (summary ?? shell.browserUnsupported), statusLabel);
  }

  render(report.items.filter((item) => item.required).map(compatRow), requiredList);
  render(report.items.filter((item) => !item.required).map(compatRow), optionalList);
}

/**
 * Renders one feature row inside the compat panel. Status color is encoded both as a CSS modifier class (drives the
 * icon / background) and as a screen-reader-friendly text fallback so the verdict is accessible without color vision.
 */
function compatRow(item: BrowserCompatReport['items'][number]): TemplateResult {
  const status = item.supported ? 'ok' : item.required ? 'fail' : 'warn';
  const { compatNotes: notes, shell } = playerText();
  const note = item.id in notes ? notes[item.id as keyof typeof notes] : item.note;
  return html`<li class=${`compat-row compat-row--${status}`} title=${note}>
    <span class="compat-row-icon" aria-hidden="true">${item.supported ? '✓' : item.required ? '✕' : '–'}</span>
    <span class="compat-row-label">${item.label}</span>
    <span class="compat-row-sr"
      >${item.supported ? shell.supported : item.required ? shell.missingRequiredItem : shell.missingOptionalItem}</span
    >
  </li>`;
}
