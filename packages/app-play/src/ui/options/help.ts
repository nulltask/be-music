import { html, nothing, render } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { OPTION_HELP_CHOICES_JA } from './help-choices-ja.ts';
import { OPTION_HELP_CHOICES, type OptionHelpChoice, type OptionHelpChoices } from './help-choices.ts';
// Hover help for the Options dialog: a "?" button beside each control and section Help describes, showing that entry.
// The descriptions live in the hidden `#options-help-content` block, in the language Help shows. An entry
// names the controls it covers by its text, or by `data-for` when it covers several ("Random 1P|Random 2P"). Under
// the entry of a list, the bubble lists what each choice the list offers does (`help-choices.ts`).

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

/** One line of the list a list's help ends with: a choice (or a group of them), what it does, and whether it is picked. */
export interface OptionHelpChoiceLine {
  readonly label: string;
  readonly help: string;
  readonly current: boolean;
}

/**
 * The lines the help of a list shows under its description: the `choices` the list offers now (`offered`, its option
 * texts in order), in the list's order. A choice covering several options shows once, under its label or the names of
 * those offered, and the line holding the `selected` option is the current one.
 */
export function resolveOptionHelpChoices(
  choices: readonly OptionHelpChoice[],
  offered: readonly string[],
  selected?: string,
): OptionHelpChoiceLine[] {
  const lines: { line: OptionHelpChoiceLine; order: number }[] = [];
  for (const [names, help, label] of choices) {
    const covered = (typeof names === 'string' ? [names] : names).filter((name) => offered.includes(name));
    if (covered.length === 0) continue;
    lines.push({
      line: {
        label: label ?? covered.join(' / '),
        help,
        current: selected !== undefined && covered.includes(selected),
      },
      order: Math.min(...covered.map((name) => offered.indexOf(name))),
    });
  }
  return lines.sort((a, b) => a.order - b.order).map(({ line }) => line);
}

/** The choices Help lists per language; a language without a list's choices shows the English ones. */
const OPTION_HELP_CHOICES_BY_LANG: Readonly<Record<string, OptionHelpChoices>> = {
  en: OPTION_HELP_CHOICES,
  ja: OPTION_HELP_CHOICES_JA,
};

/** Where the help bubble goes: its top-left corner, the side of the button it opens on, and where its point sits. */
export interface OptionHelpTipPlacement {
  readonly left: number;
  readonly top: number;
  readonly side: 'top' | 'bottom';
  /** The point's centre, from the bubble's left edge. */
  readonly arrowX: number;
}

/** Space between the button and the bubble, which the point spans, as under the header's tooltips. */
const TIP_GAP = 10;
/** The least space kept between the bubble and the viewport's edges. */
const TIP_MARGIN = 8;
/** The least space kept between the point's centre and the bubble's rounded corners. */
const TIP_ARROW_INSET = 12;

/**
 * Places the help bubble of size `tip` for a button at `anchor` in a `viewport`: centred below the button, or above
 * it when the viewport has no room below, kept {@link TIP_MARGIN} inside the viewport, with its point under the
 * button's centre however far the bubble was pushed sideways.
 */
export function placeOptionHelpTip(
  anchor: { readonly left: number; readonly top: number; readonly width: number; readonly height: number },
  tip: { readonly width: number; readonly height: number },
  viewport: { readonly width: number; readonly height: number },
): OptionHelpTipPlacement {
  const centre = anchor.left + anchor.width / 2;
  const left = Math.max(TIP_MARGIN, Math.min(centre - tip.width / 2, viewport.width - tip.width - TIP_MARGIN));
  const below = anchor.top + anchor.height + TIP_GAP;
  const fitsBelow = below + tip.height + TIP_MARGIN <= viewport.height;
  const top = fitsBelow ? below : Math.max(TIP_MARGIN, anchor.top - TIP_GAP - tip.height);
  const arrowX = Math.max(TIP_ARROW_INSET, Math.min(centre - left, tip.width - TIP_ARROW_INSET));
  return { left, top, side: fitsBelow ? 'bottom' : 'top', arrowX };
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
  /** The bubble's content, which scrolls when a long list does not fit the viewport. */
  private readonly body: HTMLElement;
  private readonly cache = new Map<string, OptionHelpEntries>();
  private shownFor: HTMLButtonElement | undefined;
  /** Whether a click opened the bubble: it then stays while the pointer is elsewhere, so a long list can be scrolled. */
  private pinned = false;

  /** `root` is the dialog, `language` the language Help shows. */
  public constructor(root: HTMLElement, language: () => string) {
    this.root = root;
    this.language = language;
    this.tip = document.createElement('div');
    this.tip.className = 'options-help-tip';
    this.tip.id = 'options-help-tip';
    this.tip.setAttribute('role', 'tooltip');
    this.tip.popover = 'manual';
    this.body = document.createElement('div');
    this.body.className = 'options-help-tip-body';
    this.tip.append(this.body);
    // A press inside a pinned bubble (its scrollbar) keeps the button focused, and one anywhere else closes it.
    this.tip.addEventListener('pointerdown', (event) => event.preventDefault());
    root.addEventListener('pointerdown', (event) => {
      const target = event.target as Node | null;
      if (this.pinned && target && !this.tip.contains(target) && !this.shownFor?.contains(target)) this.hide();
    });
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
      if (host === null) continue;
      // A button's help sits inside it, right of its label, so it cannot be a button of its own.
      const owner = host.closest('button');
      render(owner === null ? this.button(section, label) : this.inlineMark(owner, section, label), host);
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
      if (event.pointerType === 'mouse' && !(this.pinned && this.shownFor === button)) this.hide();
    });
    button.addEventListener('focus', show);
    button.addEventListener('blur', () => this.hide());
    button.addEventListener('click', (event) => {
      event.preventDefault();
      // A click pins the bubble a hover opened, and closes a pinned one.
      if (this.shownFor === button && this.pinned) {
        this.hide();
        return;
      }
      show();
      this.pin();
    });
    return button;
  }

  /**
   * The "?" inside a button, right of its label: a mark rather than a button, since a button cannot hold one. Hovering
   * it shows the help as the "?" buttons do, and a tap or click on it toggles the help instead of pressing `owner`.
   */
  private inlineMark(owner: HTMLButtonElement, section: string, label: string): HTMLElement {
    const mark = document.createElement('span');
    mark.className = 'options-help options-help-inline';
    mark.setAttribute('aria-hidden', 'true');
    render(CIRCLE_HELP_ICON, mark);
    const show = (): void => this.show(owner, section, label, mark);
    mark.addEventListener('pointerenter', (event) => {
      if (event.pointerType === 'mouse') show();
    });
    mark.addEventListener('pointerleave', (event) => {
      if (event.pointerType === 'mouse') this.hide();
    });
    mark.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (this.shownFor === owner) this.hide();
      else show();
    });
    return mark;
  }

  /** Shows the help of `label` for `button`, the bubble pointing at `anchor` (the button itself by default). */
  private show(button: HTMLButtonElement, section: string, label: string, anchor: HTMLElement = button): void {
    const description =
      this.entries(this.language()).entries.get(entryKey(section, label)) ??
      this.entries('en').entries.get(entryKey(section, label));
    if (description === undefined) return;
    const choices = this.choices(button, section, label);
    render(
      html`${unsafeHTML(description)}${
        choices.length === 0
          ? nothing
          : html`<ul class="options-help-choices">
              ${choices.map(
                (choice) =>
                  html`<li aria-current=${choice.current ? 'true' : nothing}>
                    <strong>${choice.label}</strong><span>${choice.help}</span>
                  </li>`,
              )}
            </ul>`
      }`,
      this.body,
    );
    this.tip.toggleAttribute('data-choices', choices.length > 0);
    if (this.shownFor !== button) this.unpin();
    if (!this.tip.matches(':popover-open')) this.tip.showPopover();
    this.shownFor?.removeAttribute('aria-describedby');
    this.shownFor = button;
    button.setAttribute('aria-describedby', this.tip.id);
    this.place(anchor);
  }

  /** What each choice of the list in `button`'s row does; empty for a control that is no list, or has no such help. */
  private choices(button: HTMLButtonElement, section: string, label: string): OptionHelpChoiceLine[] {
    const select = button.closest('.options-row')?.querySelector('select');
    if (!select) return [];
    const choices =
      OPTION_HELP_CHOICES_BY_LANG[this.language()]?.[section]?.[label] ?? OPTION_HELP_CHOICES[section]?.[label];
    if (choices === undefined) return [];
    const offered = Array.from(select.options, (option) => option.text);
    return resolveOptionHelpChoices(choices, offered, select.selectedOptions[0]?.text);
  }

  private pin(): void {
    this.pinned = true;
    this.tip.toggleAttribute('data-pinned', true);
  }

  private unpin(): void {
    this.pinned = false;
    this.tip.toggleAttribute('data-pinned', false);
  }

  private hide(): void {
    this.unpin();
    this.shownFor?.removeAttribute('aria-describedby');
    this.shownFor = undefined;
    if (this.tip.matches(':popover-open')) this.tip.hidePopover();
  }

  /** Puts the bubble beside `anchor` (`placeOptionHelpTip`). */
  private place(anchor: HTMLElement): void {
    const { left, top, side, arrowX } = placeOptionHelpTip(
      anchor.getBoundingClientRect(),
      { width: this.tip.offsetWidth, height: this.tip.offsetHeight },
      { width: innerWidth, height: innerHeight },
    );
    this.tip.dataset.side = side;
    this.tip.style.left = `${left}px`;
    this.tip.style.top = `${top}px`;
    this.tip.style.setProperty('--options-help-tip-arrow-x', `${arrowX}px`);
  }
}
