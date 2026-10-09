/**
 * `@be-music/player-web/skin-sdk` — everything a be-music skin is written against. The built-in skins (Phantom,
 * Synesthesia, Lattice) import nothing else from the player, so a third-party skin can do whatever they do.
 *
 * - Declaring a skin: {@link defineBeMusicSkin}, {@link BE_MUSIC_SKIN_API_VERSION}, and the `BeMusicSkin` types.
 * - Stage and layout: {@link wideStage} (the 16:9 stage the built-ins use) and the `BeMusicGameplayLayout` each chrome
 *   frame receives, plus {@link resolveMilestoneArea} for placing cut-ins clear of the lanes.
 * - Drawing: pooled HUD text (`addHudText` / `addHudNumber`), skin text and hit areas (`addSkinText`, `addHitArea`),
 *   cap-height alignment, GPU point particles (`pointLayerFor`), and key-beam gradients.
 * - Play state: judgement words (`judgeDisplayWord`, the flashing GREAT of a PERFECT), moments (combo milestones, the
 *   clear line, full combo, count-in progress), effect levels, input impulses, and the loading caption.
 * - Sound: `audioDrive` turns the frame's audio analysis into ready-to-use drive values.
 * - Song facts: select-row facts (`resolveSongRowFacts`), result lamp and track rows.
 * - Motion: easing, staged timelines, roll-up counters, and a deterministic hash for jitter.
 *
 * Skins draw with Pixi (`pixi.js` is a peer dependency of the player).
 */
export type * from '../skin/be-music/types.ts';
export type { BrowserBrowseEntry, BrowserFolderNode, BrowserSongEntry } from '../collection/types.ts';
export type { PixiGameplayResultData } from '../scene/core/result-data.ts';
export type {
  SkinlessGameplayChromeRenderContext,
  SkinlessGameplayChromeRuntime,
  SkinlessGameplayJudgeState,
} from '../scene/gameplay-chrome.ts';
export { ChildPool } from '../scene/pixi-utils.ts';

export * from './define.ts';
export * from './stage.ts';
export * from './layout.ts';
export * from './fonts.ts';
export * from './motion.ts';
export * from './tabular.ts';
export * from './hud-text.ts';
export * from './skin-text.ts';
export * from './text-metrics.ts';
export * from './particle-layer.ts';
export * from './key-beam.ts';
export * from './judge-word.ts';
export * from './moments.ts';
export * from './loading.ts';
export * from './audio-drive.ts';
export * from './song-stats.ts';
export * from './result-track.ts';
export * from './canvas-skin.ts';
