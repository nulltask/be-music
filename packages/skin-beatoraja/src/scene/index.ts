/**
 * `@be-music/skin-beatoraja/scene` — maps the family-neutral scene models (`@be-music/player-scene-model`) to a beatoraja
 * skin's vocabulary: which ops are lit, what each number and text reads, which timers start and stop, the gauge, the
 * graphs and the live offsets, for the play, select, decide and result screens, a running course, and the theme's
 * system sounds. Pure and deterministic: time, the clock and the frame rate come in as inputs, and no function reads a
 * clock or keeps state between calls (a few keep a cache keyed by the input they were given).
 *
 * - Play: {@link resolveBeatorajaPlayNumber}, {@link resolveBeatorajaPlayText}, {@link resolveBeatorajaPlayStartOps},
 *   {@link resolveBeatorajaPlayScoreOps}, {@link resolveBeatorajaCoverOps}, the timers as data
 *   ({@link resolveBeatorajaJudgeEffect}, {@link resolveBeatorajaLaneTimers}, {@link resolveBeatorajaFrameTimers}),
 *   the gauge ({@link resolveBeatorajaGaugeState}), the graphs and sliders, and the live offsets
 *   ({@link writeBeatorajaPlayOffset}).
 * - Decide: {@link resolveBeatorajaDecideNumber}, {@link resolveBeatorajaDecideOps} and
 *   {@link resolveBeatorajaDecideGraphValue}, from the chart about to be played and the play's loading progress.
 * - Result: {@link resolveBeatorajaResultNumber}, {@link resolveBeatorajaResultOps}, {@link resolveBeatorajaResultText}
 *   and its graphs, from a `PlayResult`.
 * - Select: {@link resolveBeatorajaSelectBarOps}, {@link resolveBeatorajaSelectNumber},
 *   {@link resolveBeatorajaSelectText}, {@link resolveBeatorajaSelectRefValue}, from the focused library entry.
 * - Course: the course bar, stage and text ids from a `CourseView` / `LibraryCourse`.
 * - System sounds: the cue, select BGM and jingle files of a theme.
 */
export * from './inputs.ts';
export * from './score.ts';
export * from './chart-text.ts';
export * from './play-numbers.ts';
export * from './play-ops.ts';
export * from './play-text.ts';
export * from './play-timers.ts';
export * from './play-graphs.ts';
export * from './decide.ts';
export * from './result.ts';
export * from './select.ts';
export * from './course.ts';
export * from './clear-lamp.ts';
export * from './system-sounds.ts';
export * from './option-buttons.ts';
export * from './option-index.ts';
export * from './animation-timers.ts';
