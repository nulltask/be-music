import { LitElement, type CSSResultGroup, type PropertyDeclarations } from 'lit';
import type { BeMusicUIEventMap } from './events.ts';
import { baseStyles } from './styles/base.ts';

/** No registration, clocks, subscriptions, audio or renderer ownership. */
export abstract class BeMusicElement extends LitElement {
  static override styles: CSSResultGroup = baseStyles;
  constructor() {
    super();
    this.addEventListener('keydown', (event) => {
      const target = event.composedPath()[0] as HTMLElement | undefined;
      const tag = target?.tagName;
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        target?.isContentEditable ||
        ((tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY') && (event.code === 'Enter' || event.code === 'Space'))
      )
        event.stopPropagation();
    });
  }
  protected emit<K extends keyof BeMusicUIEventMap>(name: K, detail: BeMusicUIEventMap[K]): void {
    const EventType = this.ownerDocument.defaultView?.CustomEvent ?? CustomEvent;
    this.dispatchEvent(new EventType(name, { detail, bubbles: true, composed: true }));
  }
}
export abstract class FrameElement<Frame> extends BeMusicElement {
  static override properties: PropertyDeclarations = { frame: { attribute: false } };
  declare frame: Frame | undefined;
}
export abstract class DataElement<Data> extends BeMusicElement {
  static override properties: PropertyDeclarations = { data: { attribute: false } };
  declare data: Data | undefined;
}
