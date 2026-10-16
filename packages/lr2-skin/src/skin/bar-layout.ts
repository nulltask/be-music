import type { ParseContext } from './parse-context.ts';
import type {
  Lr2BarBodySlot,
  Lr2BarBodySource,
  Lr2BarFlashElement,
  Lr2BarLampSource,
  Lr2BarLayout,
  Lr2BarLevelSource,
  Lr2BarRankSource,
  Lr2BarRivalSource,
  Lr2BarTitleElement,
  Lr2NumberSourceRect,
} from './types.ts';

export function createBarLayout(context: ParseContext): Lr2BarLayout {
  const bodies: Lr2BarBodySource[] = context.barBodySources.flatMap((entry) => {
    const imagePath = context.imagePaths[entry.source.gr];
    if (!imagePath) {
      return [];
    }
    return [{ kind: entry.kind, source: { ...entry.source, imagePath } }];
  });

  const slotCount = Math.max(context.barBodyOffDstGroups.length, context.barBodyOnDstGroups.length);
  const slots: Lr2BarBodySlot[] = [];
  for (let index = 0; index < slotCount; index += 1) {
    const offGroup = context.barBodyOffDstGroups[index];
    const onGroup = context.barBodyOnDstGroups[index];
    if ((!offGroup || offGroup.length === 0) && (!onGroup || onGroup.length === 0)) {
      continue;
    }
    slots.push({
      index,
      off: offGroup && offGroup.length > 0 ? offGroup[offGroup.length - 1] : undefined,
      offKeyframes: offGroup ? [...offGroup] : [],
      on: onGroup && onGroup.length > 0 ? onGroup[onGroup.length - 1] : undefined,
      onKeyframes: onGroup ? [...onGroup] : [],
    });
  }

  let title: Lr2BarTitleElement | undefined;
  if (context.barTitleSource && context.barTitleDst.length > 0) {
    const dstGroup = context.barTitleDst;
    title = {
      font: context.barTitleSource.font,
      destination: dstGroup[dstGroup.length - 1]!,
      keyframes: [...dstGroup],
    };
  }

  // BAR_LEVEL: keep the alignment / padding from each per-difficulty entry so the renderer can use
  // `renderNumberElement` directly.
  const levels: Lr2BarLevelSource[] = context.barLevelSources.flatMap((entry) => {
    const imagePath = context.imagePaths[entry.source.gr];
    if (!imagePath) {
      return [];
    }
    const numberSource: Lr2NumberSourceRect = {
      ...entry.source,
      imagePath,
      num: 0, // unused — BAR_LEVEL pulls its value from the song, not the LR2 num field
      alignment: entry.alignment,
      padding: entry.padding,
    };
    return [{ kind: entry.kind, source: numberSource }];
  });

  const lamps: Lr2BarLampSource[] = context.barLampSources.flatMap((entry) => {
    const imagePath = context.imagePaths[entry.source.gr];
    if (!imagePath) {
      return [];
    }
    return [{ kind: entry.kind, source: { ...entry.source, imagePath } }];
  });

  const ranks: Lr2BarRankSource[] = context.barRankSources.flatMap((entry) => {
    const imagePath = context.imagePaths[entry.source.gr];
    if (!imagePath) {
      return [];
    }
    return [{ kind: entry.kind, source: { ...entry.source, imagePath } }];
  });

  const levelDestination = context.barLevelDst.at(-1);
  const lampDestination = context.barLampDst.at(-1);
  const rankDestination = context.barRankDst.at(-1);

  // BAR_FLASH — focused-bar overlay. Spec only allows one, so we pick the latest source / DST chain and resolve its
  // image path.
  let flash: Lr2BarFlashElement | undefined;
  if (context.barFlashSource && context.barFlashDst.length > 0) {
    const imagePath = context.imagePaths[context.barFlashSource.gr];
    if (imagePath) {
      const dstGroup = context.barFlashDst;
      flash = {
        source: { ...context.barFlashSource, imagePath },
        destination: dstGroup[dstGroup.length - 1]!,
        keyframes: [...dstGroup],
      };
    }
  }

  // BAR_RIVAL — rival-mode WIN/LOSE/DRAW per-bar overlay.
  const rivalIndicators: Lr2BarRivalSource[] = context.barRivalSources.flatMap((entry) => {
    const imagePath = context.imagePaths[entry.source.gr];
    if (!imagePath) {
      return [];
    }
    return [{ kind: entry.kind, source: { ...entry.source, imagePath } }];
  });
  const rivalDestination = context.barRivalDst.at(-1);

  // BAR_MY_LAMP / BAR_RIVAL_LAMP — rival-folder lamp variants.
  const myLamps: Lr2BarLampSource[] = context.barMyLampSources.flatMap((entry) => {
    const imagePath = context.imagePaths[entry.source.gr];
    if (!imagePath) return [];
    return [{ kind: entry.kind, source: { ...entry.source, imagePath } }];
  });
  const rivalLampSprites: Lr2BarLampSource[] = context.barRivalLampSources.flatMap((entry) => {
    const imagePath = context.imagePaths[entry.source.gr];
    if (!imagePath) return [];
    return [{ kind: entry.kind, source: { ...entry.source, imagePath } }];
  });

  return {
    bodies,
    slots,
    center: context.barCenter,
    available: context.barAvailable,
    title,
    levels,
    levelDestination,
    levelKeyframes: [...context.barLevelDst],
    lamps,
    lampDestination,
    lampKeyframes: [...context.barLampDst],
    ranks,
    rankDestination,
    rankKeyframes: [...context.barRankDst],
    flash,
    rivalIndicators,
    rivalDestination,
    rivalKeyframes: [...context.barRivalDst],
    rivalLamps: {
      myLamps,
      myLampDestination: context.barMyLampDst.at(-1),
      myLampKeyframes: [...context.barMyLampDst],
      rivalLamps: rivalLampSprites,
      rivalLampDestination: context.barRivalLampDst.at(-1),
      rivalLampKeyframes: [...context.barRivalLampDst],
    },
    declarationOrder: context.barLayoutDeclarationOrder,
  };
}
