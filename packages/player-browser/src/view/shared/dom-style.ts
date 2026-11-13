/** Inline style properties {@link setStyle} writes. */
export type StyleProperty = Exclude<
  {
    [Key in keyof CSSStyleDeclaration]: CSSStyleDeclaration[Key] extends string ? Key : never;
  }[keyof CSSStyleDeclaration],
  'cssText' | 'cssFloat'
>;

/**
 * Sets an inline style property only when it differs, so an overlay redrawn every frame leaves the style (and the
 * layout behind it) alone while nothing moves.
 */
export function setStyle(element: HTMLElement, property: StyleProperty, value: string): void {
  if (element.style[property] !== value) element.style[property] = value;
}

/** Sets `element.hidden` only when it differs. */
export function setHidden(element: HTMLElement, hidden: boolean): void {
  if (element.hidden !== hidden) element.hidden = hidden;
}
