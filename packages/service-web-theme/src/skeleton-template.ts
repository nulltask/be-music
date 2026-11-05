import { html, type TemplateResult } from 'lit';
import { resolveSkeleton, skeletonLabel, type SkeletonInput } from './skeleton-model.ts';
import type { Locale } from './locale.ts';

/**
 * One shimmering placeholder in the box of the element it stands in for. It is decoration: wrap the placeholders of a
 * region in {@link skeletonGroupTemplate}, which tells assistive technology the region is loading. `skeleton.css`
 * styles it; it stops moving under `prefers-reduced-motion`.
 */
export function skeletonTemplate(input: SkeletonInput & { className?: string } = {}): TemplateResult {
  const view = resolveSkeleton(input);
  return html`<span
    class=${`be-music-skeleton${input.className ? ` ${input.className}` : ''}`}
    data-shape=${view.shape}
    style=${view.style}
    aria-hidden="true"
  ></span>`;
}

/**
 * A loading region: busy for assistive technology, which hears `label` (or "Loading…") once, while the placeholders
 * in `content` stay silent. Replace the whole group with the loaded content.
 */
export function skeletonGroupTemplate(input: {
  locale: Locale;
  content: unknown;
  label?: string;
  className?: string;
}): TemplateResult {
  return html`<span
    class=${`be-music-skeleton-group${input.className ? ` ${input.className}` : ''}`}
    role="status"
    aria-busy="true"
    ><span class="be-music-skeleton-label">${skeletonLabel(input.locale, input.label)}</span>${input.content}</span
  >`;
}
