import type { TemplateResult } from '@be-music/service-web-theme/server';

/** Synchronous page content; htmx receives plain HTML rather than a client hydration tree. */
export type PageContent = TemplateResult | string | number | boolean | null | undefined | Iterable<PageContent>;
