// The dialog a dropped course replay opens when some of its stage charts are not loaded: it lists them, and the replay
// does not start (LR2 and beatoraja refuse a course replay with a stage chart missing too).

/** Lists the stage charts `courseName`'s replay needs that are not loaded (each line as `describeCourseReplayStage`). */
export function showMissingCourseReplayCharts(courseName: string, stages: readonly string[]): void {
  const dialog = document.querySelector<HTMLDialogElement>('#course-replay-missing');
  if (dialog === null) return;
  const hint = dialog.querySelector('[data-course-replay-missing-hint]');
  if (hint !== null) {
    hint.textContent = `Load these charts of ${courseName} to replay the course, then drop its course replay again.`;
  }
  const list = dialog.querySelector('[data-course-replay-missing-list]');
  if (list !== null) {
    list.replaceChildren(
      ...stages.map((stage) => {
        const item = document.createElement('li');
        item.textContent = stage;
        return item;
      }),
    );
  }
  // The dialog owns keyboard navigation; its keys must not reach the player's shortcuts.
  dialog.onkeydown = (event) => event.stopPropagation();
  if (!dialog.open) dialog.showModal();
}
