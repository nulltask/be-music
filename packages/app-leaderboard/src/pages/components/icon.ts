import { html, unsafeHTML } from '@be-music/service-web-theme/server';
/**
 * A Lucide icon inlined from `lucide-static`: no font to load, crisp at any size, drawn in the text colour. Decorative
 * (`aria-hidden`); the text next to it, or the control's label, says what it is.
 */
export function Icon(props: { svg: string; class?: string }) {
  return html`<span class=${`inline-flex shrink-0 [&>svg]:size-4 ${props.class ?? ''}`} aria-hidden="true"
    >${unsafeHTML(props.svg.trim())}</span
  >`;
}
