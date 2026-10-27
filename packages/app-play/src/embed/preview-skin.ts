import {
  BE_MUSIC_SKIN_API_VERSION,
  STAGE_HEIGHT,
  STAGE_WIDTH,
  TALL_STAGE_HEIGHT,
  TALL_STAGE_WIDTH,
  defineBeMusicSkin,
  type BeMusicDOMGameplayActions,
  type BeMusicDOMGameplayFrame,
  type BeMusicDOMGameplayScreen,
  type BeMusicRect,
  type BeMusicSkin,
  type BeMusicStage,
  type BeMusicSurface,
} from '@be-music/player-skin-sdk';
import {
  defineBeMusicElements,
  paintPlayfieldParts,
  PREVIEW_GUTTER,
  resolvePreviewBGARect as resolvePreviewBGARectOnStage,
  resolvePreviewPortrait,
  resolvePlayfieldParts,
  type BeMusicUIEvent,
} from '@be-music/player-ui';
import { basecoatTheme } from '@be-music/player-ui/themes/basecoat';
import { ControlsIdleController } from './controls-idle.ts';

/** The controls bar along the bottom of the stage takes this much below the judge line. */
const CONTROLS_BELOW_JUDGEMENT = 60;
/** Between HUD redraws (12 a second); a stage, view or seekability change redraws at once. */
const HUD_INTERVAL_MS = 80;

/** The volume, mute and full-screen state of the page around the preview, which its controls show and change. */
export interface PreviewChromeState {
  readonly volume: number;
  readonly muted: boolean;
  readonly fullscreen: boolean;
}

export interface PreviewChrome {
  state(): PreviewChromeState;
  /** Calls `listener` whenever the state changes; returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
  setVolume(volume: number, muted: boolean): void;
  toggleFullscreen(): void;
}

/**
 * The BGA square on a landscape stage of `size`: as large as fits right of the lanes and above the video controls
 * (`resolvePreviewBGARect`).
 */
export function resolvePreviewBGARect(
  playfieldRight: number,
  size: { width: number; height: number } = { width: STAGE_WIDTH, height: STAGE_HEIGHT },
): BeMusicRect {
  return resolvePreviewBGARectOnStage(size, playfieldRight);
}

/**
 * The preview's stage at `size`. It is fluid ({@link BeMusicStage.resize}): the player resizes it to the window, so the
 * preview fills any aspect ratio. Landscape keeps the lanes in the left half and the BGA and the play's facts on the
 * right; a tall stage puts the BGA square across the top and the lanes in the band under it.
 */
export function createPreviewStage(size: { width: number; height: number }): BeMusicStage {
  const { width, height } = size;
  const portrait = resolvePreviewPortrait(size);
  if (portrait) {
    const playfield = { top: portrait.laneTop, judgementY: portrait.judgementY };
    return {
      width,
      height,
      playfield: { standard: playfield, touch: playfield },
      resolveBGARect: () => portrait.bga,
      resize: createPreviewStage,
    };
  }
  const playfield = { top: 0, judgementY: height - CONTROLS_BELOW_JUDGEMENT, maxRight: width / 2 - PREVIEW_GUTTER };
  return {
    width,
    height,
    playfield: { standard: playfield, touch: playfield },
    resolveBGARect: (playfieldRight) => resolvePreviewBGARect(playfieldRight, size),
    resize: createPreviewStage,
  };
}

/** The embed's be-music skin: a DOM playfield and preview HUD, no Canvas of its own. */
export function createPreviewSkin(chrome: PreviewChrome): BeMusicSkin {
  return defineBeMusicSkin({
    apiVersion: BE_MUSIC_SKIN_API_VERSION,
    id: 'preview',
    label: 'Preview',
    description:
      'The embed preview: lanes on the left and the BGA on the right, or the BGA above the lanes on a tall screen, and video controls.',
    version: '1.0.0',
    author: { name: 'be-music' },
    license: 'MIT',
    fontLoads: [],
    context: '2d',
    stage: createPreviewStage({ width: STAGE_WIDTH, height: STAGE_HEIGHT }),
    portraitStage: createPreviewStage({ width: TALL_STAGE_WIDTH, height: TALL_STAGE_HEIGHT }),
    gameplay: {
      draw: drawPlayfield,
      drawsOnDOM: true,
      drawsBGA: true,
      drawsMines: true,
      drawsLaneCover: true,
      drawsMeasureLines: true,
    },
    select: { layout: { listX: 0, listTop: 0, listBottomInset: 0, rowHeight: 40 }, draw: drawNothing },
    result: { draw: drawNothing },
    dom: { gameplay: (container, actions) => mountPreviewGameplay(container, actions, chrome) },
  });
}

/** The preview only plays; the select and result screens are the embed's own. */
function drawNothing(): void {}

/** The playfield on one surface, for hosts without DOM screens. */
function drawPlayfield(
  { context, width, height }: BeMusicSurface<'2d'>,
  frame: Parameters<BeMusicSkin['gameplay']['draw']>[1],
): void {
  context.fillStyle = '#171717';
  context.fillRect(0, 0, width, height);
  paintPlayfieldParts(context as CanvasRenderingContext2D, resolvePlayfieldParts(frame));
}

function mountPreviewGameplay(
  container: HTMLElement,
  actions: BeMusicDOMGameplayActions,
  chrome: PreviewChrome,
): BeMusicDOMGameplayScreen {
  const document = container.ownerDocument;
  const registry = document.defaultView?.customElements;
  if (!registry) throw new Error('The preview needs a window with Custom Elements support.');
  defineBeMusicElements(registry, { theme: basecoatTheme });
  const playfield = document.createElement('be-music-playfield');
  const hud = document.createElement('be-music-preview-hud');
  const showChrome = (): void => {
    const state = chrome.state();
    hud.volume = state.volume;
    hud.muted = state.muted;
    hud.fullscreen = state.fullscreen;
  };
  showChrome();
  const unsubscribe = chrome.subscribe(showChrome);
  const listeners: Record<string, EventListener> = {
    'pause-request': () => actions.pause(),
    'seek-request': (event) => actions.seek((event as BeMusicUIEvent<'seek-request'>).detail.seconds),
    'volume-change': (event) => {
      const { volume, muted } = (event as BeMusicUIEvent<'volume-change'>).detail;
      chrome.setVolume(volume, muted);
    },
    'fullscreen-request': () => chrome.toggleFullscreen(),
  };
  for (const [name, listener] of Object.entries(listeners)) hud.addEventListener(name, listener);
  container.append(playfield, hud);
  const idle = new ControlsIdleController(hud, document.defaultView!);
  let previous: BeMusicDOMGameplayFrame | undefined;
  let shownAtMs = -Infinity;
  return {
    update(frame) {
      idle.setPlaying(frame.stage === 'playing');
      const nowMs = performance.now();
      if (
        previous !== undefined &&
        previous.stage === frame.stage &&
        previous.seekable === frame.seekable &&
        previous.layout.stage === frame.layout.stage &&
        nowMs - shownAtMs < HUD_INTERVAL_MS
      )
        return;
      previous = frame;
      shownAtMs = nowMs;
      hud.frame = frame;
    },
    drawPlayfield(frame) {
      playfield.frame = frame;
    },
    dispose() {
      idle.dispose();
      unsubscribe();
      for (const [name, listener] of Object.entries(listeners)) hud.removeEventListener(name, listener);
      playfield.remove();
      hud.remove();
    },
  };
}
