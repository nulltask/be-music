import { html, render } from 'lit';

// The dialog a dropped replay opens when the charts it was played on are not loaded: a replay's chart, or the stage
// charts of a course replay (LR2 and beatoraja refuse a course replay with a stage chart missing too). It lists them,
// and the replay does not start.

/** Lists the charts a replay needs that are not loaded, under `hint` (what to do about them). */
export function showMissingReplayCharts(hint: string, charts: readonly string[]): void {
  const dialog = document.querySelector<HTMLDialogElement>('#replay-missing');
  if (dialog === null) return;
  const hintElement = dialog.querySelector<HTMLElement>('[data-replay-missing-hint]');
  if (hintElement !== null) render(hint, hintElement);
  const list = dialog.querySelector<HTMLElement>('[data-replay-missing-list]');
  if (list !== null)
    render(
      charts.map((chart) => html`<li>${chart}</li>`),
      list,
    );

  // The dialog owns keyboard navigation; its keys must not reach the player's shortcuts.
  dialog.onkeydown = (event) => event.stopPropagation();
  if (!dialog.open) dialog.showModal();
}
