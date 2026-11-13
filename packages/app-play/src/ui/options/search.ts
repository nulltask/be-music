import { html, nothing, render } from 'lit';
// The Options dialog's search: typing in the field at its top lists the options whose name, place, choices or help
// hold every word typed, and picking one opens its tab and shows it.

/** One option as the search reads it: its name as shown, the tabs and sections it sits under, and what else names it. */
export interface OptionSearchEntry {
  readonly label: string;
  readonly path: readonly string[];
  /** Text a search also reads: the name in English, the choices of a list, the help. */
  readonly keywords: string;
}

/** Lower case, with full-width and half-width forms read alike. */
function normalizeSearchText(text: string): string {
  return text.normalize('NFKC').toLowerCase();
}

/**
 * The `entries` every word of `query` is found in, the best first: those whose name holds every word (a name that
 * starts with the query before the others), then those that need their place too, then those only the choices or the
 * help name. Entries of one rank keep their order, and an empty query finds none.
 */
export function searchOptions<T extends OptionSearchEntry>(entries: readonly T[], query: string, limit = 40): T[] {
  const whole = normalizeSearchText(query).trim();
  const words = whole.split(/\s+/u).filter((word) => word !== '');
  if (words.length === 0) return [];
  const ranked: { entry: T; rank: number }[] = [];
  for (const entry of entries) {
    const label = normalizeSearchText(entry.label);
    const place = `${label} ${normalizeSearchText(entry.path.join(' '))}`;
    const all = `${place} ${normalizeSearchText(entry.keywords)}`;
    if (!words.every((word) => all.includes(word))) continue;
    const rank = label.startsWith(whole)
      ? 0
      : words.every((word) => label.includes(word))
        ? 1
        : words.every((word) => place.includes(word))
          ? 2
          : 3;
    ranked.push({ entry, rank });
  }
  return ranked
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit)
    .map(({ entry }) => entry);
}

/** An entry with the row it names. */
interface OptionSearchRow extends OptionSearchEntry {
  readonly row: HTMLElement;
}

const trimmed = (text: string | null | undefined): string => (text ?? '').replace(/\s+/gu, ' ').trim();

/** How long a row found by the search stays marked. */
const HIT_MARK_MS = 1800;

/**
 * Wires the Options dialog's search field (`#options-search`) and result list (`#options-search-results`). The list
 * takes the place of the tabs while there is a query. `describe` gives a row's help as text, in the language shown.
 */
export class OptionSearch {
  private readonly dialog: HTMLDialogElement;
  private readonly body: HTMLElement;
  private readonly field: HTMLInputElement;
  private readonly results: HTMLElement;
  private readonly describe: (row: HTMLElement) => string;
  private readonly emptyText: () => string;
  private found: OptionSearchRow[] = [];

  public constructor(
    dialog: HTMLDialogElement,
    body: HTMLElement,
    describe: (row: HTMLElement) => string,
    emptyText: () => string,
  ) {
    this.dialog = dialog;
    this.body = body;
    this.describe = describe;
    this.emptyText = emptyText;
    this.field = dialog.querySelector<HTMLInputElement>('#options-search') ?? document.createElement('input');
    this.results = dialog.querySelector<HTMLElement>('#options-search-results') ?? document.createElement('div');
    this.field.addEventListener('input', () => this.update());
    this.field.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.field.value !== '') {
        // The first Esc clears the search; the dialog closes on the next.
        event.preventDefault();
        this.clear();
      } else if (event.key === 'Enter' && this.found[0]) {
        event.preventDefault();
        this.reveal(this.found[0].row);
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        this.results.querySelector<HTMLButtonElement>('button')?.focus();
      }
    });
    this.results.addEventListener('keydown', (event) => {
      const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
      if (step === 0) return;
      event.preventDefault();
      const buttons = [...this.results.querySelectorAll<HTMLButtonElement>('button')];
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement) + step;
      if (at < 0) this.field.focus();
      else buttons[Math.min(at, buttons.length - 1)]?.focus();
    });
    dialog.addEventListener('close', () => this.clear());
  }

  /** Empties the field and shows the tabs again. */
  public clear(): void {
    if (this.field.value === '' && this.results.hidden) return;
    this.field.value = '';
    this.update();
  }

  private update(): void {
    const query = this.field.value;
    const searching = query.trim() !== '';
    this.found = searching ? searchOptions(this.entries(), query) : [];
    this.body.hidden = searching;
    this.results.hidden = !searching;
    render(
      !searching
        ? nothing
        : this.found.length === 0
          ? html`<p class="options-search-empty">${this.emptyText()}</p>`
          : html`<ul>
              ${this.found.map(
                (entry) =>
                  html`<li>
                    <button type="button" @click=${() => this.reveal(entry.row)}>
                      <span class="options-search-label">${entry.label}</span>
                      <span class="options-search-path">${entry.path.join(' › ')}</span>
                    </button>
                  </li>`,
              )}
            </ul>`,
      this.results,
    );
    this.results.scrollTop = 0;
  }

  /** The dialog's options that can be shown now: every named row that neither it nor a section around it hides. */
  private entries(): OptionSearchRow[] {
    const entries: OptionSearchRow[] = [];
    for (const row of this.body.querySelectorAll<HTMLElement>('.options-row[data-option-label]')) {
      // A page of tabs not showing still counts; the body itself is hidden while the results show.
      const hider = row.closest('[hidden]:not([role="tabpanel"])');
      if (hider !== null && hider !== this.body) continue;
      const name = row.dataset.optionLabel ?? '';
      const shown = this.shownLabel(row) || name;
      const choices = Array.from(row.querySelector('select')?.options ?? [], (option) => option.text).join(' ');
      entries.push({ row, label: shown, path: this.path(row), keywords: `${name} ${choices} ${this.describe(row)}` });
    }
    return entries;
  }

  /** A row's name as the dialog shows it, with the source its badge names in brackets. */
  private shownLabel(row: HTMLElement): string {
    const label = row.querySelector('.options-label');
    const source = trimmed(label?.querySelector('.options-source')?.textContent);
    const text = trimmed(label?.textContent);
    if (source === '' || !text.endsWith(source)) return text;
    return `${text.slice(0, text.length - source.length).trimEnd()} (${source})`;
  }

  /** The tabs and sections around `row`, outermost first, as the dialog names them. */
  private path(row: HTMLElement): string[] {
    const path: string[] = [];
    for (let node = row.parentElement; node && node !== this.body; node = node.parentElement) {
      let title = '';
      if (node.getAttribute('role') === 'tabpanel') {
        title = trimmed(this.dialog.querySelector(`#${node.getAttribute('aria-labelledby')}`)?.textContent);
      } else if (node.hasAttribute('data-options-folder')) {
        title = trimmed(node.querySelector(':scope > :is(h3, summary)')?.textContent);
      }
      if (title !== '' && path[0] !== title) path.unshift(title);
    }
    return path;
  }

  /** Leaves the search and shows `row`: opens the tabs and folders around it, scrolls to it and marks it a moment. */
  private reveal(row: HTMLElement): void {
    this.clear();
    const around: HTMLElement[] = [];
    for (let node = row.parentElement; node && node !== this.body; node = node.parentElement) around.unshift(node);
    for (const node of around) {
      if (node.getAttribute('role') === 'tabpanel' && node.hidden) {
        this.dialog.querySelector<HTMLElement>(`#${node.getAttribute('aria-labelledby')}`)?.click();
      }
      if (node instanceof HTMLDetailsElement) node.open = true;
    }
    row.scrollIntoView({ block: 'center' });
    row.toggleAttribute('data-search-hit', true);
    setTimeout(() => row.toggleAttribute('data-search-hit', false), HIT_MARK_MS);
    row
      .querySelector<HTMLElement>('select, input, button:not(.options-help), textarea')
      ?.focus({ preventScroll: true });
  }
}
