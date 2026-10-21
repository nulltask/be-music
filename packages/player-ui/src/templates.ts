import { html, type TemplateResult } from 'lit';
export function stats(pairs: readonly (readonly [string, string | number])[]): TemplateResult {
  return html`<dl>
    ${pairs.map(
      ([label, value]) =>
        html`<dt>${label}</dt>
          <dd>${value}</dd>`,
    )}
  </dl>`;
}
