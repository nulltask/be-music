import { html, nothing, render, type TemplateResult } from 'lit';
import { live } from 'lit/directives/live.js';
import { repeat } from 'lit/directives/repeat.js';
// The course maker's DOM surfaces, for every skin: a card shown while a course is being made (its name, charts and
// finish / cancel, standing in for an LR2 skin's buttons 230 / 231 and texts 150-170), and a dialog that manages the
// saved courses (rename, NONSTOP connections, delete, IR flag as LR2's button 253 / text 183, export as `.lr2crs`) and
// the RANDOM MIX settings (LR2's buttons 260-266).

import {
  courseConstraintGroup,
  LR2_NONSTOP_CONNECTIONS,
  LR2_RANDOM_MIX_SETTING_RANGES,
  parseLR2NonstopConnections,
  serializeBeatorajaCourseFile,
  serializeLR2CourseFile,
  type CourseConstraint,
  type CourseConstraintGroup,
  type CourseDefinition,
  type CourseKind,
  type LR2RandomMixSetting,
  type NonstopConnection,
} from '@be-music/player-engine/course';
import { COURSE_NAME_PROMPT, type CourseMaker } from '@be-music/player-browser/collection';
import { formatLR2RandomMixSetting } from '@be-music/skin-lr2/state';
import { playerText } from './player-copy.ts';

/** LR2's names of the NONSTOP connections. */
export const CONNECTION_LABELS: Readonly<Record<NonstopConnection, string>> = {
  fade: 'FADE',
  'fade-fit': 'FADE+FIT',
  cut: 'CUT',
  'cut-fit': 'CUT+FIT',
  blank1: 'BLANK1',
  blank2: 'BLANK2',
};

const KIND_LABELS: Readonly<Record<CourseKind, string>> = { expert: 'EXPERT', nonstop: 'NONSTOP', grade: 'GRADE' };

/** The connection after each stage but the last of a saved NONSTOP course, as its header holds them. */
export function madeCourseConnections(course: CourseDefinition): NonstopConnection[] {
  if (course.kind !== 'nonstop') return [];
  const header = course.source.format === 'lr2crs' ? course.source.header : '';
  return parseLR2NonstopConnections(header).slice(0, Math.max(0, course.stages.length - 1));
}

/** The constraint choices of each group, as beatoraja's course editor offers them; the first one is "none". */
const CONSTRAINT_FIELDS: readonly {
  group: CourseConstraintGroup;
  label: () => string;
  choices: readonly (readonly [CourseConstraint | '', () => string])[];
}[] = [
  {
    group: 'option',
    label: () => playerText().course.constraints.option,
    choices: [
      ['', () => playerText().course.choices.free],
      ['grade', () => playerText().course.choices.offOnly],
      ['grade_mirror', () => playerText().course.choices.offOrMirror],
      ['grade_random', () => playerText().course.choices.randomFamily],
    ],
  },
  {
    group: 'speed',
    label: () => playerText().course.constraints.speed,
    choices: [
      ['', () => playerText().course.choices.free],
      ['no_speed', () => playerText().course.choices.locked],
    ],
  },
  {
    group: 'judge',
    label: () => playerText().course.constraints.judge,
    choices: [
      ['', () => playerText().course.choices.normal],
      ['no_great', () => playerText().course.choices.noGreat],
      ['no_good', () => playerText().course.choices.noGood],
    ],
  },
  {
    group: 'gauge',
    label: () => playerText().course.constraints.gauge,
    choices: [
      ['', () => playerText().course.choices.playersChoice],
      ['gauge_lr2', () => 'LR2'],
      ['gauge_5k', () => playerText().course.choices.keys5],
      ['gauge_7k', () => playerText().course.choices.keys7],
      ['gauge_9k', () => playerText().course.choices.keys9],
      ['gauge_24k', () => playerText().course.choices.keys24],
    ],
  },
  {
    group: 'longNote',
    label: () => playerText().course.constraints.longNote,
    choices: [
      ['', () => playerText().course.choices.asCharted],
      ['ln', () => 'LN'],
      ['cn', () => 'CN'],
      ['hcn', () => 'HCN'],
    ],
  },
];

/**
 * Selects for a course's constraints, one per group (beatoraja's `CourseDataConstraint`). A NONSTOP course has no
 * long-note choice: the stitched chart does not carry a stage's long-note mode.
 */
function constraintEditor(
  kind: CourseKind,
  constraints: readonly CourseConstraint[],
  onChange: (constraints: CourseConstraint[]) => void,
  disabled = false,
): TemplateResult {
  const fields = CONSTRAINT_FIELDS.filter((field) => kind !== 'nonstop' || field.group !== 'longNote');
  return html`<div class="course-maker-constraints">
    ${fields.map((field) => {
      const current = constraints.find((constraint) => courseConstraintGroup(constraint) === field.group) ?? '';
      return html`<label class="course-maker-field"
        >${field.label()}
        <select
          class="select course-maker-select"
          ?disabled=${disabled}
          @change=${(event: Event) => {
            const value = (event.currentTarget as HTMLSelectElement).value;
            const others = constraints.filter((constraint) => courseConstraintGroup(constraint) !== field.group);
            onChange(value === '' ? others : [...others, value as CourseConstraint]);
          }}
        >
          ${field.choices.map(([value, label]) => html`<option value=${value} .selected=${live(value === current)}>${label()}</option>`)}
        </select>
      </label>`;
    })}
  </div>`;
}

/** Offers `text` as a file download named `filename`. */
function download(filename: string, text: string, type = 'application/xml'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function connectionSelect(
  value: NonstopConnection,
  onChange: (value: NonstopConnection) => void,
  disabled = false,
): TemplateResult {
  return html`<select
    class="select course-maker-select"
    ?disabled=${disabled}
    @change=${(event: Event) => onChange((event.currentTarget as HTMLSelectElement).value as NonstopConnection)}
  >
    ${LR2_NONSTOP_CONNECTIONS.map((connection) => html`<option value=${connection} .selected=${live(connection === value)}>${CONNECTION_LABELS[connection]}</option>`)}
  </select>`;
}

/** The RANDOM MIX settings in LR2's button order (260-266), with what the dialog calls each. */
const RANDOM_MIX_FIELDS: readonly { readonly setting: LR2RandomMixSetting; readonly label: () => string }[] = [
  { setting: 'preferredLevel', label: () => playerText().course.randomMix.preferredLevel },
  { setting: 'maxLevel', label: () => playerText().course.randomMix.maxLevel },
  { setting: 'minLevel', label: () => playerText().course.randomMix.minLevel },
  { setting: 'bpmRange', label: () => playerText().course.randomMix.bpmRange },
  { setting: 'maxBPM', label: () => playerText().course.randomMix.maxBPM },
  { setting: 'minBPM', label: () => playerText().course.randomMix.minBPM },
  { setting: 'stageCount', label: () => playerText().course.randomMix.stageCount },
];

/** A select of every value of a RANDOM MIX setting, written as LR2's texts 190-196 write them. */
function randomMixSelect(
  setting: LR2RandomMixSetting,
  value: number,
  onChange: (value: number) => void,
): TemplateResult {
  const { max, step } = LR2_RANDOM_MIX_SETTING_RANGES[setting];
  return html`<select
    class="select course-maker-select"
    @change=${(event: Event) => onChange(Number((event.currentTarget as HTMLSelectElement).value))}
  >
    ${Array.from({ length: Math.floor(max / step) + 1 }, (_, index) => {
      const option = index * step;
      return html`<option value=${option} .selected=${live(option === value)}>
        ${formatLR2RandomMixSetting(setting, option)}
      </option>`;
    })}
  </select>`;
}

/** Keeps field keys from reaching the select scene; Escape still cancels the draft. */
function isolateKeys(event: KeyboardEvent): void {
  if (event.key !== 'Escape') event.stopPropagation();
}

function connectionDelta(from: NonstopConnection, to: NonstopConnection): number {
  return LR2_NONSTOP_CONNECTIONS.indexOf(to) - LR2_NONSTOP_CONNECTIONS.indexOf(from);
}

export class CourseMakerPanel {
  private readonly card: HTMLElement;
  private readonly dialog: HTMLDialogElement;

  private readonly maker: CourseMaker;

  /** Reports what the card's buttons did on the host's status line. */
  private readonly onStatus: ((text: string) => void) | undefined;

  constructor(maker: CourseMaker, options: { onStatus?: (text: string) => void } = {}) {
    this.maker = maker;
    this.onStatus = options.onStatus;
    this.card = document.createElement('aside');
    this.card.className = 'card course-maker-card gap-3 px-4';
    this.card.hidden = true;
    this.card.setAttribute('aria-label', 'Course maker');
    this.dialog = document.createElement('dialog');
    this.dialog.className = 'dialog course-maker-dialog';
    this.dialog.setAttribute('aria-label', 'My courses');
    // The modal owns the keyboard: keys must not also drive the select scene behind it (Escape still closes it).
    for (const type of ['keydown', 'keyup'] as const)
      this.dialog.addEventListener(type, (event) => event.stopPropagation());
    document.body.append(this.card, this.dialog);
  }

  /** Redraws the card from the course being made (hidden when none is), and the dialog when it is open. */
  update(): void {
    this.renderCard();
    if (this.dialog.open) this.renderDialog();
  }

  /** Puts the cursor in the course name field (an LR2 skin's text 170 was clicked). */
  focusName(): void {
    if (this.maker.draft !== undefined) {
      // The click arrives on pointerdown; focusing at once would lose to the canvas the mousedown then focuses.
      setTimeout(() => {
        const name = this.card.querySelector<HTMLInputElement>('.course-maker-name');
        name?.focus();
        name?.select();
      }, 0);
    } else {
      this.openManager();
    }
  }

  /** Opens the saved-course manager. */
  openManager(): void {
    this.renderDialog();
    if (!this.dialog.open) this.dialog.showModal();
  }

  /**
   * Asks before flagging a saved course for IR (LR2's button 253): the flag cannot be turned off, and the course is
   * read-only from then on.
   */
  confirmRelease(course: CourseDefinition): void {
    if (window.confirm(playerText().course.confirmIR(course.name))) this.maker.releaseCourse(course);
  }

  /** Asks before deleting a saved course, as LR2 does. */
  confirmDelete(course: CourseDefinition): void {
    if (window.confirm(playerText().course.confirmDelete(course.name))) this.maker.deleteCourse(course);
  }

  dispose(): void {
    render(nothing, this.card);
    render(nothing, this.dialog);
    this.card.remove();
    this.dialog.remove();
  }

  private renderCard(): void {
    const draft = this.maker.draft;
    this.card.hidden = draft === undefined;
    if (draft === undefined) return;
    const copy = playerText().course;
    const name = this.card.querySelector<HTMLInputElement>('.course-maker-name');
    render(
      html`
        <header>
          <h2>${copy.newCourse(KIND_LABELS[draft.kind])}</h2>
          <p>${draft.stages.length === 0 ? copy.decideCharts : copy.chartCount(draft.stages.length)}</p>
        </header>
        <input
          class="input course-maker-name"
          maxlength="64"
          placeholder=${COURSE_NAME_PROMPT}
          aria-label=${copy.courseName}
          .value=${live(document.activeElement === name ? name!.value : draft.name)}
          @keydown=${isolateKeys}
          @keyup=${isolateKeys}
          @input=${(event: Event) => this.maker.rename((event.currentTarget as HTMLInputElement).value)}
        />
        <ol class="course-maker-stages">
          ${draft.stages.map((stage) => html`<li>${stage.title ?? stage.md5} · ${stage.keyMode}K</li>`)}
        </ol>
        <div>
          ${
            draft.kind === 'nonstop'
              ? html`<label class="course-maker-field"
                  >${copy.connection}
                  ${connectionSelect(this.maker.defaultConnection, (value) => this.maker.stepDefaultConnection(connectionDelta(this.maker.defaultConnection, value)))}
                </label>`
              : nothing
          }
        </div>
        <div>
          ${constraintEditor(draft.kind, draft.constraints ?? [], (constraints) => this.maker.setConstraints(constraints))}
        </div>
        <div class="course-maker-buttons">
          <button
            class="btn"
            type="button"
            data-size="sm"
            data-variant="outline"
            ?disabled=${draft.stages.length === 0}
            @click=${() => this.maker.removeLast()}
          >
            ${copy.removeLast}
          </button>
          <button
            class="btn"
            type="button"
            data-size="sm"
            @click=${() => {
              this.maker.cancel();
              this.onStatus?.(playerText().course.stopped);
            }}
          >
            ${playerText().shell.cancel}
          </button>
          <button
            class="btn"
            type="button"
            data-size="sm"
            ?disabled=${draft.stages.length === 0}
            @click=${() => {
              const saved = this.maker.finish();
              if (saved !== undefined) this.onStatus?.(playerText().course.saved(saved.name));
            }}
          >
            ${copy.save}
          </button>
        </div>
      `,
      this.card,
    );
  }

  private renderDialog(): void {
    const courses = this.maker.courses;
    const copy = playerText().course;
    render(
      html`<div>
        <header>
          <h2>${copy.myCourses}</h2>
          <p>${copy.myCoursesLead}</p>
        </header>
        <div class="course-maker-list">
          ${
            courses.length === 0
              ? html`<p>${copy.empty}</p>`
              : repeat(
                  courses,
                  (course) => course,
                  (course) => this.renderCourse(course),
                )
          }
        </div>
        ${this.renderRandomMixSettings()}
        <div class="course-maker-buttons">
          <button
            class="btn"
            type="button"
            data-size="sm"
            data-variant="outline"
            ?disabled=${courses.length === 0}
            @click=${() => download('my-courses.lr2crs', serializeLR2CourseFile(this.maker.courses))}
          >
            ${copy.exportLr2}
          </button>
          <button
            class="btn"
            type="button"
            data-size="sm"
            data-variant="outline"
            ?disabled=${!courses.some((course) => course.kind !== 'nonstop')}
            @click=${() => download('my-courses.json', serializeBeatorajaCourseFile(this.maker.courses), 'application/json')}
          >
            ${copy.exportBeatoraja}
          </button>
          <button class="btn" type="button" data-size="sm" @click=${() => this.dialog.close()}>
            ${playerText().shell.close}
          </button>
        </div>
      </div>`,
      this.dialog,
    );
  }

  /** The settings by which RANDOM MIX draws a course. */
  private renderRandomMixSettings(): TemplateResult {
    const settings = this.maker.randomMixSettings;
    return html`<section class="card course-maker-course gap-2 px-3">
      <h3>RANDOM MIX</h3>
      <div>
        ${RANDOM_MIX_FIELDS.map(
          ({ setting, label }) =>
            html` <label class="course-maker-field"
              >${label()}
              ${randomMixSelect(setting, settings[setting], (value) =>
                this.maker.stepRandomMixSetting(
                  setting,
                  (value - this.maker.randomMixSettings[setting]) / LR2_RANDOM_MIX_SETTING_RANGES[setting].step,
                ),
              )}
            </label>`,
        )}
      </div>
    </section>`;
  }

  private renderCourse(course: CourseDefinition): TemplateResult {
    const copy = playerText().course;
    const readOnly = this.maker.isReadOnly(course);
    const connections = madeCourseConnections(course);
    return html`<section class="card course-maker-course gap-2 px-3">
      <div class="course-maker-course-head">
        <input
          class="input course-maker-name"
          maxlength="64"
          aria-label=${copy.courseName}
          .value=${live(course.name)}
          @keydown=${isolateKeys}
          @keyup=${isolateKeys}
          @change=${(event: Event) => this.maker.renameCourse(course, (event.currentTarget as HTMLInputElement).value)}
        />
        <span class="course-maker-kind">${KIND_LABELS[course.kind]}</span>
        <button
          class="btn"
          type="button"
          data-size="sm"
          data-variant="outline"
          @click=${() => this.confirmDelete(course)}
        >
          ${copy.delete}
        </button>
      </div>
      <ol class="course-maker-stages">
        ${course.stages.map(
          (stage, index) =>
            html`<li>
              ${stage.title ?? stage.md5 ?? ''}
              ${
                connections[index] !== undefined
                  ? connectionSelect(
                      connections[index],
                      (value) => this.maker.stepConnection(course, index, connectionDelta(connections[index]!, value)),
                      readOnly,
                    )
                  : nothing
              }
            </li>`,
        )}
      </ol>
      ${constraintEditor(course.kind, course.constraints, (constraints) => this.maker.setCourseConstraints(course, constraints), readOnly)}
      ${
        readOnly
          ? html`<p class="course-maker-ir">${copy.irOn}</p>`
          : html`<button
              class="btn"
              type="button"
              data-size="sm"
              data-variant="outline"
              @click=${() => this.confirmRelease(course)}
            >
              ${copy.registerIR}
            </button>`
      }
    </section>`;
  }
}
