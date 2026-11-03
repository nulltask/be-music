import { html } from 'lit';

/** Stable hosts for the preview runtime and its independently rendered overlay. */
export const EMBED_APP_TEMPLATE = html`<main id="preview" class="preview" aria-label="Be-Music preview">
  <div id="stage" class="preview-stage"></div>
  <span class="badge preview-beta" data-variant="outline">Beta</span>
  <div id="overlay" class="preview-overlay"></div>
</main>`;
