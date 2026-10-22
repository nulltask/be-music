import type { CourseView, PlayOptions, PlayState } from '@be-music/player-scene-model';
import type { LibraryEntry, LibraryChart } from './chart.ts';
import type { BeMusicResultData } from './result-data.ts';
import type { BeMusicSkinSettingValues } from './settings.ts';
import type {
  BeMusicEffectLevel,
  BeMusicGameplayFrame,
  BeMusicGameplayLayout,
  BeMusicGameplayRuntime,
  BeMusicPlayOptionChoices,
} from './types.ts';

/** A native DOM screen. Mount once, update without replacing focused elements, dispose once. */
export interface BeMusicDOMScreen<Frame> {
  update(frame: Frame): void;
  dispose(): void;
  /** Select screens may expose their native search field to host search shortcuts. */
  focusSearch?(): void;
}

/** The host owns the mount element; the skin owns its children and event listeners. No Pixi object crosses here. */
export type BeMusicDOMFactory<Frame, Actions, Screen extends BeMusicDOMScreen<Frame> = BeMusicDOMScreen<Frame>> = (
  container: HTMLElement,
  actions: Actions,
) => Screen;

/**
 * A gameplay screen. For a skin that sets `gameplay.drawsOnDOM`, the host hands it every frame's playfield through
 * {@link drawPlayfield} instead of drawing the skin on a Canvas surface, and allocates no surface for gameplay.
 */
export interface BeMusicDOMGameplayScreen extends BeMusicDOMScreen<BeMusicDOMGameplayFrame> {
  /** Called once per frame, before the player renders, with the lanes, notes and hit effects collected for it. */
  drawPlayfield?(frame: BeMusicGameplayFrame): void;
}

export interface BeMusicDOMPresentation {
  readonly settings: BeMusicSkinSettingValues;
  readonly effects: BeMusicEffectLevel;
}

export interface BeMusicDOMSelectFrame extends BeMusicDOMPresentation {
  readonly revision: number;
  readonly entries: readonly LibraryEntry[];
  readonly selectedIndex: number;
  readonly folderLabel: string | undefined;
  readonly searchQuery: string;
  readonly playOptions: Readonly<PlayOptions>;
  readonly playOptionChoices: BeMusicPlayOptionChoices;
  readonly readText: string | undefined;
  readonly launching: boolean;
}

export interface BeMusicDOMSelectActions {
  focus(index: number): void;
  activate(): void;
  back(): void;
  search(query: string): void;
  play(autoPlay?: boolean): void;
  setPlayOption<K extends keyof PlayOptions>(key: K, value: PlayOptions[K]): void;
  readText(): void;
  gesture(): void;
}

/** Small HUD state: note arrays, textures and rendering caches stay with the Canvas renderer. */
export interface BeMusicDOMGameplayFrame extends BeMusicDOMPresentation {
  /** Design stage and lane bounds, for placing DOM controls clear of the playfield. */
  readonly layout: Pick<BeMusicGameplayLayout, 'stage' | 'orientation' | 'playfield'>;
  readonly chart: LibraryChart | undefined;
  readonly state: Readonly<PlayState>;
  /** The same resource-free HUD values available to Canvas skins. */
  readonly runtime: Readonly<BeMusicGameplayRuntime>;
  readonly playOptions: Readonly<PlayOptions>;
  readonly emptyPoor: number;
  readonly course?: CourseView;
  readonly seconds: number;
  readonly bpm: number | undefined;
  readonly progress: number | undefined;
  readonly stage: 'loading' | 'intro' | 'playing' | 'paused' | 'ending';
  readonly autoPlay: boolean;
  readonly replay: boolean;
}

export interface BeMusicDOMGameplayActions {
  pause(): void;
  restart(): void;
  quit(): void;
}

export interface BeMusicDOMResultFrame extends BeMusicDOMPresentation {
  readonly result: BeMusicResultData;
  readonly inputReady: boolean;
}

export interface BeMusicDOMResultActions {
  continue(): void;
  retry(): void;
}

export interface BeMusicDOMDecideFrame extends BeMusicDOMPresentation {
  readonly chart: LibraryChart;
  readonly progress: number | undefined;
  readonly inputReady: boolean;
}

export interface BeMusicDOMDecideActions {
  continue(): void;
  cancel(): void;
}

/**
 * DOM replaces select/decide/result drawing when provided. Gameplay DOM accompanies the Canvas playfield, or replaces
 * it for a skin that sets `gameplay.drawsOnDOM`.
 */
export interface BeMusicDOMSkin {
  readonly select?: BeMusicDOMFactory<BeMusicDOMSelectFrame, BeMusicDOMSelectActions>;
  readonly decide?: BeMusicDOMFactory<BeMusicDOMDecideFrame, BeMusicDOMDecideActions>;
  readonly result?: BeMusicDOMFactory<BeMusicDOMResultFrame, BeMusicDOMResultActions>;
  readonly gameplay?: BeMusicDOMFactory<BeMusicDOMGameplayFrame, BeMusicDOMGameplayActions, BeMusicDOMGameplayScreen>;
}
