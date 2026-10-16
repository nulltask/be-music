import type { ParseContext, SourceRect } from './parse-context.ts';
import type {
  Lr2BarGraphElement,
  Lr2BgaElement,
  Lr2ButtonElement,
  Lr2DestinationRect,
  Lr2GaugeChartElement,
  Lr2GrooveGaugeElement,
  Lr2JudgeLineElement,
  Lr2MeasureLineElement,
  Lr2MouseCursorElement,
  Lr2NowComboElement,
  Lr2NumberElement,
  Lr2OnMouseElement,
  Lr2ReadmeElement,
  Lr2ScoreChartElement,
  Lr2Skin,
  Lr2SliderElement,
  Lr2TextElement,
} from './types.ts';

// LR2 NOWJUDGE_1P index mapping (per the LR2skin spec): 0 = early POOR (empty-press / kara-poor), 1 = POOR
// (miss / minogashi-poor), 2 = BAD, 3 = GOOD, 4 = GREAT, 5 = PERFECT (= JUST GREAT). Both POOR variants render
// with the same kind.
const NOW_JUDGE_1P_KIND_BY_INDEX: ReadonlyMap<number, keyof Lr2Skin['judges']> = new Map([
  [0, 'poor'],
  [1, 'poor'],
  [2, 'bad'],
  [3, 'good'],
  [4, 'great'],
  [5, 'perfect'],
]);
// LR2 NOWCOMBO_1P index mapping. BAD or worse breaks the combo, so only GOOD/GREAT/PERFECT have meaningful entries.
const NOW_COMBO_1P_KIND_BY_INDEX: ReadonlyMap<number, 'good' | 'great' | 'perfect'> = new Map([
  [3, 'good'],
  [4, 'great'],
  [5, 'perfect'],
]);

export function createNumberElements(context: ParseContext): Lr2NumberElement[] {
  const elements: Lr2NumberElement[] = [];
  for (let index = 0; index < context.numberSources.length; index += 1) {
    const entry = context.numberSources[index]!;
    const dstGroup = context.numberDstGroups[index];
    if (!dstGroup || dstGroup.length === 0) {
      continue;
    }
    const imagePath = context.imagePaths[entry.source.gr];
    if (!imagePath) {
      continue;
    }
    const destination = dstGroup[dstGroup.length - 1]!;
    elements.push({
      source: {
        imagePath,
        x: entry.source.x,
        y: entry.source.y,
        w: entry.source.w,
        h: entry.source.h,
        divx: entry.source.divx,
        divy: entry.source.divy,
        cycle: entry.source.cycle,
        timer: entry.source.timer,
        num: entry.num,
        alignment: entry.alignment,
        padding: entry.padding,
      },
      destination,
      keyframes: [...dstGroup],
      declarationOrder: entry.source.declarationOrder,
    });
  }
  return elements;
}

export function createNowComboElements(context: ParseContext): Lr2NowComboElement[] {
  const elements: Lr2NowComboElement[] = [];
  for (let index = 0; index < context.nowComboSources.length; index += 1) {
    const entry = context.nowComboSources[index]!;
    const dstGroup = context.nowComboDstGroups[index];
    if (!dstGroup || dstGroup.length === 0) {
      continue;
    }
    const kind = NOW_COMBO_1P_KIND_BY_INDEX.get(entry.index);
    if (!kind) {
      continue;
    }
    const imagePath = context.imagePaths[entry.source.gr];
    if (!imagePath) {
      continue;
    }
    const destination = dstGroup[dstGroup.length - 1]!;
    elements.push({
      source: {
        imagePath,
        x: entry.source.x,
        y: entry.source.y,
        w: entry.source.w,
        h: entry.source.h,
        divx: entry.source.divx,
        divy: entry.source.divy,
        cycle: entry.source.cycle,
        timer: entry.source.timer,
        alignment: entry.alignment,
        padding: entry.padding,
      },
      destination,
      keyframes: [...dstGroup],
      kind,
      side: entry.side,
    });
  }
  return elements;
}

export function createJudgeLineElements(context: ParseContext): Lr2JudgeLineElement[] {
  const elements: Lr2JudgeLineElement[] = [];
  for (let index = 0; index < context.judgeLineSources.length; index += 1) {
    const entry = context.judgeLineSources[index]!;
    const dstGroup = context.judgeLineDstGroups[index];
    if (!dstGroup || dstGroup.length === 0) {
      continue;
    }
    const imagePath = context.imagePaths[entry.source.gr];
    if (!imagePath) {
      continue;
    }
    const destination = dstGroup[dstGroup.length - 1]!;
    elements.push({
      source: { ...entry.source, imagePath },
      destination,
      keyframes: [...dstGroup],
      index: entry.index,
    });
  }
  return elements;
}

export function createMeasureLineElements(context: ParseContext): Lr2MeasureLineElement[] {
  const elements: Lr2MeasureLineElement[] = [];
  for (let index = 0; index < context.measureLineSources.length; index += 1) {
    const entry = context.measureLineSources[index]!;
    const dstGroup = context.measureLineDstGroups[index];
    if (!dstGroup || dstGroup.length === 0) {
      continue;
    }
    const imagePath = context.imagePaths[entry.source.gr];
    if (!imagePath) {
      continue;
    }
    const destination = dstGroup[dstGroup.length - 1]!;
    elements.push({
      source: { ...entry.source, imagePath },
      destination,
      keyframes: [...dstGroup],
      index: entry.index,
    });
  }
  return elements;
}

export function createBgaElements(context: ParseContext): Lr2BgaElement[] {
  const elements: Lr2BgaElement[] = [];
  for (let index = 0; index < context.bgaSources.length; index += 1) {
    const entry = context.bgaSources[index]!;
    const dstGroup = context.bgaDstGroups[index];
    if (!dstGroup || dstGroup.length === 0) {
      continue;
    }
    const destination = dstGroup[dstGroup.length - 1]!;
    elements.push({
      destination,
      keyframes: [...dstGroup],
      noBase: entry.noBase,
      noLayer: entry.noLayer,
      noPoor: entry.noPoor,
    });
  }
  return elements;
}

export function createGrooveGaugeElements(context: ParseContext): Lr2GrooveGaugeElement[] {
  const elements: Lr2GrooveGaugeElement[] = [];
  for (let index = 0; index < context.grooveGaugeSources.length; index += 1) {
    const entry = context.grooveGaugeSources[index]!;
    const dstGroup = context.grooveGaugeDstGroups[index];
    if (!dstGroup || dstGroup.length === 0) {
      continue;
    }
    const imagePath = context.imagePaths[entry.source.gr];
    if (!imagePath) {
      continue;
    }
    const destination = dstGroup[dstGroup.length - 1]!;
    elements.push({
      source: { ...entry.source, imagePath },
      destination,
      keyframes: [...dstGroup],
      index: entry.index,
      addX: entry.addX,
      addY: entry.addY,
    });
  }
  return elements;
}

export function createTextElements(context: ParseContext): Lr2TextElement[] {
  const elements: Lr2TextElement[] = [];
  for (let index = 0; index < context.textSources.length; index += 1) {
    const entry = context.textSources[index]!;
    const dstGroup = context.textDstGroups[index];
    if (!dstGroup || dstGroup.length === 0) {
      continue;
    }
    const destination = dstGroup[dstGroup.length - 1]!;
    elements.push({
      font: entry.font,
      st: entry.st,
      alignment: entry.alignment,
      edit: entry.edit,
      panel: entry.panel,
      destination,
      keyframes: [...dstGroup],
      declarationOrder: entry.declarationOrder,
    });
  }
  return elements;
}

export function createBarGraphElements(context: ParseContext): Lr2BarGraphElement[] {
  const elements: Lr2BarGraphElement[] = [];
  for (let index = 0; index < context.bargraphSources.length; index += 1) {
    const entry = context.bargraphSources[index]!;
    const dstGroup = context.bargraphDstGroups[index];
    if (!dstGroup || dstGroup.length === 0) {
      continue;
    }
    const imagePath = context.imagePaths[entry.source.gr];
    if (!imagePath) {
      continue;
    }
    const destination = dstGroup[dstGroup.length - 1]!;
    elements.push({
      source: { ...entry.source, imagePath },
      destination,
      keyframes: [...dstGroup],
      type: entry.type,
      muki: entry.muki,
      declarationOrder: entry.source.declarationOrder,
    });
  }
  return elements;
}

/**
 * Finalizes `#SRC_GAUGECHART_*` / `#DST_*` pairs into the runtime-friendly element shape. Mirrors
 * `createSliderElements`' structure so the failure modes (unmatched DST, missing image) surface the same way: silently
 * drop the entry, no throw.
 *
 * `imagePath` resolution differs slightly from sliders: gauge-chart SRCs in real LR2 default skins use `gr = 0` (the
 * main atlas), but the **tint** drives the line color rather than the sampled pixel — even so we still pin a path for
 * `loadSkinAssetTexture` fallback consumers, falling back to the first declared `#IMAGE` when `gr` indexes outside the
 * table.
 */
export function createGaugeChartElements(context: ParseContext): Lr2GaugeChartElement[] {
  const elements: Lr2GaugeChartElement[] = [];
  for (let index = 0; index < context.gaugeChartSources.length; index += 1) {
    const entry = context.gaugeChartSources[index]!;
    const dstGroup = context.gaugeChartDstGroups[index];
    if (!dstGroup || dstGroup.length === 0) {
      continue;
    }
    const imagePath = context.imagePaths[entry.source.gr] ?? context.imagePaths[0] ?? '';
    const destination = dstGroup[dstGroup.length - 1]!;
    elements.push({
      source: {
        ...entry.source,
        imagePath,
        index: entry.index,
        fieldWidth: entry.fieldWidth,
        fieldHeight: entry.fieldHeight,
        start: entry.start,
        end: entry.end,
      },
      destination,
      keyframes: [...dstGroup],
      side: entry.side,
      declarationOrder: entry.source.declarationOrder,
    });
  }
  return elements;
}

export function createScoreChartElements(context: ParseContext): Lr2ScoreChartElement[] {
  const elements: Lr2ScoreChartElement[] = [];
  for (let index = 0; index < context.scoreChartSources.length; index += 1) {
    const entry = context.scoreChartSources[index]!;
    const dstGroup = context.scoreChartDstGroups[index];
    if (!dstGroup || dstGroup.length === 0) {
      continue;
    }
    const imagePath = context.imagePaths[entry.source.gr] ?? context.imagePaths[0] ?? '';
    const destination = dstGroup[dstGroup.length - 1]!;
    elements.push({
      source: {
        ...entry.source,
        imagePath,
        index: entry.index,
        fieldWidth: entry.fieldWidth,
        fieldHeight: entry.fieldHeight,
        start: entry.start,
        end: entry.end,
      },
      destination,
      keyframes: [...dstGroup],
      declarationOrder: entry.source.declarationOrder,
    });
  }
  return elements;
}

export function createSliderElements(context: ParseContext): Lr2SliderElement[] {
  const elements: Lr2SliderElement[] = [];
  for (let index = 0; index < context.sliderSources.length; index += 1) {
    const entry = context.sliderSources[index]!;
    const dstGroup = context.sliderDstGroups[index];
    if (!dstGroup || dstGroup.length === 0) {
      continue;
    }
    const imagePath = context.imagePaths[entry.source.gr];
    if (!imagePath) {
      continue;
    }
    const destination = dstGroup[dstGroup.length - 1]!;
    elements.push({
      source: { ...entry.source, imagePath },
      destination,
      keyframes: [...dstGroup],
      type: entry.type,
      muki: entry.muki,
      range: entry.range,
      declarationOrder: entry.source.declarationOrder,
    });
  }
  return elements;
}

export function createButtonElements(context: ParseContext): Lr2ButtonElement[] {
  const elements: Lr2ButtonElement[] = [];
  for (let index = 0; index < context.buttonSources.length; index += 1) {
    const entry = context.buttonSources[index]!;
    const dstGroup = context.buttonDstGroups[index];
    if (!dstGroup || dstGroup.length === 0) {
      continue;
    }
    const imagePath = context.imagePaths[entry.source.gr];
    if (!imagePath) {
      continue;
    }
    const destination = dstGroup[dstGroup.length - 1]!;
    elements.push({
      source: { ...entry.source, imagePath },
      destination,
      keyframes: [...dstGroup],
      type: entry.type,
      click: entry.click,
      panel: entry.panel,
      plusOnly: entry.plusOnly,
      declarationOrder: entry.source.declarationOrder,
    });
  }
  return elements;
}

export function createOnMouseElements(context: ParseContext): Lr2OnMouseElement[] {
  const elements: Lr2OnMouseElement[] = [];
  for (let index = 0; index < context.onMouseSources.length; index += 1) {
    const entry = context.onMouseSources[index]!;
    const dstGroup = context.onMouseDstGroups[index];
    if (!dstGroup || dstGroup.length === 0) {
      continue;
    }
    const imagePath = context.imagePaths[entry.source.gr];
    if (!imagePath) {
      continue;
    }
    const destination = dstGroup[dstGroup.length - 1]!;
    elements.push({
      source: { ...entry.source, imagePath },
      destination,
      keyframes: [...dstGroup],
      panel: entry.panel,
      hitOffsetX: entry.hitOffsetX,
      hitOffsetY: entry.hitOffsetY,
      hitWidth: entry.hitWidth,
      hitHeight: entry.hitHeight,
      declarationOrder: entry.source.declarationOrder,
    });
  }
  return elements;
}

export function createReadmeElements(context: ParseContext): Lr2ReadmeElement[] {
  const elements: Lr2ReadmeElement[] = [];
  for (let index = 0; index < context.readmeSources.length; index += 1) {
    const entry = context.readmeSources[index]!;
    const dstGroup = context.readmeDstGroups[index];
    if (!dstGroup || dstGroup.length === 0) {
      continue;
    }
    const destination = dstGroup[dstGroup.length - 1]!;
    elements.push({
      font: entry.font,
      lineSpacing: entry.lineSpacing,
      destination,
      keyframes: [...dstGroup],
    });
  }
  return elements;
}

export function createMouseCursorElements(context: ParseContext): Lr2MouseCursorElement[] {
  const elements: Lr2MouseCursorElement[] = [];
  for (let index = 0; index < context.mouseCursorSources.length; index += 1) {
    const source = context.mouseCursorSources[index]!;
    const dstGroup = context.mouseCursorDstGroups[index];
    if (!dstGroup || dstGroup.length === 0) {
      continue;
    }
    const imagePath = context.imagePaths[source.gr];
    if (!imagePath) {
      continue;
    }
    const destination = dstGroup[dstGroup.length - 1]!;
    elements.push({
      source: { ...source, imagePath },
      destination,
      keyframes: [...dstGroup],
      declarationOrder: source.declarationOrder,
    });
  }
  return elements;
}

export function createJudgeElements(context: ParseContext): Lr2Skin['judges'] {
  return buildJudgeMap(context.nowJudge1PSources, context.nowJudge1PDstGroups, context);
}

export function createJudge2PElements(context: ParseContext): Lr2Skin['judges2P'] {
  return buildJudgeMap(context.nowJudge2PSources, context.nowJudge2PDstGroups, context);
}

/**
 * Shared body for the per-side judge factories. Walks the kind map and emits an `Lr2ImageElement[]` per verdict (or
 * `[]` for verdicts the skin omitted on this side). Kept as a helper so the 1P / 2P paths can't drift apart silently.
 */
function buildJudgeMap(
  sources: SourceRect[],
  dstGroups: Lr2DestinationRect[][],
  context: ParseContext,
): Lr2Skin['judges'] {
  const judges: Lr2Skin['judges'] = {};
  for (const [id, kind] of NOW_JUDGE_1P_KIND_BY_INDEX) {
    const source = sources[id];
    const dstGroup = dstGroups[id];
    const imagePath = source ? context.imagePaths[source.gr] : undefined;
    if (!source || !dstGroup || dstGroup.length === 0 || !imagePath) {
      continue;
    }
    const destination = dstGroup[dstGroup.length - 1]!;
    // 0 (early POOR) and 1 (regular POOR) both map to 'poor'; the second one wins by virtue of being processed later.
    // Keep the FULL source rect (w/h spanning all divx*divy cells) so the renderer can cycle frames at runtime per
    // `cycle`.
    judges[kind] = [
      {
        source: {
          imagePath,
          x: source.x,
          y: source.y,
          w: source.w,
          h: source.h,
          divx: source.divx,
          divy: source.divy,
          cycle: source.cycle,
          timer: source.timer,
        },
        destination,
        keyframes: [...dstGroup],
        declarationOrder: source.declarationOrder,
      },
    ];
  }
  return judges;
}
