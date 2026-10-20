/** A rectangle in CSS pixels. */
export interface FieldRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where and how large the search field sits over a skin's search box, in the shell's CSS pixels. */
export interface InlineFieldPlacement {
  left: number;
  top: number;
  width: number;
  height: number;
  fontSize: number;
}

/**
 * Lays the search field over a skin's search box: `field` is the box on the canvas (from the select scene), `canvas`
 * and `shell` are the canvas's and the shell's page boxes. The text is sized to the box (a little over a third of its height, as the built-in skins set theirs; never
 * under 12 px so it stays readable, and never under 16 px on touch screens, where a smaller font makes iOS zoom in).
 */
export function placeInlineField(
  field: FieldRect,
  canvas: { left: number; top: number },
  shell: { left: number; top: number },
  touch = false,
): InlineFieldPlacement {
  const fontSize = Math.max(touch ? 16 : 12, Math.round(field.height * 0.38));
  return {
    left: canvas.left - shell.left + field.x,
    top: canvas.top - shell.top + field.y,
    width: field.width,
    height: field.height,
    fontSize,
  };
}

/** What the inline search needs from the player. */
export interface InlineSearchHost {
  readonly input: HTMLInputElement;
  readonly shell: HTMLElement;
  /** The canvas the select scene draws on. */
  canvas(): HTMLCanvasElement | undefined;
  /** The skin's search box on the canvas, or undefined when the scene on screen has none (beatoraja, Plain portrait…). */
  fieldRect(): FieldRect | undefined;
  /** Filters the scene on screen. */
  setQuery(query: string): void;
  /** Tells the scene whether the field sits over its box, so it leaves the box's text to the field. */
  setEditing(editing: boolean): void;
  /** Whether the page is used by touch first (larger text, no iOS zoom). */
  touch(): boolean;
}

/**
 * The search field. Where the skin draws a search box, typing happens in place: the field moves over the box (and
 * follows it while it moves or the window resizes) and the skin stops drawing the box's text until the field is left.
 * Elsewhere — a beatoraja skin, which has no box — the field stays where it is, at the foot of the screen.
 *
 * IME: while a composition is in progress the list is not narrowed by the half-typed reading; the query is applied when
 * the composition commits.
 */
export class InlineSearch {
  private following = 0;
  private inline = false;

  private readonly host: InlineSearchHost;

  constructor(host: InlineSearchHost) {
    this.host = host;
    const { input } = host;
    input.addEventListener('input', (event) => {
      if ((event as InputEvent).isComposing) return;
      host.setQuery(input.value);
    });
    input.addEventListener('compositionend', () => host.setQuery(input.value));
    input.addEventListener('focus', () => this.attach());
    input.addEventListener('blur', () => this.detach());
    input.addEventListener('keydown', (event) => {
      // Keys that confirm a conversion belong to the IME.
      if (event.isComposing) return;
      if (event.key === 'Escape') {
        // Clears the filter and gives the keys back to the list.
        event.preventDefault();
        input.value = '';
        host.setQuery('');
        input.blur();
      } else if (event.key === 'Enter') {
        // The query already moved the cursor to the first match: leaving the field lets the next Enter pick it.
        event.preventDefault();
        input.blur();
      }
    });
  }

  /** Starts typing: focuses the field (over the skin's box when there is one) with its text selected. */
  open(): void {
    this.host.input.focus();
    this.host.input.select();
  }

  /**
   * {@link open} for a click on the skin's box. The scene reports the click from its `pointerdown`; the browser's
   * `mousedown` that follows would move focus back to the page and close the field at once, so it opens once the
   * click's events have run.
   */
  openFromPointer(): void {
    setTimeout(() => this.open(), 0);
  }

  /** Whether the skin on screen draws its own search box, so the field at the foot of the screen can step aside. */
  get skinHasBox(): boolean {
    return this.host.fieldRect() !== undefined;
  }

  private attach(): void {
    if (this.host.fieldRect() === undefined) return;
    this.inline = true;
    this.host.input.classList.add('search-inline');
    this.host.setEditing(true);
    const follow = () => {
      if (!this.inline) return;
      this.place();
      this.following = requestAnimationFrame(follow);
    };
    follow();
  }

  private detach(): void {
    if (!this.inline) return;
    this.inline = false;
    cancelAnimationFrame(this.following);
    const { input } = this.host;
    input.classList.remove('search-inline');
    for (const property of ['left', 'top', 'width', 'height', 'font-size']) input.style.removeProperty(property);
    this.host.setEditing(false);
  }

  /** Moves the field over the box as it is now; leaves it be when the box went away mid-edit. */
  private place(): void {
    const field = this.host.fieldRect();
    const canvas = this.host.canvas();
    if (field === undefined || canvas === undefined) return;
    const placement = placeInlineField(
      field,
      canvas.getBoundingClientRect(),
      this.host.shell.getBoundingClientRect(),
      this.host.touch(),
    );
    const { style } = this.host.input;
    style.left = `${placement.left}px`;
    style.top = `${placement.top}px`;
    style.width = `${placement.width}px`;
    style.height = `${placement.height}px`;
    style.fontSize = `${placement.fontSize}px`;
  }
}
