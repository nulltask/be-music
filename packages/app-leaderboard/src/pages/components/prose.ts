import type { PageContent } from '../template.ts';
import { html, nothing } from '@be-music/service-web-theme/server';
/** Long-form text for the About and Help pages: a titled section of muted paragraphs. */

/** The link style inside prose. */
export const PROSE_LINK = 'text-foreground underline underline-offset-4 hover:text-primary';

/** One section, the link target `#id`: a heading and its paragraphs, lists or terms. `loose` spaces the heading wider. */
export function ProseSection(props: { id: string; title: PageContent; loose?: boolean; children: PageContent }) {
  return html`<section
    class=${`scroll-mt-6 ${props.loose === true ? 'space-y-3' : 'space-y-2'}`}
    id=${props.id ?? nothing}
    aria-labelledby=${`${props.id}-title`}
  >
    <h2 id=${`${props.id}-title`} class="text-base font-semibold tracking-tight">${props.title}</h2>
    <div
      class="text-muted-foreground max-w-prose space-y-2 text-sm leading-relaxed [&amp;_li]:ms-5 [&amp;_li]:list-disc [&amp;_strong]:text-foreground [&amp;_strong]:font-medium"
    >
      ${props.children}
    </div>
  </section>`;
}
