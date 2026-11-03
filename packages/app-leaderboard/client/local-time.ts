import { LitElement, html } from 'lit';
import { localTimePresentation, type LocalTimePrecision } from '../src/pages/local-time.ts';

/** Shadow DOM keeps localized text separate from htmx's server fallback and morph ownership. */
class BeMusicLocalTimeElement extends LitElement {
  static override properties = {
    dateTime: { attribute: 'datetime' },
    utc: {},
    precision: {},
  };

  declare dateTime: string;
  declare utc: string;
  declare precision: LocalTimePrecision;

  constructor() {
    super();
    this.dateTime = '';
    this.utc = '';
    this.precision = 'minute';
  }

  protected override render() {
    const language = this.closest<HTMLElement>('[lang]')?.lang ?? this.ownerDocument.documentElement.lang;
    const presentation = localTimePresentation({
      dateTime: this.dateTime,
      utc: this.utc,
      precision: this.precision,
      locale: language,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      now: Date.now(),
    });
    return presentation === undefined
      ? html`<slot></slot>`
      : html`<time datetime=${this.dateTime} title=${presentation.title}>${presentation.text}</time>`;
  }
}

if (customElements.get('be-music-local-time') === undefined) {
  customElements.define('be-music-local-time', BeMusicLocalTimeElement);
}
