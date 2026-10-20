/** @jsxImportSource hono/jsx */
/** Long-form text for the About and Help pages: a titled section of muted paragraphs. */
import type { Child } from 'hono/jsx';

/** The link style inside prose. */
export const PROSE_LINK = 'text-foreground underline underline-offset-4 hover:text-primary';

/** One section, the link target `#id`: a heading and its paragraphs, lists or terms. `loose` spaces the heading wider. */
export function ProseSection(props: { id: string; title: Child; loose?: boolean; children: Child }) {
  return (
    <section
      class={`scroll-mt-6 ${props.loose === true ? 'space-y-3' : 'space-y-2'}`}
      id={props.id}
      aria-labelledby={`${props.id}-title`}
    >
      <h2 id={`${props.id}-title`} class="text-base font-semibold tracking-tight">
        {props.title}
      </h2>
      <div class="text-muted-foreground max-w-prose space-y-2 text-sm leading-relaxed [&_li]:ms-5 [&_li]:list-disc [&_strong]:text-foreground [&_strong]:font-medium">
        {props.children}
      </div>
    </section>
  );
}
