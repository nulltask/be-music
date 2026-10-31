import { html, nothing, type TemplateResult } from 'lit';

/**
 * The AUTO checkbox of the preview's list and start screens: checked, the preview plays the chart by itself; cleared,
 * the viewer plays it. Nothing while `autoPlay` is unset; `disabled` while the play it would change is loading. Style it with `.auto-play`.
 */
export function renderAutoPlayCheck(
  autoPlay: boolean | undefined,
  onChange: (autoPlay: boolean) => void,
  disabled = false,
): TemplateResult | typeof nothing {
  if (autoPlay === undefined) return nothing;
  return html`<label class="auto-play" part="auto-play">
    <input
      class="input"
      type="checkbox"
      .checked=${autoPlay}
      ?disabled=${disabled}
      @change=${(event: Event) => onChange((event.currentTarget as HTMLInputElement).checked)}
    />
    <span>AUTO</span>
  </label>`;
}
