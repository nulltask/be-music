/**
 * `@be-music/player-web/skin-sdk` — everything a be-music skin is written against, and nothing that draws. A skin gets
 * a canvas and plain frame data from the player and renders with whatever it brings: the Canvas 2D API, raw WebGL /
 * WebGPU, or a framework such as PixiJS or three.js. The SDK itself imports no rendering framework.
 *
 * - Declaring a skin: {@link defineBeMusicSkin}, {@link BE_MUSIC_SKIN_API_VERSION}, and the `BeMusicSkin` types.
 * - Stage and layout: {@link wideStage} (the 16:9 stage the built-ins use), the `BeMusicGameplayLayout` each gameplay
 *   frame carries, {@link resolveLaneRuns}, and {@link resolveMilestoneArea} for placing cut-ins clear of the lanes.
 * - Play state: judgement words (`judgeDisplayWord`, the flashing GREAT of a PERFECT), moments (combo milestones, the
 *   clear line, full combo, count-in progress), effect levels, input impulses, and the loading caption.
 * - Sound: `audioDrive` turns the frame's audio analysis into ready-to-use drive values.
 * - Song facts: select-row facts (`resolveSongRowFacts`), result lamp and track rows.
 * - Text and motion: tabular figure layout, the default text face, easing, staged timelines, roll-up counters, and a
 *   deterministic hash for jitter.
 */
export type * from './types.ts';
export type * from './song.ts';
export type * from './result-data.ts';

export * from './audio.ts';
export * from './playfield.ts';
export * from './lane-geometry.ts';

export * from './define.ts';
export * from './stage.ts';
export * from './layout.ts';
export * from './fonts.ts';
export * from './motion.ts';
export * from './tabular.ts';
export * from './judge-word.ts';
export * from './moments.ts';
export * from './loading.ts';
export * from './audio-drive.ts';
export * from './song-stats.ts';
export * from './result-track.ts';
