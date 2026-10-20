/** @jsxImportSource hono/jsx */
/**
 * A Lucide icon inlined from `lucide-static`: no font to load, crisp at any size, drawn in the text colour. Decorative
 * (`aria-hidden`); the text next to it, or the control's label, says what it is.
 */
export function Icon(props: { svg: string; class?: string }) {
  return (
    <span
      class={`inline-flex shrink-0 [&>svg]:size-4 ${props.class ?? ''}`}
      aria-hidden="true"
      // Trusted markup from lucide-static, trimmed of its leading comment and whitespace.
      dangerouslySetInnerHTML={{ __html: props.svg.trim() }}
    />
  );
}
