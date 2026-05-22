import { summarizeBrowserCompat, type BrowserCompatReport } from '@be-music/player-web/collection';

/**
 * Renders the browser-compatibility diagnostic panel that lives alongside (not inside) the drop card. Feature support
 * doesn't change at runtime so this is a one-shot side-effect — call once at boot and the DOM stays in sync for the
 * session.
 *
 * The panel is the *only* place the compat verdict surfaces; the drop card stays focused on its call-to-action. When
 * required features are missing the panel flips into a red "Browser not supported" mode and lists each missing item
 * with its dependency note, so the user can identify exactly what's blocking them.
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

  if (report.ok) {
    // Distinguish "everything works" from "core works but you're missing some optional niceties" — the latter is still
    // a green verdict but the count tells power users at a glance whether Web­Codecs / WebGPU / etc. are reachable.
    const missingOptional = report.items.filter((item) => !item.required && !item.supported).length;
    statusLabel.textContent =
      missingOptional > 0 ? `Browser ready · ${missingOptional} optional missing` : 'Browser ready';
  } else {
    statusLabel.textContent = summarizeBrowserCompat(report) ?? 'Browser not supported';
  }

  requiredList.replaceChildren();
  optionalList.replaceChildren();
  for (const item of report.items) {
    const target = item.required ? requiredList : optionalList;
    target.appendChild(buildCompatRow(item));
  }
}

/**
 * Builds one feature row inside the compat panel. Status color is encoded both as a CSS modifier class (drives the
 * icon / background) and as a screen-reader-friendly text fallback so the verdict is accessible without color vision.
 */
function buildCompatRow(item: BrowserCompatReport['items'][number]): HTMLLIElement {
  const li = document.createElement('li');
  // `ok` = supported, `warn` = optional & missing (the player still works), `fail` = required & missing (player won't
  // function). Required-supported and optional-supported both map to `ok` — visual hierarchy comes from the section
  // split (Required vs Optional) above, not from a distinction here.
  const status = item.supported ? 'ok' : item.required ? 'fail' : 'warn';
  li.className = `compat-row compat-row--${status}`;
  li.title = item.note;

  const icon = document.createElement('span');
  icon.className = 'compat-row-icon';
  icon.setAttribute('aria-hidden', 'true');
  // Plain text glyphs over inline SVG — keeps the markup compact and lets us color the glyph via `color:
  // currentColor`. The accessibility verdict is carried by the screen-reader text span below, not by the symbol.
  icon.textContent = item.supported ? '✓' : item.required ? '✕' : '–';
  li.appendChild(icon);

  const label = document.createElement('span');
  label.className = 'compat-row-label';
  label.textContent = item.label;
  li.appendChild(label);

  const sr = document.createElement('span');
  sr.className = 'compat-row-sr';
  // Read-aloud text for assistive tech — `✓` / `✕` / `–` carry visual semantics but no name on their own. `aria-hidden`
  // on the icon hands the verdict to this hidden label instead.
  sr.textContent = item.supported ? 'supported' : item.required ? 'missing (required)' : 'missing (optional)';
  li.appendChild(sr);

  return li;
}
