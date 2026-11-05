import { html, render } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
// Hover help for the Options dialog: a "?" button beside each control and section Help describes, showing that entry.
// The descriptions live in the hidden `#options-help-content` block, in the language Help shows. An entry
// names the controls it covers by its text, or by `data-for` when it covers several ("Random 1P|Random 2P").

/** The control labels a Help entry describes: its `data-for` list, or its own text. */
export function optionHelpLabels(term: string, dataFor: string | undefined): string[] {
  const listed = (dataFor ?? '')
    .split('|')
    .map((label) => label.trim())
    .filter((label) => label !== '');
  return listed.length > 0 ? listed : [term.trim()];
}

/**
 * The Help section a control belongs to: the nearest of `folders` (its folder titles, nearest first) that Help has a
 * section for, or `Top` for a control outside every such folder, as Help files the dialog's first rows.
 */
export function optionHelpSection(folders: readonly string[], sections: ReadonlySet<string>): string {
  return folders.find((title) => sections.has(title)) ?? 'Top';
}

/** Help's Options entries in one language: the section titles, and each entry's HTML by section and label. */
interface OptionHelpEntries {
  readonly sections: ReadonlySet<string>;
  readonly entries: ReadonlyMap<string, string>;
}

const entryKey = (section: string, label: string): string => `${section}\n${label}`;

const CIRCLE_HELP_ICON = html`<svg
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <circle cx="12" cy="12" r="10" />
  <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
  <path d="M12 17h.01" />
</svg>`;

/** Reads the Options tooltip entries for `lang` from the page. */
function readOptionHelp(lang: string): OptionHelpEntries {
  const sections = new Set<string>();
  const entries = new Map<string, string>();
  const block = document.querySelector(`#options-help-content .help-lang[data-lang="${lang}"]`);
  for (const section of block?.querySelectorAll('.help-menu-folder') ?? []) {
    const title = section.querySelector('.help-menu-folder-title')?.textContent?.trim() ?? '';
    sections.add(title);
    for (const term of section.querySelectorAll<HTMLElement>('dt')) {
      const description = term.nextElementSibling;
      if (description?.tagName !== 'DD') continue;
      for (const label of optionHelpLabels(term.textContent ?? '', term.dataset.for)) {
        entries.set(entryKey(title, label), description.innerHTML);
      }
    }
  }
  return { sections, entries };
}

/** The titles of the folders around `node`, nearest first. */
function folderTitles(node: Element, root: Element): string[] {
  const titles: string[] = [];
  for (
    let folder = node.parentElement?.closest<HTMLElement>('[data-options-folder]');
    folder && root.contains(folder);
    folder = folder.parentElement?.closest<HTMLElement>('[data-options-folder]')
  ) {
    titles.push(folder.dataset.optionTitle ?? '');
  }
  return titles;
}

/**
 * Gives the Options dialog's controls and sections Help describes a "?" button that shows the entry while hovered or
 * focused (and toggles on a tap). Runs again whenever the dialog opens, so rows made since (a theme's pickers) get one;
 * rows that have one are left as they are.
 */
export class OptionHelp {
  private readonly root: HTMLElement;
  private readonly language: () => string;
  private readonly tip: HTMLElement;
  private readonly cache = new Map<string, OptionHelpEntries>();
  private shownFor: HTMLButtonElement | undefined;

  /** `root` is the dialog, `language` the language Help shows. */
  public constructor(root: HTMLElement, language: () => string) {
    this.root = root;
    this.language = language;
    this.tip = document.createElement('div');
    this.tip.className = 'options-help-tip';
    this.tip.id = 'options-help-tip';
    this.tip.setAttribute('role', 'tooltip');
    this.tip.popover = 'manual';
    // Inside the dialog's panel: Basecoat lays out each of the dialog's own children as the panel itself.
    (root.firstElementChild ?? root).append(this.tip);
    root.addEventListener('close', () => this.hide());
  }

  /** Adds the buttons the dialog's rows and sections are missing. */
  public attach(): void {
    const help = this.entries('en');
    for (const row of this.root.querySelectorAll<HTMLElement>('.options-row[data-option-label]')) {
      if (row.querySelector(':scope .options-help') !== null) continue;
      const label = row.dataset.optionLabel ?? '';
      const section = optionHelpSection(folderTitles(row, this.root), help.sections);
      if (!help.entries.has(entryKey(section, label))) continue;
      const host = row.querySelector<HTMLElement>('[data-option-help-host]');
      if (host !== null) render(this.button(section, label), host);
    }
    for (const folder of this.root.querySelectorAll<HTMLElement>('[data-options-folder]')) {
      const heading = folder.querySelector<HTMLElement>(':scope > h3');
      if (heading === null || heading.querySelector('.options-help') !== null) continue;
      const title = folder.dataset.optionTitle ?? '';
      const section = optionHelpSection(folderTitles(folder, this.root), help.sections);
      const host = heading.querySelector<HTMLElement>('[data-option-help-host]');
      if (host !== null && help.entries.has(entryKey(section, title))) render(this.button(section, title), host);
    }
  }

  private entries(lang: string): OptionHelpEntries {
    let entries = this.cache.get(lang);
    if (entries === undefined) {
      entries = readOptionHelp(lang);
      this.cache.set(lang, entries);
    }
    return entries;
  }

  private button(section: string, label: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'options-help';
    button.setAttribute('aria-label', `Help: ${label}`);
    render(CIRCLE_HELP_ICON, button);
    const show = (): void => this.show(button, section, label);
    button.addEventListener('pointerenter', (event) => {
      if (event.pointerType === 'mouse') show();
    });
    button.addEventListener('pointerleave', (event) => {
      if (event.pointerType === 'mouse') this.hide();
    });
    button.addEventListener('focus', show);
    button.addEventListener('blur', () => this.hide());
    button.addEventListener('click', (event) => {
      event.preventDefault();
      if (this.shownFor === button) this.hide();
      else show();
    });
    return button;
  }

  private show(button: HTMLButtonElement, section: string, label: string): void {
    const description =
      this.entries(this.language()).entries.get(entryKey(section, label)) ??
      this.entries('en').entries.get(entryKey(section, label));
    if (description === undefined) return;
    render(unsafeHTML(description), this.tip);
    if (!this.tip.matches(':popover-open')) this.tip.showPopover();
    this.shownFor?.removeAttribute('aria-describedby');
    this.shownFor = button;
    button.setAttribute('aria-describedby', this.tip.id);
    this.place(button);
  }

  private hide(): void {
    this.shownFor?.removeAttribute('aria-describedby');
    this.shownFor = undefined;
    if (this.tip.matches(':popover-open')) this.tip.hidePopover();
  }

  /** Below the button, or above it when the viewport has no room below, kept 8 px inside the viewport. */
  private place(button: HTMLButtonElement): void {
    const anchor = button.getBoundingClientRect();
    const tip = this.tip.getBoundingClientRect();
    const gap = 6;
    const margin = 8;
    const left = Math.min(
      Math.max(margin, anchor.left + anchor.width / 2 - tip.width / 2),
      innerWidth - tip.width - margin,
    );
    const below = anchor.bottom + gap;
    const top = below + tip.height + margin > innerHeight ? Math.max(margin, anchor.top - gap - tip.height) : below;
    this.tip.style.left = `${Math.max(margin, left)}px`;
    this.tip.style.top = `${top}px`;
  }
}
