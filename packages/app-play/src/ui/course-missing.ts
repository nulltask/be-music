import { html, nothing, render, type TemplateResult } from 'lit';
import type { LibraryCourse } from '@be-music/player-scene-model';
import { describeMissingCourseStages, type MissingCourseStage, type MissingStageLink } from '../course-table-songs.ts';
import { playerText } from '../player-copy.ts';
import { dialogShortcutAria, dialogShortcutHint } from './dialog-shortcuts.ts';

// The dialog a course opens when it is decided with stages missing from the collection (LR2 and beatoraja refuse to
// start it too). It lists those stages, each with the pages its difficulty table names for it (the song, its chart
// when it ships apart, the pack), which open in a new tab: the player downloads and loads them, then plays the course.

/**
 * Opens the dialog for `course`: its missing stages at once, then their download pages once `lookup` (the table's song
 * list) answers. A lookup that answers after the dialog closed, or after it opened for another course, is dropped.
 */
export function showMissingCourseStages(
  course: LibraryCourse,
  lookup: (course: LibraryCourse) => Promise<readonly MissingCourseStage[]>,
): void {
  const dialog = document.querySelector<HTMLDialogElement>('#course-missing');
  if (dialog === null) return;
  const token = Symbol(course.id);
  activeToken = token;
  render(template(course, describeMissingCourseStages(course), true), dialog);
  // The dialog owns keyboard navigation; its keys must not reach the select screen behind it.
  dialog.onkeydown = (event) => event.stopPropagation();
  if (!dialog.open) dialog.showModal();
  void lookup(course).then(
    (stages) => {
      if (activeToken === token && dialog.open) render(template(course, stages, false), dialog);
    },
    () => {
      if (activeToken === token && dialog.open)
        render(template(course, describeMissingCourseStages(course), false), dialog);
    },
  );
}

let activeToken: symbol | undefined;

function linkLabel(link: MissingStageLink): string {
  const t = playerText().course.missingStages;
  const kind = t[link.kind];
  return link.name !== undefined ? `${kind}: ${link.name}` : kind;
}

function stageItem(stage: MissingCourseStage, looking: boolean): TemplateResult {
  const t = playerText().course.missingStages;
  return html`<li class="course-missing-stage">
    <span class="course-missing-number">${t.stage(stage.stage)}</span>
    <span class="course-missing-title">${stage.title}</span>
    ${stage.artist !== undefined ? html`<span class="course-missing-artist">${stage.artist}</span>` : nothing}
    <span class="course-missing-links">
      ${
        stage.links.length > 0
          ? stage.links.map(
              (link) =>
                html`<a
                  class="btn"
                  data-size="sm"
                  data-variant="outline"
                  href=${link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  >${linkLabel(link)}</a
                >`,
            )
          : html`<span class="course-missing-none">${looking ? t.looking : t.noLink}</span>`
      }
    </span>
  </li>`;
}

function template(course: LibraryCourse, stages: readonly MissingCourseStage[], looking: boolean): TemplateResult {
  const t = playerText().course.missingStages;
  return html`<form method="dialog" class="account-dialog-body">
    <header>
      <h2 id="course-missing-title">${t.title}</h2>
      <p id="course-missing-hint">${t.hint(course.definition.name)}</p>
    </header>
    <ol class="course-missing-list">
      ${stages.map((stage) => stageItem(stage, looking))}
    </ol>
    <footer>
      <button
        type="submit"
        class="btn"
        autofocus
        data-dialog-shortcut="primary"
        aria-keyshortcuts=${dialogShortcutAria('primary')}
      >
        ${playerText().shell.ok}${dialogShortcutHint('primary')}
      </button>
    </footer>
  </form>`;
}
