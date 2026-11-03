import { repeat } from 'lit/directives/repeat.js';
import { optionLabel } from './options/labels.ts';
import { html, nothing, render, type TemplateResult } from 'lit';
import { live } from 'lit/directives/live.js';
import { ifDefined } from 'lit/directives/if-defined.js';
// The controls of the player's Options dialog and the beatoraja Skin Config panel, drawn with Basecoat: a switch for a
// boolean, a select for a choice list, a slider with a number field for a number with a range, a text field, read-only
// monitors (text, a text area, an FPS graph), buttons, collapsible folders and tabs. A control binds `object[key]`: an
// edit writes it and runs the control's change handlers, and `refresh` shows it again after a write from elsewhere.
// Every control has `hidden` and `disabled`, which the play lock (`play-lock.ts`) sets.
import {
  choiceIndex,
  constrainNumber,
  displayText,
  formatNumber,
  graphPoints,
  sliderFill,
  type OptionChoice,
} from './options-values.ts';

export type { OptionChoice };

/** A user's edit of a bound control, as it reaches the folders above it (`on('change')`). */
export interface OptionChangeEvent {
  readonly key: PropertyKey;
  readonly value: unknown;
}

/** How a binding shows and edits its value. */
export interface OptionBindingParams<T> {
  readonly label?: string;
  /** A choice list: the binding is a select. */
  readonly options?: readonly OptionChoice<T>[];
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  /** A monitor: shows the value, refreshed every `interval` ms while it is on screen, and takes no edit. */
  readonly readonly?: boolean;
  /** A monitor of `rows` lines. */
  readonly multiline?: boolean;
  readonly rows?: number;
  /** A number monitor drawn as a graph of its last `bufferSize` samples, from `min` to `max`. */
  readonly view?: 'graph';
  readonly interval?: number;
  readonly bufferSize?: number;
}

let lastId = 0;
/** An id for a control's input, so its label points at it. */
function uniqueId(prefix: string): string {
  lastId += 1;
  return `${prefix}-${lastId}`;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  return node;
}

const CHEVRON_ICON = html`<svg
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d="m6 9 6 6 6-6" />
</svg>`;

/** One thing in the options: a control row, a button, a folder or a set of tabs. */
export class OptionRow {
  public readonly element: HTMLElement;
  protected parent: OptionContainer | undefined;
  protected language = 'en';
  private readonly localize: ((language: string) => void) | undefined;
  private disabledState = false;

  public constructor(element: HTMLElement, parent: OptionContainer | undefined, localize?: (language: string) => void) {
    this.element = element;
    this.parent = parent;
    this.localize = localize;
  }

  public get hidden(): boolean {
    return this.element.hidden === true;
  }
  public set hidden(value: boolean) {
    this.element.hidden = value;
  }

  /** Disables every input, select and button in it; a disabled row is dimmed. */
  public get disabled(): boolean {
    return this.disabledState;
  }
  public set disabled(value: boolean) {
    this.disabledState = value;
    this.element.toggleAttribute('data-disabled', value);
    for (const control of this.element.querySelectorAll<
      HTMLInputElement | HTMLSelectElement | HTMLButtonElement | HTMLTextAreaElement
    >('input, select, button, textarea')) {
      // A monitor stays readable, and a help button (`options/help.ts`) stays usable.
      if (control.dataset.readonly !== undefined || control.classList.contains('options-help')) continue;
      control.disabled = value;
    }
  }

  /** Update the view's labels without mutating another renderer's children. */
  public relabel(language: string): void {
    this.language = language;
    this.localize?.(language);
  }

  /** Shows the bound values again. */
  public refresh(): void {}

  /** Takes it out of the options. */
  public dispose(): void {
    this.element.remove();
    this.parent?.removeChild(this);
    this.parent = undefined;
  }

  /** An edit below it, passed up to the folders that listen. */
  public receiveChange(event: OptionChangeEvent): void {
    this.parent?.receiveChange(event);
  }
}

/** A control bound to `object[key]`. */
export class OptionBinding<T = unknown> extends OptionRow {
  private readonly object: Record<PropertyKey, unknown>;
  private readonly key: PropertyKey;
  private readonly params: OptionBindingParams<T>;
  private labelText: string;
  private readonly id = uniqueId('option');
  private readonly kind: 'select' | 'toggle' | 'number' | 'text' | 'monitor';
  /** The change handlers, typed loosely so a binding of any value type stores as `OptionBinding<unknown>`. */
  private readonly handlers: ((event: { value: unknown }) => void)[] = [];
  private choices: OptionChoice<T>[];
  private readonly samples: number[] = [];
  private field: HTMLInputElement | undefined;
  private timer: number | undefined;

  public constructor(
    parent: OptionContainer,
    object: Record<PropertyKey, unknown>,
    key: PropertyKey,
    params: OptionBindingParams<T>,
  ) {
    const row = element('div', 'field options-row');
    super(row, parent);
    this.object = object;
    this.key = key;
    this.params = params;
    this.choices = [...(params.options ?? [])];
    this.labelText = params.label ?? String(key);
    // The original label names the row's help and remembered settings, independently of localization.
    row.dataset.optionLabel = params.label ?? String(key);
    const value = object[key];
    this.kind =
      params.readonly === true
        ? 'monitor'
        : params.options !== undefined
          ? 'select'
          : typeof value === 'boolean'
            ? 'toggle'
            : typeof value === 'number'
              ? 'number'
              : 'text';
    const slider = this.kind === 'number' && params.min !== undefined && params.max !== undefined;
    row.classList.toggle('options-toggle-row', this.kind === 'toggle');
    row.classList.toggle('options-slider-row', slider);
    row.classList.toggle('options-monitor-row', this.kind === 'monitor');
    if (!slider && !(this.kind === 'monitor' && (params.view === 'graph' || params.multiline === true)))
      row.dataset.orientation = 'horizontal';
    this.refresh();
    if (this.kind === 'monitor') {
      // A hidden monitor does no sampling or rendering.
      this.timer = window.setInterval(() => {
        if (this.element.isConnected && this.element.offsetParent !== null) this.refresh();
      }, params.interval ?? 200);
    }
  }

  public get label(): string {
    return optionLabel(this.labelText, this.language);
  }
  public set label(value: string) {
    this.labelText = value;
    this.element.dataset.optionLabel = value;
    this.render(false);
  }

  public override relabel(language: string): void {
    super.relabel(language);
    this.render(false);
  }

  private labelTemplate(): TemplateResult {
    return html`<span class="options-label-wrap"
      ><label class="label options-label" id=${`${this.id}-label`} for=${this.id}>${this.label}</label
      ><span data-option-help-host></span
    ></span>`;
  }

  /** Replacing choices keeps the select, its focus and its event handlers. */
  public get options(): OptionChoice<T>[] {
    return this.choices;
  }
  public set options(choices: OptionChoice<T>[]) {
    this.choices = [...choices];
    this.refresh();
  }

  public on(_event: 'change', handler: (event: { value: T }) => void): this {
    this.handlers.push(handler as (event: { value: unknown }) => void);
    return this;
  }

  public override refresh(): void {
    this.render(false);
  }

  public override dispose(): void {
    if (this.timer !== undefined) window.clearInterval(this.timer);
    this.timer = undefined;
    render(nothing, this.element);
    super.dispose();
  }

  private commit(value: T): void {
    this.object[this.key] = value;
    for (const handler of this.handlers) handler({ value });
    this.receiveChange({ key: this.key, value });
    this.render(true);
  }

  /** Updating a field being typed in preserves its unfinished text until the edit is committed. */
  private render(force: boolean): void {
    const value = this.object[this.key];
    const typing = !force && this.field !== undefined && document.activeElement === this.field;
    render(this.control(value, typing), this.element);
    this.field = this.element.querySelector<HTMLInputElement>('.options-number, .options-text') ?? undefined;
    // A select whose bound value has no choice must have no selection, including after choices change.
    const select = this.element.querySelector('select');
    if (select !== null) select.selectedIndex = choiceIndex(this.choices, value);
  }

  private control(value: unknown, typing: boolean): TemplateResult {
    if (this.kind === 'monitor') return this.monitor(value);
    if (this.kind === 'select')
      return html`${this.labelTemplate()}
        <select
          class="select options-select"
          id=${this.id}
          @change=${(event: Event) => {
            const choice = this.choices[(event.currentTarget as HTMLSelectElement).selectedIndex];
            if (choice !== undefined) this.commit(choice.value);
          }}
        >
          ${this.choices.map((choice, index) => html`<option value=${index}>${choice.text}</option>`)}
        </select>`;
    if (this.kind === 'toggle')
      return html`${this.labelTemplate()}
        <input
          class="input"
          id=${this.id}
          type="checkbox"
          role="switch"
          .checked=${live(value === true)}
          @change=${(event: Event) => this.commit((event.currentTarget as HTMLInputElement).checked as T)}
        />`;
    const text = typing
      ? this.field!.value
      : this.kind === 'number' && typeof value === 'number'
        ? formatNumber(value, this.params.step)
        : displayText(value);
    if (this.kind === 'text')
      return html`${this.labelTemplate()}
        <input
          class="input options-text"
          id=${this.id}
          type="text"
          .spellcheck=${false}
          .value=${live(text)}
          @change=${(event: Event) => this.commit((event.currentTarget as HTMLInputElement).value as T)}
        />`;
    const { min, max, step } = this.params;
    const field = html`<input
      class="input options-number"
      type="number"
      id=${this.id}
      inputmode=${step !== undefined && Number.isInteger(step) && (min ?? 0) >= 0 ? 'numeric' : 'decimal'}
      min=${ifDefined(min)}
      max=${ifDefined(max)}
      step=${step ?? 'any'}
      .value=${live(text)}
      @change=${(event: Event) => {
        const field = event.currentTarget as HTMLInputElement;
        const next = constrainNumber(Number(field.value), this.params);
        if (next === undefined || field.value.trim() === '') this.refresh();
        else this.commit(next as T);
      }}
      @blur=${() => this.refresh()}
    />`;
    if (min === undefined || max === undefined) return html`${this.labelTemplate()}${field}`;
    return html`<div class="options-slider-head">${this.labelTemplate()}${field}</div>
      <input
        class="input options-range"
        type="range"
        min=${min}
        max=${max}
        step=${step ?? 'any'}
        aria-labelledby=${`${this.id}-label`}
        .value=${live(String(value))}
        style=${`--slider-value: ${sliderFill(typeof value === 'number' ? value : min, min, max)}`}
        @input=${(event: Event) => {
          const next = constrainNumber(Number((event.currentTarget as HTMLInputElement).value), this.params);
          if (next !== undefined) this.commit(next as T);
        }}
      />`;
  }

  private monitor(value: unknown): TemplateResult {
    if (this.params.view === 'graph') {
      const sample = typeof value === 'number' ? value : Number.NaN;
      const size = this.params.bufferSize ?? 60;
      this.samples.push(sample);
      if (this.samples.length > size) this.samples.splice(0, this.samples.length - size);
      return html`<div class="options-slider-head">
          ${this.labelTemplate()}
          <output class="options-monitor-value" id=${this.id}
            >${Number.isFinite(sample) ? sample.toFixed(1) : '-'}</output
          >
        </div>
        <svg viewBox="0 0 100 32" preserveAspectRatio="none" class="options-graph" aria-hidden="true">
          <polyline
            vector-effect="non-scaling-stroke"
            points=${graphPoints(
              this.samples,
              { min: this.params.min ?? 0, max: this.params.max ?? 100, width: 100, height: 32 },
              size,
            )}
          ></polyline>
        </svg>`;
    }
    if (this.params.multiline === true)
      return html`${this.labelTemplate()}
        <textarea
          class="textarea options-monitor"
          id=${this.id}
          readonly
          data-readonly
          rows=${this.params.rows ?? 3}
          .value=${live(displayText(value))}
        ></textarea>`;
    return html`${this.labelTemplate()}<output class="options-monitor-value" id=${this.id}
        >${displayText(value)}</output
      >`;
  }
}

/** A button whose title may be replaced by a live action status. */
export class OptionButton extends OptionRow {
  public readonly button: HTMLButtonElement;
  private titleText: string;
  private readonly originalTitle: string;
  private readonly handlers: (() => void)[] = [];

  public constructor(parent: OptionContainer, params: { title: string }) {
    const row = element('div', 'options-row options-button-row');
    super(row, parent);
    this.titleText = params.title;
    this.originalTitle = params.title;
    row.dataset.optionLabel = params.title;
    this.paint();
    this.button = row.querySelector('button')!;
  }

  public get title(): string {
    return this.button.textContent ?? '';
  }
  public set title(value: string) {
    this.titleText = value;
    this.paint();
  }

  public on(_event: 'click', handler: () => void): this {
    this.handlers.push(handler);
    return this;
  }

  public override relabel(language: string): void {
    super.relabel(language);
    this.paint();
  }

  private paint(): void {
    const title =
      this.titleText === this.originalTitle || this.titleText === optionLabel(this.originalTitle, 'ja')
        ? optionLabel(this.originalTitle, this.language)
        : this.titleText;
    render(
      html`<button
          class="btn options-button"
          type="button"
          data-variant="outline"
          data-size="sm"
          @click=${() => {
            for (const handler of this.handlers) handler();
          }}
        >
          ${title}</button
        ><span data-option-help-host></span>`,
      this.element,
    );
  }
}

/** Something that holds rows: a folder, a tab page or the dialog. */
export abstract class OptionContainer extends OptionRow {
  public readonly children: OptionRow[] = [];
  /** Where its rows go. */
  protected abstract readonly content: HTMLElement;
  private readonly changeListeners: ((event: OptionChangeEvent) => void)[] = [];

  public addBinding<O extends object, K extends keyof O>(
    object: O,
    key: K,
    params: OptionBindingParams<O[K]> = {},
  ): OptionBinding<O[K]> {
    return this.add(new OptionBinding<O[K]>(this, object as Record<PropertyKey, unknown>, key, params));
  }

  public addButton(params: { title: string }): OptionButton {
    return this.add(new OptionButton(this, params));
  }

  /** A folder: a section with a heading, which is always open. */
  public addFolder(params: { title: string }): OptionFolder {
    return this.add(new OptionFolder(this, { title: params.title, expanded: true, kind: 'section' }));
  }

  /** Tabs, one page per title; the first is selected. */
  public addTab(params: { pages: readonly { title: string }[] }): OptionTabs {
    return this.add(new OptionTabs(this, params.pages));
  }

  /** A row holding `content`, laid out, hidden and disabled like the others. */
  public addElement(content: HTMLElement, localize?: (language: string) => void): OptionRow {
    const row = element('div', 'options-row options-element-row');
    render(content, row);
    return this.add(new OptionRow(row, this, localize));
  }

  /** Runs `listener` after an edit of any control in it. */
  public on(event: 'change', listener: (event: OptionChangeEvent) => void): this;
  public on(event: 'fold', listener: (event: { expanded: boolean }) => void): this;
  public on(event: 'change' | 'fold', listener: (event: never) => void): this {
    if (event === 'change') this.changeListeners.push(listener as (event: OptionChangeEvent) => void);
    else this.onFold(listener as (event: { expanded: boolean }) => void);
    return this;
  }

  public override receiveChange(event: OptionChangeEvent): void {
    for (const listener of this.changeListeners) listener(event);
    super.receiveChange(event);
  }

  public override refresh(): void {
    for (const child of this.children) child.refresh();
  }

  public override dispose(): void {
    for (const child of this.children.slice()) child.dispose();
    super.dispose();
  }

  public removeChild(child: OptionRow): void {
    const index = this.children.indexOf(child);
    if (index >= 0) {
      this.children.splice(index, 1);
      this.paintChildren();
    }
  }

  public override relabel(language: string): void {
    super.relabel(language);
    for (const child of this.children) child.relabel(language);
  }

  private paintChildren(): void {
    render(
      repeat(
        this.children,
        (child) => child,
        (child) => child.element,
      ),
      this.content,
    );
  }

  /** Reports its opening and closing; a container that does neither never calls `listener`. */
  protected onFold(_listener: (event: { expanded: boolean }) => void): void {}

  private add<R extends OptionRow>(row: R): R {
    this.children.push(row);
    row.relabel(this.language);
    this.paintChildren();
    return row;
  }
}

/** How a folder shows: collapsible, a section that is always open, or the Options dialog itself. */
type FolderKind = 'details' | 'section' | 'dialog';

/** A folder of rows. Its `title` and `expanded` are what `folders.ts` remembers. */
export class OptionFolder extends OptionContainer {
  protected readonly content: HTMLElement;
  private readonly kind: FolderKind;
  private readonly titleText: string;
  private readonly foldListeners: ((event: { expanded: boolean }) => void)[] = [];
  /** The open state last reported, so a programmatic change is not reported as the user's. */
  private reportedOpen: boolean;

  public constructor(
    parent: OptionContainer | undefined,
    params:
      | { title: string; expanded: boolean; kind: 'details' | 'section' }
      | { title: string; kind: 'dialog'; dialog: HTMLDialogElement; content: HTMLElement },
  ) {
    const root =
      params.kind === 'dialog'
        ? params.dialog
        : params.kind === 'details'
          ? element('details', 'options-folder')
          : element('section', 'options-section');
    super(root, parent);
    this.kind = params.kind;
    this.titleText = params.title;
    if (params.kind === 'dialog') {
      this.content = params.content;
      root.addEventListener('close', () => this.reportFold(false));
    } else if (root instanceof HTMLDetailsElement && params.kind === 'details') {
      root.dataset.optionsFolder = '';
      // The English title, which names the folder whatever language it shows in (`options/labels.ts`).
      root.dataset.optionTitle = params.title;
      this.content = element('div', 'options-folder-content');
      this.paintHeading();
      root.open = params.expanded;
      root.addEventListener('toggle', () => this.reportFold(root.open));
    } else {
      root.dataset.optionsFolder = '';
      // The English title, which names the folder whatever language it shows in (`options/labels.ts`).
      root.dataset.optionTitle = params.title;
      this.content = element('div', 'options-folder-content');
      this.paintHeading();
    }
    this.reportedOpen = this.expanded;
  }

  /**
   * The Options dialog as the root folder: `content` holds its rows, and `expanded` opens and closes the dialog. Its
   * title is not part of the remembered folder paths.
   */
  public static dialog(dialog: HTMLDialogElement, content: HTMLElement, title: string): OptionFolder {
    return new OptionFolder(undefined, { title, kind: 'dialog', dialog, content });
  }

  /** A floating collapsible panel in `container`, such as the beatoraja Skin Config panel. */
  public static panel(container: HTMLElement, params: { title: string; expanded: boolean }): OptionFolder {
    const folder = new OptionFolder(undefined, { ...params, kind: 'details' });
    folder.element.classList.add('options-panel');
    container.append(folder.element);
    return folder;
  }

  public get title(): string {
    return optionLabel(this.titleText, this.language);
  }

  public override relabel(language: string): void {
    super.relabel(language);
    this.paintHeading();
  }

  private paintHeading(): void {
    if (this.kind === 'dialog') return;
    const title = html`<span class="options-folder-title">${this.title}</span><span data-option-help-host></span>`;
    render(
      this.kind === 'details'
        ? html`<summary class="options-folder-summary">${title}${CHEVRON_ICON}</summary>
            ${this.content}`
        : html`<h3 class="options-section-heading">${title}</h3>
            ${this.content}`,
      this.element,
    );
  }

  /** Whether it is open: a section always is. */
  public get expanded(): boolean {
    const root = this.element;
    if (root instanceof HTMLDetailsElement) return root.open;
    if (root instanceof HTMLDialogElement) return root.open;
    return true;
  }
  public set expanded(value: boolean) {
    const root = this.element;
    if (root instanceof HTMLDetailsElement) {
      this.reportedOpen = value;
      root.open = value;
    } else if (root instanceof HTMLDialogElement) {
      if (value && !root.open) root.showModal();
      else if (!value && root.open) root.close();
      this.reportFold(root.open);
    }
  }

  protected override onFold(listener: (event: { expanded: boolean }) => void): void {
    if (this.kind !== 'section') this.foldListeners.push(listener);
  }

  private reportFold(open: boolean): void {
    if (open === this.reportedOpen) return;
    this.reportedOpen = open;
    for (const listener of this.foldListeners) listener({ expanded: open });
  }
}

/** Basecoat tabs: one page per title, the first selected. */
export class OptionTabs extends OptionRow {
  public readonly pages: OptionPage[];
  private readonly tabIds: string[];
  private selected = 0;

  public constructor(parent: OptionContainer, pages: readonly { title: string }[]) {
    super(element('section', 'tabs options-tabs'), parent);
    this.tabIds = pages.map(() => uniqueId('options-tab'));
    this.pages = pages.map(({ title }, index) => {
      const panel = element('div', 'options-tab-panel');
      panel.id = uniqueId('options-panel');
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', this.tabIds[index]!);
      panel.tabIndex = -1;
      return new OptionPage(this, title, panel);
    });
    this.select(0);
  }

  public select(index: number): void {
    this.selected = index;
    this.paint();
    this.pages.forEach((page, at) => {
      page.element.hidden = at !== index;
      page.element.setAttribute('aria-selected', String(at === index));
    });
  }

  public override refresh(): void {
    for (const page of this.pages) page.refresh();
  }

  public override relabel(language: string): void {
    super.relabel(language);
    this.paint();
    for (const page of this.pages) page.relabel(language);
  }

  public override dispose(): void {
    for (const page of this.pages) page.dispose();
    render(nothing, this.element);
    super.dispose();
  }

  private paint(): void {
    render(
      html`<nav role="tablist" aria-orientation="horizontal">
          ${this.pages.map(
            (page, index) =>
              html` <button
                type="button"
                role="tab"
                id=${this.tabIds[index]}
                data-option-title=${page.title}
                aria-controls=${page.element.id}
                aria-selected=${String(this.selected === index)}
                tabindex=${this.selected === index ? 0 : -1}
                @click=${() => this.select(index)}
                @keydown=${(event: KeyboardEvent) => {
                  const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
                  if (step === 0) return;
                  event.preventDefault();
                  const next = (index + step + this.pages.length) % this.pages.length;
                  this.select(next);
                  this.element.querySelector<HTMLButtonElement>(`#${this.tabIds[next]}`)?.focus();
                }}
              >
                ${optionLabel(page.title, this.language)}
              </button>`,
          )}
        </nav>
        ${this.pages.map((page) => page.element)}`,
      this.element,
    );
  }
}

/** One page of tabs. Its title names the tab, not a remembered folder path. */
export class OptionPage extends OptionContainer {
  public readonly title: string;
  protected readonly content: HTMLElement;
  private readonly tabs: OptionTabs;

  public constructor(tabs: OptionTabs, title: string, panel: HTMLElement) {
    super(panel, undefined);
    this.tabs = tabs;
    this.title = title;
    this.content = panel;
  }

  public override receiveChange(event: OptionChangeEvent): void {
    super.receiveChange(event);
    this.tabs.receiveChange(event);
  }
}
