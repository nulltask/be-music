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

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const CHEVRON_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

/** One thing in the options: a control row, a button, a folder or a set of tabs. */
export class OptionRow {
  public readonly element: HTMLElement;
  protected parent: OptionContainer | undefined;
  private disabledState = false;

  public constructor(element: HTMLElement, parent: OptionContainer | undefined) {
    this.element = element;
    this.parent = parent;
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
  private readonly labelElement: HTMLElement;
  /** The change handlers, typed loosely so a binding of any value type stores as `OptionBinding<unknown>`. */
  private readonly handlers: ((event: { value: unknown }) => void)[] = [];
  private choices: OptionChoice<T>[];
  private select: HTMLSelectElement | undefined;
  private toggle: HTMLInputElement | undefined;
  private range: HTMLInputElement | undefined;
  private field: HTMLInputElement | undefined;
  private monitor: HTMLElement | HTMLTextAreaElement | undefined;
  private graph: { line: SVGPolylineElement; value: HTMLElement; samples: number[] } | undefined;
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
    const id = uniqueId('option');
    this.labelElement = element('label', 'label options-label', params.label ?? String(key));
    // The label it was made with, which names it for its help (`options/help.ts`) whatever it later reads.
    row.dataset.optionLabel = params.label ?? String(key);
    this.labelElement.setAttribute('for', id);
    const value = object[key];
    if (params.readonly === true) this.buildMonitor(row, id);
    else if (params.options !== undefined) this.buildSelect(row, id);
    else if (typeof value === 'boolean') this.buildToggle(row, id);
    else if (typeof value === 'number') this.buildNumber(row, id);
    else this.buildText(row, id);
    this.refresh();
  }

  /** The label beside the control. */
  public get label(): string {
    return this.labelElement.textContent ?? '';
  }
  public set label(value: string) {
    this.labelElement.textContent = value;
  }

  /** A select's choices; setting them keeps the select and its handlers. */
  public get options(): OptionChoice<T>[] {
    return this.choices;
  }
  public set options(choices: OptionChoice<T>[]) {
    this.choices = [...choices];
    if (this.select !== undefined) this.fillSelect(this.select);
    this.refresh();
  }

  /** Runs `handler` after each edit, with the value written. */
  public on(_event: 'change', handler: (event: { value: T }) => void): this {
    this.handlers.push(handler as (event: { value: unknown }) => void);
    return this;
  }

  public override refresh(): void {
    this.render(false);
  }

  /** Shows the bound value; a number or text field being typed in keeps its text unless `force`. */
  private render(force: boolean): void {
    const value = this.object[this.key];
    const typing = !force && this.field !== undefined && document.activeElement === this.field;
    if (this.select !== undefined) this.select.selectedIndex = choiceIndex(this.choices, value);
    if (this.toggle !== undefined) this.toggle.checked = value === true;
    if (typeof value === 'number') {
      if (this.range !== undefined) {
        this.range.value = String(value);
        this.range.style.setProperty('--slider-value', sliderFill(value, this.params.min ?? 0, this.params.max ?? 0));
      }
      if (this.field !== undefined && !typing) {
        this.field.value = formatNumber(value, this.params.step);
      }
    } else if (this.field !== undefined && !typing) {
      this.field.value = displayText(value);
    }
    if (this.graph !== undefined) {
      const sample = typeof value === 'number' ? value : Number.NaN;
      const { samples } = this.graph;
      samples.push(sample);
      const size = this.params.bufferSize ?? 60;
      if (samples.length > size) samples.splice(0, samples.length - size);
      this.graph.line.setAttribute(
        'points',
        graphPoints(samples, { min: this.params.min ?? 0, max: this.params.max ?? 100, width: 100, height: 32 }, size),
      );
      this.graph.value.textContent = Number.isFinite(sample) ? sample.toFixed(1) : '-';
    } else if (this.monitor !== undefined) {
      const text = displayText(value);
      if (this.monitor instanceof HTMLTextAreaElement) this.monitor.value = text;
      else this.monitor.textContent = text;
    }
  }

  public override dispose(): void {
    if (this.timer !== undefined) window.clearInterval(this.timer);
    this.timer = undefined;
    super.dispose();
  }

  /** Writes an edit, runs the handlers, tells the folders above, and shows the value as it now reads. */
  private commit(value: T): void {
    this.object[this.key] = value;
    for (const handler of this.handlers) handler({ value });
    this.receiveChange({ key: this.key, value });
    this.render(true);
  }

  private buildSelect(row: HTMLElement, id: string): void {
    row.dataset.orientation = 'horizontal';
    const select = element('select', 'select options-select');
    select.id = id;
    this.fillSelect(select);
    select.addEventListener('change', () => {
      const choice = this.choices[select.selectedIndex];
      if (choice !== undefined) this.commit(choice.value);
    });
    this.select = select;
    row.append(this.labelElement, select);
  }

  private fillSelect(select: HTMLSelectElement): void {
    select.replaceChildren(
      ...this.choices.map((choice, index) => {
        const option = element('option', undefined, choice.text);
        option.value = String(index);
        return option;
      }),
    );
  }

  private buildToggle(row: HTMLElement, id: string): void {
    row.dataset.orientation = 'horizontal';
    row.classList.add('options-toggle-row');
    const input = element('input', 'input');
    input.type = 'checkbox';
    input.setAttribute('role', 'switch');
    input.id = id;
    input.addEventListener('change', () => this.commit(input.checked as T));
    this.toggle = input;
    row.append(this.labelElement, input);
  }

  private buildNumber(row: HTMLElement, id: string): void {
    const { min, max, step } = this.params;
    const field = element('input', 'input options-number');
    field.type = 'number';
    field.id = id;
    field.inputMode = step !== undefined && Number.isInteger(step) && (min ?? 0) >= 0 ? 'numeric' : 'decimal';
    if (min !== undefined) field.min = String(min);
    if (max !== undefined) field.max = String(max);
    field.step = step === undefined ? 'any' : String(step);
    field.addEventListener('change', () => {
      const value = constrainNumber(Number(field.value), this.params);
      if (value === undefined || field.value.trim() === '') this.refresh();
      else this.commit(value as T);
    });
    field.addEventListener('blur', () => this.refresh());
    this.field = field;
    if (min === undefined || max === undefined) {
      row.dataset.orientation = 'horizontal';
      row.append(this.labelElement, field);
      return;
    }
    // A slider for the range, with the number beside its label for an exact value.
    row.classList.add('options-slider-row');
    const range = element('input', 'input options-range');
    range.type = 'range';
    range.min = String(min);
    range.max = String(max);
    range.step = step === undefined ? 'any' : String(step);
    range.setAttribute('aria-labelledby', uniqueLabel(this.labelElement));
    range.addEventListener('input', () => {
      const value = constrainNumber(Number(range.value), this.params);
      if (value !== undefined) this.commit(value as T);
    });
    this.range = range;
    const head = element('div', 'options-slider-head');
    head.append(this.labelElement, field);
    row.append(head, range);
  }

  private buildText(row: HTMLElement, id: string): void {
    row.dataset.orientation = 'horizontal';
    const field = element('input', 'input options-text');
    field.type = 'text';
    field.id = id;
    field.spellcheck = false;
    field.addEventListener('change', () => this.commit(field.value as T));
    this.field = field;
    row.append(this.labelElement, field);
  }

  private buildMonitor(row: HTMLElement, id: string): void {
    row.classList.add('options-monitor-row');
    if (this.params.view === 'graph') {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 100 32');
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.setAttribute('class', 'options-graph');
      svg.setAttribute('aria-hidden', 'true');
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      line.setAttribute('vector-effect', 'non-scaling-stroke');
      svg.append(line);
      const output = element('output', 'options-monitor-value');
      output.id = id;
      const head = element('div', 'options-slider-head');
      head.append(this.labelElement, output);
      row.append(head, svg);
      this.graph = { line, value: output, samples: [] };
    } else if (this.params.multiline === true) {
      const area = element('textarea', 'textarea options-monitor');
      area.id = id;
      area.readOnly = true;
      area.dataset.readonly = '';
      area.rows = this.params.rows ?? 3;
      row.append(this.labelElement, area);
      this.monitor = area;
    } else {
      row.dataset.orientation = 'horizontal';
      const output = element('output', 'options-monitor-value');
      output.id = id;
      row.append(this.labelElement, output);
      this.monitor = output;
    }
    // A monitor follows its value while it is on screen; hidden, it costs nothing.
    this.timer = window.setInterval(() => {
      if (this.element.isConnected && this.element.offsetParent !== null) this.refresh();
    }, this.params.interval ?? 200);
  }
}

/** The label's id, given one if it has none, for a control it does not wrap. */
function uniqueLabel(label: HTMLElement): string {
  if (label.id === '') label.id = uniqueId('option-label');
  return label.id;
}

/** A button. */
export class OptionButton extends OptionRow {
  public readonly button: HTMLButtonElement;

  public constructor(parent: OptionContainer, params: { title: string }) {
    const row = element('div', 'options-row options-button-row');
    super(row, parent);
    this.button = element('button', 'btn options-button', params.title);
    row.dataset.optionLabel = params.title;
    this.button.type = 'button';
    this.button.dataset.variant = 'outline';
    this.button.dataset.size = 'sm';
    row.append(this.button);
  }

  /** The button's text. */
  public get title(): string {
    return this.button.textContent ?? '';
  }
  public set title(value: string) {
    this.button.textContent = value;
  }

  public on(_event: 'click', handler: () => void): this {
    this.button.addEventListener('click', () => handler());
    return this;
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
  public addElement(content: HTMLElement): OptionRow {
    const row = element('div', 'options-row options-element-row');
    row.append(content);
    return this.add(new OptionRow(row, this));
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
    if (index >= 0) this.children.splice(index, 1);
  }

  /** Reports its opening and closing; a container that does neither never calls `listener`. */
  protected onFold(_listener: (event: { expanded: boolean }) => void): void {}

  private add<R extends OptionRow>(row: R): R {
    this.children.push(row);
    this.content.append(row.element);
    return row;
  }
}

/** How a folder shows: collapsible, a section that is always open, or the Options dialog itself. */
type FolderKind = 'details' | 'section' | 'dialog';

/** A folder of rows. Its `title` and `expanded` are what `folders.ts` remembers. */
export class OptionFolder extends OptionContainer {
  protected readonly content: HTMLElement;
  private readonly kind: FolderKind;
  private readonly titleElement: HTMLElement;
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
    this.titleElement = element('span', 'options-folder-title', params.title);
    if (params.kind === 'dialog') {
      this.content = params.content;
      root.addEventListener('close', () => this.reportFold(false));
    } else if (root instanceof HTMLDetailsElement && params.kind === 'details') {
      root.dataset.optionsFolder = '';
      this.content = element('div', 'options-folder-content');
      const summary = element('summary', 'options-folder-summary');
      summary.append(this.titleElement);
      summary.insertAdjacentHTML('beforeend', CHEVRON_SVG);
      root.append(summary, this.content);
      root.open = params.expanded;
      root.addEventListener('toggle', () => this.reportFold(root.open));
    } else {
      root.dataset.optionsFolder = '';
      this.content = element('div', 'options-folder-content');
      const heading = element('h3', 'options-section-heading');
      heading.append(this.titleElement);
      root.append(heading, this.content);
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
    return this.titleElement.textContent ?? '';
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
  private readonly buttons: HTMLButtonElement[];

  public constructor(parent: OptionContainer, pages: readonly { title: string }[]) {
    const root = element('section', 'tabs options-tabs');
    super(root, parent);
    const list = element('nav');
    list.setAttribute('role', 'tablist');
    list.setAttribute('aria-orientation', 'horizontal');
    root.append(list);
    this.buttons = [];
    this.pages = pages.map(({ title }, index) => {
      const tabId = uniqueId('options-tab');
      const panel = element('div', 'options-tab-panel');
      panel.id = uniqueId('options-panel');
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', tabId);
      panel.tabIndex = -1;
      const button = element('button', undefined, title);
      button.type = 'button';
      button.id = tabId;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', panel.id);
      button.addEventListener('click', () => {
        this.select(index);
        // A tab bar wider than the dialog scrolls; the picked tab comes into view.
        button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      });
      button.addEventListener('keydown', (event) => {
        const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
        if (step === 0) return;
        event.preventDefault();
        const next = (index + step + pages.length) % pages.length;
        this.buttons[next]?.focus();
        this.buttons[next]?.click();
      });
      this.buttons.push(button);
      list.append(button);
      root.append(panel);
      return new OptionPage(this, title, panel);
    });
    this.select(0);
  }

  /** Shows page `index` and hides the others. */
  public select(index: number): void {
    this.buttons.forEach((button, at) => {
      const selected = at === index;
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
      button.tabIndex = selected ? 0 : -1;
      const panel = this.pages[at]?.element;
      if (panel === undefined) return;
      panel.hidden = !selected;
      panel.setAttribute('aria-selected', selected ? 'true' : 'false');
    });
  }

  public override refresh(): void {
    for (const page of this.pages) page.refresh();
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
