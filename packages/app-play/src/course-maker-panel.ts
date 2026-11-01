// The course maker's DOM surfaces, for every skin: a card shown while a course is being made (its name, songs and
// finish / cancel, standing in for an LR2 skin's buttons 230 / 231 and texts 150-170), and a dialog that manages the
// saved courses (rename, NONSTOP connections, delete, export as `.lr2crs`) and the RANDOM MIX settings (LR2's buttons
// 260-266).

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
): HTMLElement {
  const fields = CONSTRAINT_FIELDS.filter((field) => kind !== 'nonstop' || field.group !== 'longNote');
  return element(
    'div',
    { className: 'course-maker-constraints' },
    fields.map((field) => {
      const current = constraints.find((constraint) => courseConstraintGroup(constraint) === field.group) ?? '';
      const select = element('select', { className: 'select course-maker-select' });
      for (const [value, label] of field.choices) {
        const option = element('option', { text: label() });
        option.value = value;
        option.selected = value === current;
        select.append(option);
      }
      select.addEventListener('change', () => {
        const others = constraints.filter((constraint) => courseConstraintGroup(constraint) !== field.group);
        onChange(select.value === '' ? others : [...others, select.value as CourseConstraint]);
      });
      return element('label', { className: 'course-maker-field', text: field.label() }, [select]);
    }),
  );
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

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { className?: string; text?: string } = {},
  children: Node[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.className !== undefined) node.className = props.className;
  if (props.text !== undefined) node.textContent = props.text;
  node.append(...children);
  return node;
}

function button(label: string, className: string, onClick: () => void, variant?: 'outline'): HTMLButtonElement {
  const node = element('button', { className, text: label });
  node.type = 'button';
  node.dataset.size = 'sm';
  if (variant !== undefined) node.dataset.variant = variant;
  node.addEventListener('click', onClick);
  return node;
}

function connectionSelect(value: NonstopConnection, onChange: (value: NonstopConnection) => void): HTMLSelectElement {
  const select = element('select', { className: 'select course-maker-select' });
  for (const connection of LR2_NONSTOP_CONNECTIONS) {
    const option = element('option', { text: CONNECTION_LABELS[connection] });
    option.value = connection;
    option.selected = connection === value;
    select.append(option);
  }
  select.addEventListener('change', () => onChange(select.value as NonstopConnection));
  return select;
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
function randomMixSelect(setting: LR2RandomMixSetting, value: number, onChange: (value: number) => void) {
  const { max, step } = LR2_RANDOM_MIX_SETTING_RANGES[setting];
  const select = element('select', { className: 'select course-maker-select' });
  for (let option = 0; option <= max; option += step) {
    const item = element('option', { text: formatLR2RandomMixSetting(setting, option) });
    item.value = String(option);
    item.selected = option === value;
    select.append(item);
  }
  select.addEventListener('change', () => onChange(Number(select.value)));
  return select;
}

/** Keeps keys typed into a field from reaching the select scene's window-level key handlers. */
function isolateKeys(field: HTMLElement): void {
  for (const type of ['keydown', 'keyup'] as const) {
    field.addEventListener(type, (event) => {
      if (event.key !== 'Escape') event.stopPropagation();
    });
  }
}

function connectionDelta(from: NonstopConnection, to: NonstopConnection): number {
  return LR2_NONSTOP_CONNECTIONS.indexOf(to) - LR2_NONSTOP_CONNECTIONS.indexOf(from);
}

interface CardParts {
  title: HTMLElement;
  hint: HTMLElement;
  name: HTMLInputElement;
  stages: HTMLOListElement;
  connection: HTMLElement;
  constraints: HTMLElement;
  removeLast: HTMLButtonElement;
  save: HTMLButtonElement;
}

export class CourseMakerPanel {
  private readonly card: HTMLElement;
  private readonly dialog: HTMLDialogElement;
  private cardParts: CardParts | undefined;

  private readonly maker: CourseMaker;

  /** Reports what the card's buttons did on the host's status line. */
  private readonly onStatus: ((text: string) => void) | undefined;

  constructor(maker: CourseMaker, options: { onStatus?: (text: string) => void } = {}) {
    this.maker = maker;
    this.onStatus = options.onStatus;
    this.card = element('aside', { className: 'card course-maker-card gap-3 px-4' });
    this.card.hidden = true;
    this.card.setAttribute('aria-label', 'Course maker');
    this.dialog = element('dialog', { className: 'dialog course-maker-dialog' });
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
        this.cardParts?.name.focus();
        this.cardParts?.name.select();
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

  /** Asks before deleting a saved course, as LR2 does. */
  confirmDelete(course: CourseDefinition): void {
    if (window.confirm(playerText().course.confirmDelete(course.name))) this.maker.deleteCourse(course);
  }

  dispose(): void {
    this.card.remove();
    this.dialog.remove();
  }

  private renderCard(): void {
    const draft = this.maker.draft;
    this.card.hidden = draft === undefined;
    if (draft === undefined) return;
    const parts = (this.cardParts ??= this.buildCard());
    const copy = playerText().course;
    parts.title.textContent = copy.newCourse(KIND_LABELS[draft.kind]);
    parts.hint.textContent = draft.stages.length === 0 ? copy.decideCharts : copy.chartCount(draft.stages.length);
    // The name field stays in place across redraws: moving it would drop its focus mid-typing.
    if (document.activeElement !== parts.name) parts.name.value = draft.name;
    parts.stages.replaceChildren(
      ...draft.stages.map((stage) => element('li', { text: `${stage.title ?? stage.md5} · ${stage.keyMode}K` })),
    );
    parts.connection.replaceChildren(
      ...(draft.kind === 'nonstop'
        ? [
            element('label', { className: 'course-maker-field', text: playerText().course.connection }, [
              connectionSelect(this.maker.defaultConnection, (value) =>
                this.maker.stepDefaultConnection(connectionDelta(this.maker.defaultConnection, value)),
              ),
            ]),
          ]
        : []),
    );
    parts.constraints.replaceChildren(
      constraintEditor(draft.kind, draft.constraints ?? [], (constraints) => this.maker.setConstraints(constraints)),
    );
    parts.save.disabled = draft.stages.length === 0;
    parts.removeLast.disabled = draft.stages.length === 0;
  }

  /** The card's elements, built once. */
  private buildCard(): CardParts {
    const name = element('input', { className: 'input course-maker-name' });
    name.maxLength = 64;
    name.placeholder = COURSE_NAME_PROMPT;
    name.setAttribute('aria-label', playerText().course.courseName);
    isolateKeys(name);
    name.addEventListener('input', () => this.maker.rename(name.value));
    const parts: CardParts = {
      title: element('h2'),
      hint: element('p'),
      name,
      stages: element('ol', { className: 'course-maker-stages' }),
      connection: element('div'),
      constraints: element('div'),
      removeLast: button(playerText().course.removeLast, 'btn', () => this.maker.removeLast(), 'outline'),
      save: button(playerText().course.save, 'btn', () => {
        const saved = this.maker.finish();
        if (saved !== undefined) this.onStatus?.(playerText().course.saved(saved.name));
      }),
    };
    this.card.replaceChildren(
      element('header', {}, [parts.title, parts.hint]),
      parts.name,
      parts.stages,
      parts.connection,
      parts.constraints,
      element('div', { className: 'course-maker-buttons' }, [
        parts.removeLast,
        button(playerText().shell.cancel, 'btn', () => {
          this.maker.cancel();
          this.onStatus?.(playerText().course.stopped);
        }),
        parts.save,
      ]),
    );
    return parts;
  }

  private renderDialog(): void {
    const courses = this.maker.courses;
    const list = element(
      'div',
      { className: 'course-maker-list' },
      courses.length === 0
        ? [element('p', { text: playerText().course.empty })]
        : courses.map((course) => this.renderCourse(course)),
    );
    const exportButton = button(
      playerText().course.exportLr2,
      'btn',
      () => download('my-courses.lr2crs', serializeLR2CourseFile(this.maker.courses)),
      'outline',
    );
    exportButton.disabled = courses.length === 0;
    // beatoraja's course file keeps the constraints, which `.lr2crs` cannot hold; it has no NONSTOP courses.
    const exportBeatoraja = button(
      playerText().course.exportBeatoraja,
      'btn',
      () => download('my-courses.json', serializeBeatorajaCourseFile(this.maker.courses), 'application/json'),
      'outline',
    );
    exportBeatoraja.disabled = !courses.some((course) => course.kind !== 'nonstop');
    this.dialog.replaceChildren(
      element('div', {}, [
        element('header', {}, [
          element('h2', { text: playerText().course.myCourses }),
          element('p', { text: playerText().course.myCoursesLead }),
        ]),
        list,
        this.renderRandomMixSettings(),
        element('div', { className: 'course-maker-buttons' }, [
          exportButton,
          exportBeatoraja,
          button(playerText().shell.close, 'btn', () => this.dialog.close()),
        ]),
      ]),
    );
  }

  /** The RANDOM MIX settings, which the RANDOM MIX bar of MY COURSES and MY NONSTOP draws a course by. */
  private renderRandomMixSettings(): HTMLElement {
    const settings = this.maker.randomMixSettings;
    return element('section', { className: 'card course-maker-course gap-2 px-3' }, [
      element('h3', { text: 'RANDOM MIX' }),
      element(
        'div',
        {},
        RANDOM_MIX_FIELDS.map(({ setting, label }) =>
          element('label', { className: 'course-maker-field', text: label() }, [
            randomMixSelect(setting, settings[setting], (value) =>
              this.maker.stepRandomMixSetting(
                setting,
                (value - settings[setting]) / LR2_RANDOM_MIX_SETTING_RANGES[setting].step,
              ),
            ),
          ]),
        ),
      ),
    ]);
  }

  private renderCourse(course: CourseDefinition): HTMLElement {
    const name = element('input', { className: 'input course-maker-name' });
    name.value = course.name;
    name.maxLength = 64;
    name.setAttribute('aria-label', playerText().course.courseName);
    isolateKeys(name);
    name.addEventListener('change', () => this.maker.renameCourse(course, name.value));
    const connections = madeCourseConnections(course);
    const stages = element(
      'ol',
      { className: 'course-maker-stages' },
      course.stages.map((stage, index) => {
        const item = element('li', { text: stage.title ?? stage.md5 ?? '' });
        const connection = connections[index];
        if (connection !== undefined) {
          item.append(
            connectionSelect(connection, (value) =>
              this.maker.stepConnection(course, index, connectionDelta(connection, value)),
            ),
          );
        }
        return item;
      }),
    );
    return element('section', { className: 'card course-maker-course gap-2 px-3' }, [
      element('div', { className: 'course-maker-course-head' }, [
        name,
        element('span', { className: 'course-maker-kind', text: KIND_LABELS[course.kind] }),
        button(playerText().course.delete, 'btn', () => this.confirmDelete(course), 'outline'),
      ]),
      stages,
      constraintEditor(course.kind, course.constraints, (constraints) =>
        this.maker.setCourseConstraints(course, constraints),
      ),
    ]);
  }
}
