import { basename } from '@be-music/shared-utils/core';
import { asLoadedBytes, readFilesIntoBytesMap } from './file-lookup.ts';
import type { LR2SkinFileEntry, LR2SkinInputFile } from './file-lookup.ts';
import {
  informationTypeToKind,
  informationTypeToPlayVariant,
  isSkinPathOfKind,
  peekLR2SkinInformationType,
  scoreSkinPath,
  type LR2PlayVariant,
  type LR2SkinKind,
} from './paths.ts';
import { LR2_SPECIAL_GRAPHIC, type LR2SpecialGraphic } from './special-graphic.ts';
import { LR2_GR } from './ids/graphics.ts';
import { LR2_OP } from './ids/ops.ts';
import { createBarLayout } from './skin/bar-layout.ts';
import { autoDetectCanvasFromObservedCoordinates } from './skin/canvas.ts';
import {
  createBarGraphElements,
  createBGAElements,
  createButtonElements,
  createGaugeChartElements,
  createGrooveGaugeElements,
  createJudge2PElements,
  createJudgeElements,
  createJudgeLineElements,
  createMeasureLineElements,
  createMouseCursorElements,
  createNowComboElements,
  createNumberElements,
  createOnMouseElements,
  createReadmeElements,
  createScoreChartElements,
  createSliderElements,
  createTextElements,
} from './skin/elements.ts';
import type { ParseContext } from './skin/parse-context.ts';
import { readLR2Path } from './skin/read.ts';
import type { LR2Skin, LR2SkinResources } from './skin/types.ts';

export { resolveLR2AssetBytes } from './assets.ts';
export { LR2_SPECIAL_GRAPHIC, isLR2SpecialGraphic } from './special-graphic.ts';
export type { LR2SpecialGraphic } from './special-graphic.ts';
export type { LR2PlayVariant, LR2SkinKind } from './paths.ts';
export { autoDetectCanvasFromObservedCoordinates } from './skin/canvas.ts';
export type * from './skin/types.ts';

export interface LoadLR2SkinOptions {
  /** Which kind of skin to load. Defaults to `'play'`. */
  kind?: LR2SkinKind;
  /** Resource slots from the previous scene, for #IMAGE / #LR2FONT CONTINUE. */
  resources?: LR2SkinResources;
  /**
   * For `kind: 'play'` only — biases the candidate scoring toward `play_<variant>.lr2skin`. Falls back to the default
   * scoring (7K-preferred) if no file matches the requested variant.
   */
  playVariant?: LR2PlayVariant;
  /**
   * Ops to hold true while the skin's `#IF` / `#ELSEIF` chains are evaluated, on top of the parse-time defaults. LR2
   * reads a skin each time its scene starts, so a scene state that never changes during the scene (a course stage's
   * ops 280-293, say) can gate whole `#IF` blocks; pass them here to parse the skin as LR2 would for that state.
   */
  parseOps?: Iterable<number>;
}

export async function loadLR2SkinFromFiles(
  files: Iterable<LR2SkinInputFile>,
  options: LoadLR2SkinOptions = {},
): Promise<LR2Skin | undefined> {
  // Pooled parallel read instead of the textbook `for ... await arrayBuffer()` serial loop — the latter idles on disk
  // between every read on a large theme bundle. The dedicated theme loader already calls `loadLR2SkinFromSourceFiles`
  // directly with a pre-read map; this path remains for callers (and tests) that hand a file-like array over.
  const sourceFiles = await readFilesIntoBytesMap([...files]);
  return loadLR2SkinFromSourceFiles(sourceFiles, options);
}

export function loadLR2SkinFromSourceFiles(
  sourceFiles: ReadonlyMap<string, LR2SkinFileEntry>,
  options: LoadLR2SkinOptions = {},
): LR2Skin | undefined {
  const kind = options.kind ?? 'play';
  // Index every `.lr2skin` payload's `#INFORMATION,<type>,...` declaration once, up front. The type is the canonical
  // way an authored skin tells LR2 which scene it belongs to (play/select/decide/result/…); filename conventions
  // (`play_7.lr2skin` / `select.lr2skin` / …) are a secondary signal that not every theme follows — LITONE4 ships
  // `AC7.lr2skin` for type=0, etc. Building the map once lets the filter + scorer both consult it without re-decoding
  // SJIS bytes per candidate.
  const lr2SkinPaths = [...sourceFiles.keys()].filter((path) => path.toLowerCase().endsWith('.lr2skin'));
  const skinTypeByPath = new Map<string, number>();
  for (const path of lr2SkinPaths) {
    const type = peekLR2SkinInformationType(asLoadedBytes(sourceFiles.get(path)));
    if (type !== undefined) skinTypeByPath.set(path, type);
  }
  // Two-tier filter:
  //   1. The skin's declared `#INFORMATION` type matches the requested kind — strongest signal, used regardless of
  //      filename. Themes like LITONE4 land here.
  //   2. Filename / folder heuristic via {@link isSkinPathOfKind}. Used as a fallback for skins that omit
  //      `#INFORMATION` entirely (rare in practice) and as the universal path for the LR2 default theme (whose play
  //      skins also pass the heuristic on top of their declared type).
  // We unify both into a single Set so a skin that satisfies BOTH only counts once.
  const filtered = lr2SkinPaths.filter((path) => {
    const declaredType = skinTypeByPath.get(path);
    if (declaredType !== undefined && informationTypeToKind(declaredType) === kind) return true;
    // If a type was successfully parsed but it doesn't match the requested kind, the skin is definitively the wrong
    // scene — drop it rather than letting the filename heuristic accidentally re-include it (e.g. a `Play/`-folder
    // file that's actually a course-result skin).
    if (declaredType !== undefined) return false;
    return isSkinPathOfKind(path, kind);
  });
  // Falling back to ANY `.lr2skin` is only safe for `play`: a single-skin bundle is most often a play skin (the
  // gameplay scene has been the only consumer for most of this loader's lifetime). For `select` and `result` we'd
  // otherwise pick up `play_7.lr2skin` and parse it as a select / result skin — every DST element gates on
  // play-specific ops and timers, so the resulting "skin" renders as a blank canvas. Cleaner to return `undefined` and
  // let the caller fall through to its built-in panel than silently feed the wrong CSV through the parser.
  const candidates = filtered.length > 0 ? filtered : kind === 'play' ? lr2SkinPaths : [];
  const variant = kind === 'play' ? options.playVariant : undefined;
  const entryPath =
    candidates
      .slice()
      .sort(
        (left, right) =>
          scoreSkinPath(left, kind, { variant, type: skinTypeByPath.get(left) }) -
            scoreSkinPath(right, kind, { variant, type: skinTypeByPath.get(right) }) || left.localeCompare(right, 'ja'),
      )[0] ??
    // Last-resort `.csv` lookup mirrors the play-only "single-CSV bundle" behavior. Skipped for non-play kinds for the
    // same reason as above.
    (kind === 'play' ? [...sourceFiles.keys()].find((path) => path.toLowerCase().endsWith('.csv')) : undefined);
  if (!entryPath) {
    return undefined;
  }

  const context: ParseContext = {
    imagePaths: [],
    lr2FontPaths: [],
    systemFontSizes: [],
    imageSources: [],
    imageDstGroups: [],
    noteSources: new Map(),
    nowJudge1PSources: [],
    nowJudge1PDstGroups: [],
    nowJudge2PSources: [],
    nowJudge2PDstGroups: [],
    numberSources: [],
    numberDstGroups: [],
    grooveGaugeSources: [],
    grooveGaugeDstGroups: [],
    nowComboSources: [],
    nowComboDstGroups: [],
    judgeLineSources: [],
    judgeLineDstGroups: [],
    measureLineSources: [],
    measureLineDstGroups: [],
    bgaSources: [],
    bgaDstGroups: [],
    textSources: [],
    textDstGroups: [],
    bargraphSources: [],
    bargraphDstGroups: [],
    sliderSources: [],
    sliderDstGroups: [],
    gaugeChartSources: [],
    gaugeChartDstGroups: [],
    scoreChartSources: [],
    scoreChartDstGroups: [],
    buttonSources: [],
    buttonDstGroups: [],
    onMouseSources: [],
    onMouseDstGroups: [],
    readmeSources: [],
    readmeDstGroups: [],
    mouseCursorSources: [],
    mouseCursorDstGroups: [],
    barFlashDst: [],
    barRivalSources: [],
    barRivalDst: [],
    barMyLampSources: [],
    barMyLampDst: [],
    barRivalLampSources: [],
    barRivalLampDst: [],
    barBodySources: [],
    barBodyOffDstGroups: [],
    barBodyOnDstGroups: [],
    barCenter: 0,
    barAvailable: 0,
    barTitleDst: [],
    barLevelSources: [],
    barLevelDst: [],
    barLampSources: [],
    barLampDst: [],
    barRankSources: [],
    barRankDst: [],
    laneRects: [],
    customOptions: [],
    customFiles: [],
    customFileLookup: new Map(),
    trueOps: new Set([
      ...defaultParseOps(informationTypeToPlayVariant(skinTypeByPath.get(entryPath) ?? -1) ?? variant),
      ...(options.parseOps ?? []),
    ]),
    timing: {},
    scratchFlip: {
      flipSide: false,
      flipResult: false,
      disableFlip: false,
      reloadBanner: false,
    },
    name: basename(entryPath),
    width: 640,
    height: 480,
    explicitResolution: false,
    observedDstCorners: [],
    nextDeclarationOrder: 0,
  };
  readLR2Path(sourceFiles, entryPath, context, new Set());
  // CONTINUE keeps the previous scene's resource at the same slot; it is never a filename.
  for (const [paths, inherited] of [
    [context.imagePaths, options.resources?.images],
    [context.lr2FontPaths, options.resources?.fonts],
  ] as const) {
    const declared = paths.length;
    for (let index = 0; index < Math.max(declared, inherited?.length ?? 0); index += 1) {
      if (index >= declared || paths[index]?.toUpperCase() === 'CONTINUE') paths[index] = inherited?.[index] ?? '';
    }
  }
  // Auto-detect the design canvas when the skin omits `#RESOLUTION`. LITONE4 (and many other 1280×720 / 1920×1080
  // era LR2 themes) ship the directive empty, leaving the design space at the legacy 640×480 default — at which
  // point every DST coordinate overflows and the chrome appears clipped. The detector ignores aspect-ratio nuance
  // and just snaps to the smallest standard canvas (640×480, 1280×720, 1920×1080, 2560×1440) that contains the
  // 90 % percentile of observed DST corner coordinates. See {@link autoDetectCanvasFromObservedCoordinates}.
  if (!context.explicitResolution && context.observedDstCorners.length > 0) {
    const detected = autoDetectCanvasFromObservedCoordinates(context.observedDstCorners);
    if (detected !== undefined) {
      context.width = detected.width;
      context.height = detected.height;
    }
  }

  return {
    name: context.name,
    resources: { images: [...context.imagePaths], fonts: [...context.lr2FontPaths] },
    width: context.width,
    height: context.height,
    images: context.imageSources.flatMap((source, index) => {
      const dstGroup = context.imageDstGroups[index];
      if (!dstGroup || dstGroup.length === 0) {
        return [];
      }
      // LR2 reserves a few special gr indices for textures that are resolved at runtime instead of from `#IMAGE`
      // declarations: 100 = STAGEFILE, 101 = BACKBMP, 102 = BANNER, 105 = skin-select thumbnail, 110 = solid black, 111
      // = solid white. We mark them with a sentinel path so the renderer can swap in the appropriate texture (per-song
      // banner, generated 1-dot, etc.) without needing to pre-register them in the `#IMAGE` table.
      const specialPath = specialGraphicPath(source.gr);
      const imagePath = specialPath ?? context.imagePaths[source.gr];
      if (!imagePath) {
        return [];
      }
      // LR2: a sequence of consecutive `#DST_IMAGE` lines after one `#SRC_IMAGE` defines an animation. We expose every
      // keyframe so the renderer can interpolate; the `destination` field is the final (latest-`time`) keyframe, used
      // for visibility checks and as the fallback for static elements.
      const destination = dstGroup[dstGroup.length - 1]!;
      return [
        {
          source: { ...source, imagePath },
          destination,
          keyframes: [...dstGroup],
          declarationOrder: source.declarationOrder,
        },
      ];
    }),
    laneRects: context.laneRects,
    notes: Object.fromEntries(
      [...context.noteSources.entries()].map(([kind, sources]) => [
        kind,
        sources.map((source) => ({
          ...source,
          imagePath: context.imagePaths[source.gr] ?? '',
        })),
      ]),
    ) as LR2Skin['notes'],
    judges: createJudgeElements(context),
    judges2P: createJudge2PElements(context),
    numbers: createNumberElements(context),
    grooveGauges: createGrooveGaugeElements(context),
    nowCombos: createNowComboElements(context),
    judgeLines: createJudgeLineElements(context),
    measureLines: createMeasureLineElements(context),
    bgas: createBGAElements(context),
    texts: createTextElements(context),
    bargraphs: createBarGraphElements(context),
    sliders: createSliderElements(context),
    gaugeCharts: createGaugeChartElements(context),
    scoreCharts: createScoreChartElements(context),
    buttons: createButtonElements(context),
    onMouseElements: createOnMouseElements(context),
    readmes: createReadmeElements(context),
    mouseCursors: createMouseCursorElements(context),
    timing: { ...context.timing },
    scratchFlip: { ...context.scratchFlip },
    barLayout: createBarLayout(context),
    customOptions: context.customOptions,
    customFiles: context.customFiles,
    lr2FontPaths: context.lr2FontPaths,
    systemFontSizes: context.systemFontSizes,
    transparentColor: context.transparentColor,
    files: sourceFiles,
  };
}

function specialGraphicPath(gr: number): LR2SpecialGraphic | undefined {
  switch (gr) {
    case LR2_GR.STAGEFILE:
      return LR2_SPECIAL_GRAPHIC.STAGEFILE;
    case LR2_GR.BACKBMP:
      return LR2_SPECIAL_GRAPHIC.BACKBMP;
    case LR2_GR.BANNER:
      return LR2_SPECIAL_GRAPHIC.BANNER;
    case LR2_GR.SKIN_THUMBNAIL:
      return LR2_SPECIAL_GRAPHIC.SKIN_THUMBNAIL;
    case LR2_GR.BLACK:
      return LR2_SPECIAL_GRAPHIC.BLACK;
    case LR2_GR.WHITE:
      return LR2_SPECIAL_GRAPHIC.WHITE;
    default:
      return undefined;
  }
}

/**
 * Static ops that are conventionally true at parse time so that `#IF` / `#ELSEIF` chains in the LR2 default skins
 * resolve to a sensible default branch. The runtime renderer overrides specific values (key mode, autoplay, etc.) at
 * play time, but they need to be true HERE so the parser doesn't silently drop entire `#INCLUDE` chains gated on them.
 *
 * Includes the selected skin's key mode and autoplay-off, so their #IF blocks survive parsing before runtime state
 * is available.
 */
function defaultParseOps(variant: LR2PlayVariant = '7'): Set<number> {
  return new Set<number>([
    LR2_OP.PLAYABLE_BAR,
    LR2_OP.AUTOPLAY_OFF,
    // Result-screen clear / fail flags. These are runtime-resolved (the parser doesn't know whether the player
    // cleared), but the LR2 default `Result/result_normal.csv` gates `#IF,90` / `#IF,91` blocks around the **`#IMAGE`
    // declarations themselves** (parts.tga vs parts_fail.tga). Without both ops marked true at parse time, one of the
    // two atlases never reaches `skin.images` — and the runtime op gate downstream is moot because there's no DST/SRC
    // pointing at the missing texture. Setting both makes the parser load both atlases; runtime DST gating on op 90 vs
    // 91 then picks which one is drawn on a per-frame basis.
    LR2_OP.RESULT_CLEAR,
    LR2_OP.RESULT_FAIL,
    LR2_OP.GHOST_OFF,
    LR2_OP.SCORE_GRAPH_OFF,
    LR2_OP.BGA_OFF,
    LR2_OP.GAUGE_1P_NORMAL,
    LR2_OP.GAUGE_2P_NORMAL,
    LR2_OP.DIFFICULTY_FILTER_OFF,
    LR2_OP.OFFLINE,
    LR2_OP.AUTO_SCRATCH_1P_OFF,
    LR2_OP.AUTO_SCRATCH_2P_OFF,
    LR2_OP.SCORE_SAVE_ON,
    LR2_OP.LOADED,
    LR2_OP.REPLAY_OFF,
    // Includes can be gated by the skin's key mode (WMIX has distinct SP and DP layouts).
    LR2_OP[`KEYS_${variant === '7-battle' ? '7' : variant === '5-battle' ? '5' : variant}`],
    LR2_OP.NO_BGA,
    LR2_OP.NO_LN,
    LR2_OP.NO_TEXT,
    LR2_OP.NO_BPM_CHANGE,
    LR2_OP.NO_RANDOM,
    LR2_OP.JUDGE_NORMAL,
    // Skins typically gate the STAGEFILE / BANNER / BACKBMP display block on the "present" op (191 / 193 / 195), so we
    // mark those true at parse time even though the chart-level state is unknown until runtime. Without them the
    // load-screen branch never gets included by `#IF`, so the runtime renderer wouldn't have the SRC/DST entries to
    // draw at all.
    LR2_OP.HAS_STAGEFILE,
    LR2_OP.HAS_BANNER,
    LR2_OP.HAS_BACKBMP,
    LR2_OP.NO_REPLAY,
  ]);
}
