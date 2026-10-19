import { dirname } from '@be-music/utils/core';
import { asLoadedBytes } from '../file-lookup.ts';
import type { Lr2SkinFileEntry } from '../file-lookup.ts';
import { normalizeLr2Path, resolveLr2IncludePath } from '../assets.ts';
import { decodeText, parseRows } from '../csv.ts';
import {
  appendDestinationKeyframe,
  clampColorByte,
  parseBarBodyKind,
  parseBarGraphMuki,
  parseBarLampKind,
  parseBarLevelKind,
  parseBarRankKind,
  parseBarRivalKind,
  parseDestination,
  parseNowComboAlignment,
  parseNumberAlignment,
  parseSliderMuki,
  parseSource,
  parseTextAlignment,
  toNumber,
} from './fields.ts';
import type {
  BarBodySourceEntry,
  BarLampSourceEntry,
  BarLevelSourceEntry,
  BarRankSourceEntry,
  BarRivalSourceEntry,
  ParseContext,
} from './parse-context.ts';
import type { Lr2Skin } from './types.ts';

interface ConditionalFrame {
  active: boolean;
  anyMatched: boolean;
  parentActive: boolean;
}

const NOTE_COMMANDS: Record<string, keyof Lr2Skin['notes']> = {
  '#SRC_NOTE': 'note',
  '#SRC_LN_START': 'lnstart',
  '#SRC_LN_END': 'lnend',
  '#SRC_LN_BODY': 'lnbody',
  '#SRC_MINE': 'mine',
  // Auto-play "dummy note" sprites — used while autoplay (op 33) is on with CUSTOMOPTION "AUTOPLAY LANE = DUMMY NOTES"
  // (op 915) selected.
  '#SRC_AUTO_NOTE': 'autonote',
  '#SRC_AUTO_LN_START': 'autolnstart',
  '#SRC_AUTO_LN_END': 'autolnend',
  '#SRC_AUTO_LN_BODY': 'autolnbody',
  '#SRC_AUTO_MINE': 'automine',
};

export function readLr2Path(
  sourceFiles: ReadonlyMap<string, Lr2SkinFileEntry>,
  path: string,
  context: ParseContext,
  visited: Set<string>,
): void {
  if (visited.has(path)) {
    return;
  }
  visited.add(path);
  // `.lr2skin` / `.csv` files are CSV text, never audio, so the map entry is always a `Uint8Array` here.
  // `asLoadedBytes` narrows the union type without any runtime cost.
  const bytes = asLoadedBytes(sourceFiles.get(path));
  if (!bytes) {
    return;
  }

  const ifStack: ConditionalFrame[] = [];
  const isActive = (): boolean => ifStack.every((frame) => frame.active);

  for (const row of parseRows(decodeText(bytes))) {
    const command = row[0]?.toUpperCase();
    if (!command) {
      continue;
    }

    if (command === '#IF') {
      const parentActive = isActive();
      const matched = parentActive && evaluateOps(row.slice(1), context.trueOps);
      ifStack.push({ active: matched, anyMatched: matched, parentActive });
      continue;
    }
    if (command === '#ELSEIF') {
      const top = ifStack.at(-1);
      if (!top) {
        continue;
      }
      if (top.anyMatched || !top.parentActive) {
        top.active = false;
      } else {
        const matched = evaluateOps(row.slice(1), context.trueOps);
        top.active = matched;
        top.anyMatched = matched;
      }
      continue;
    }
    if (command === '#ELSE') {
      const top = ifStack.at(-1);
      if (!top) {
        continue;
      }
      top.active = !top.anyMatched && top.parentActive;
      top.anyMatched = true;
      continue;
    }
    if (command === '#ENDIF') {
      ifStack.pop();
      continue;
    }

    if (!isActive()) {
      continue;
    }

    if (command === '#ENDOFHEADER') {
      continue;
    }
    if (command === '#CUSTOMOPTION') {
      registerCustomOption(context, row);
      continue;
    }
    if (command === '#CUSTOMFILE') {
      registerCustomFile(context, sourceFiles, dirname(path), row);
      continue;
    }
    if (command === '#INFORMATION') {
      context.name = row[2] || context.name;
    } else if (command === '#RESOLUTION') {
      context.width = toNumber(row[1], context.width);
      context.height = toNumber(row[2], context.height);
      // Mark the resolution as authored-explicit so the post-parse auto-detector skips this skin. Authored
      // `#RESOLUTION` is the canonical signal — we always trust it over our heuristic.
      context.explicitResolution = true;
    } else if (command === '#IMAGE') {
      const normalized = normalizeLr2Path(row[1] ?? '');
      const expanded = context.customFileLookup.get(normalized.toLowerCase()) ?? normalized;
      context.imagePaths.push(expanded);
    } else if (command === '#LR2FONT') {
      // `#LR2FONT,relativePath[,1=force-bitmap]` is the **bitmap
      // font** registry. It's indexed independently from the
      // `#FONT` system-font registry — both share the `font` field
      // in `#SRC_TEXT` but each array is keyed by its own per-kind
      // position. So a CSV like:
      // ```
      // #FONT,18,...        ← system slot 0
      // #FONT,42,...        ← system slot 1
      // #LR2FONT,barfnt     ← bitmap slot 0
      // #LR2FONT,titlefont  ← bitmap slot 1
      // ```
      // pairs the system fallback at index N with the bitmap at
      // index N. `#SRC_TEXT,..., font=N, ...` first looks up
      // bitmap[N]; on miss it falls back to system[N] for the
      // size + face hint. This per-kind indexing is what LR2 the
      // application does and is required by the LR2 default
      // theme — its `select.csv` uses `font=4` for the PLAY
      // OPTION text expecting `#LR2FONT[4]` (= optionfont) to
      // render the value, not the 5th global declaration.
      const normalized = normalizeLr2Path(row[1] ?? '');
      const expanded =
        normalized.length > 0 ? (context.customFileLookup.get(normalized.toLowerCase()) ?? normalized) : '';
      context.lr2FontPaths.push(expanded);
    } else if (command === '#FONT') {
      // `#FONT,size,thick,style,name` — system-font fallback registry. See the `#LR2FONT` block above for the per-kind
      // indexing rationale. LR2 ignores the name and uses the user's SET UP option, so we only capture the size for our
      // render-time text-style decision.
      const size = Math.max(1, Math.trunc(toNumber(row[1], 12)));
      context.systemFontSizes.push(size);
    } else if (command === '#TRANSCOLOR') {
      const r = clampColorByte(toNumber(row[1], 0));
      const g = clampColorByte(toNumber(row[2], 0));
      const b = clampColorByte(toNumber(row[3], 0));
      context.transparentColor = { r, g, b };
    } else if (
      command === '#STARTINPUT' ||
      command === '#FADEOUT' ||
      command === '#CLOSE' ||
      command === '#LOADSTART' ||
      command === '#LOADEND' ||
      command === '#PLAYSTART' ||
      command === '#SKIP'
    ) {
      // Scene-timing directives — single ms argument. The renderer anchors timer 1/2/3/40/41 off these offsets.
      const ms = Math.max(0, Math.trunc(toNumber(row[1], 0)));
      switch (command) {
        case '#STARTINPUT':
          context.timing.startInput = ms;
          break;
        case '#FADEOUT':
          context.timing.fadeOut = ms;
          break;
        case '#CLOSE':
          context.timing.close = ms;
          break;
        case '#LOADSTART':
          context.timing.loadStart = ms;
          break;
        case '#LOADEND':
          context.timing.loadEnd = ms;
          break;
        case '#PLAYSTART':
          context.timing.playStart = ms;
          break;
        case '#SKIP':
          context.timing.skip = ms;
          break;
      }
    } else if (command === '#SETOPTION') {
      // `#SETOPTION,opCode` — overrides a CUSTOMOPTION's default by marking that op true at parse time. LR2 uses this
      // to lock a skin into a specific branch even when the user hasn't selected the matching option (e.g. force the
      // wide-lane layout when the skin author wants it as the default).
      const op = Math.trunc(toNumber(row[1], 0));
      if (op > 0) {
        context.trueOps.add(op);
      } else if (op < 0) {
        context.trueOps.delete(-op);
      }
    } else if (command === '#SCRATCH') {
      // `#SCRATCH,1P,2P` — flag (0/1) per side for "has scratch lane".
      context.scratchFlip.scratch1P = Math.max(0, Math.trunc(toNumber(row[1], 0)));
      context.scratchFlip.scratch2P = Math.max(0, Math.trunc(toNumber(row[2], 0)));
    } else if (command === '#FLIPSIDE') {
      // Marker — the skin declares itself flippable.
      context.scratchFlip.flipSide = true;
    } else if (command === '#FLIPRESULT') {
      // Flip should persist into the result scene.
      context.scratchFlip.flipResult = true;
    } else if (command === '#DISABLEFLIP') {
      // Skin opts out of flip. Mutually exclusive with `#FLIPSIDE`, but we honor whichever directive appears latest.
      context.scratchFlip.disableFlip = true;
    } else if (command === '#RELOADBANNER') {
      // Banner reloads on cursor move (BACKBMP / BANNER refresh). We always reload anyway, so this just records the
      // intent.
      context.scratchFlip.reloadBanner = true;
    } else if (command === '#INCLUDE') {
      // `#INCLUDE` honors `#CUSTOMFILE` wildcard substitutions the same way `#IMAGE` / `#LR2FONT` do. LITONE4's
      // `Select/select.lr2skin` declares `#CUSTOMFILE,全体色,...¥Select¥csv¥*.csv,blue,` then `#INCLUDE,...¥Select¥csv¥*.csv,`
      // — without the customFileLookup pre-check the wildcard reaches `resolveLr2IncludePath` literally and the
      // include resolves to nothing (no file in the bundle matches `*.csv` directly). Symptom was an empty select
      // skin (`images.length === 0`, `barLayout.slots === 0`) which fell back to the default-family chrome.
      // Pre-expansion lets the resolver see the real path (`Select/csv/blue.csv`) and the rest of the CSV walk
      // proceeds normally. Falls through to the regular include resolution when the pattern isn't a customFile
      // wildcard (= every LR2 theme that pre-dates LITONE4's wildcard-include trick).
      const rawInclude = row[1] ?? '';
      const customExpanded = context.customFileLookup.get(normalizeLr2Path(rawInclude).toLowerCase());
      const includePath = customExpanded ?? resolveLr2IncludePath(sourceFiles, dirname(path), rawInclude);
      if (includePath) {
        readLr2Path(sourceFiles, includePath, context, visited);
      }
    } else if (command === '#SRC_IMAGE') {
      context.imageSources.push(parseSource(row, context));
      context.imageDstGroups.push([]);
    } else if (command === '#DST_IMAGE') {
      const group = context.imageDstGroups.at(-1);
      if (group) {
        appendDestinationKeyframe(group, row, context);
      }
    } else if (command === '#SRC_NOWJUDGE_1P') {
      const id = toNumber(row[1], 0);
      if (context.nowJudge1PSources[id] === undefined) {
        context.nowJudge1PSources[id] = parseSource(row, context);
      }
    } else if (command === '#DST_NOWJUDGE_1P') {
      const id = toNumber(row[1], 0);
      const group = context.nowJudge1PDstGroups[id] ?? [];
      appendDestinationKeyframe(group, row, context);
      context.nowJudge1PDstGroups[id] = group;
    } else if (command === '#SRC_NOWJUDGE_2P') {
      const id = toNumber(row[1], 0);
      if (context.nowJudge2PSources[id] === undefined) {
        context.nowJudge2PSources[id] = parseSource(row, context);
      }
    } else if (command === '#DST_NOWJUDGE_2P') {
      const id = toNumber(row[1], 0);
      const group = context.nowJudge2PDstGroups[id] ?? [];
      appendDestinationKeyframe(group, row, context);
      context.nowJudge2PDstGroups[id] = group;
    } else if (command === '#SRC_NUMBER') {
      context.numberSources.push({
        source: parseSource(row, context),
        num: toNumber(row[11], 0),
        alignment: parseNumberAlignment(row[12]),
        padding: Math.max(0, Math.trunc(toNumber(row[13], 0))),
      });
      context.numberDstGroups.push([]);
    } else if (command === '#DST_NUMBER') {
      const group = context.numberDstGroups.at(-1);
      if (group) {
        appendDestinationKeyframe(group, row, context);
      }
    } else if (command === '#SRC_GROOVEGAUGE') {
      context.grooveGaugeSources.push({
        source: parseSource(row, context),
        index: Math.max(0, Math.trunc(toNumber(row[1], 0))),
        addX: toNumber(row[11], 0),
        addY: toNumber(row[12], 0),
      });
      context.grooveGaugeDstGroups.push([]);
    } else if (command === '#DST_GROOVEGAUGE') {
      const group = context.grooveGaugeDstGroups.at(-1);
      if (group) {
        appendDestinationKeyframe(group, row, context);
      }
    } else if (command === '#SRC_NOWCOMBO_1P' || command === '#SRC_NOWCOMBO_2P') {
      // #SRC_NOWCOMBO_*,index,gr,x,y,w,h,divx,divy,cycle,timer,(null),align,keta
      context.nowComboSources.push({
        source: parseSource(row, context),
        index: Math.max(0, Math.trunc(toNumber(row[1], 0))),
        alignment: parseNowComboAlignment(row[12]),
        padding: Math.max(0, Math.trunc(toNumber(row[13], 0))),
        side: command === '#SRC_NOWCOMBO_1P' ? '1P' : '2P',
      });
      context.nowComboDstGroups.push([]);
    } else if (command === '#DST_NOWCOMBO_1P' || command === '#DST_NOWCOMBO_2P') {
      // The DST attaches to the most recent SRC entry — we don't re-check the side here because the SRC ordering
      // already pinned it: a `#DST_NOWCOMBO_1P` after a `#SRC_NOWCOMBO_2P` would be a malformed skin and is handled by
      // the same permissive "extend the last group" semantics LR2 itself uses.
      const group = context.nowComboDstGroups.at(-1);
      if (group) {
        appendDestinationKeyframe(group, row, context);
      }
    } else if (command === '#SRC_JUDGELINE') {
      // #SRC_JUDGELINE,index,gr,x,y,w,h,divx,divy,cycle,timer,op1,op2,op3
      context.judgeLineSources.push({
        source: parseSource(row, context),
        index: Math.max(0, Math.trunc(toNumber(row[1], 0))),
      });
      context.judgeLineDstGroups.push([]);
    } else if (command === '#DST_JUDGELINE') {
      const group = context.judgeLineDstGroups.at(-1);
      if (group) {
        appendDestinationKeyframe(group, row, context);
      }
    } else if (command === '#SRC_LINE') {
      // #SRC_LINE,index,gr,x,y,w,h,divx,divy,cycle,timer,op1,op2,op3
      context.measureLineSources.push({
        source: parseSource(row, context),
        index: Math.max(0, Math.trunc(toNumber(row[1], 0))),
      });
      context.measureLineDstGroups.push([]);
    } else if (command === '#DST_LINE') {
      const group = context.measureLineDstGroups.at(-1);
      if (group) {
        appendDestinationKeyframe(group, row, context);
      }
    } else if (command === '#SRC_BGA') {
      // #SRC_BGA,(NULL),(NULL),…(unused),nobase,nolayer,nopoor Columns 11/12/13 are the per-DST suppression flags;
      // everything before them is a placeholder kept for SRC-row format symmetry.
      context.bgaSources.push({
        noBase: toNumber(row[11], 0) === 1,
        noLayer: toNumber(row[12], 0) === 1,
        noPoor: toNumber(row[13], 0) === 1,
      });
      context.bgaDstGroups.push([]);
    } else if (command === '#DST_BGA') {
      const group = context.bgaDstGroups.at(-1);
      if (group) {
        appendDestinationKeyframe(group, row, context);
      }
    } else if (command === '#SRC_TEXT') {
      // #SRC_TEXT,(NULL),font,st,align,edit,panel
      context.textSources.push({
        font: Math.max(0, Math.trunc(toNumber(row[2], 0))),
        st: Math.max(0, Math.trunc(toNumber(row[3], 0))),
        alignment: parseTextAlignment(row[4]),
        edit: Math.max(0, Math.trunc(toNumber(row[5], 0))),
        // `panel` may legitimately be negative (-1 = "only when no panel open") so we keep the sign.
        panel: Math.trunc(toNumber(row[6], 0)),
        // TEXT bypasses `parseSource` (no SourceRect) so stamp the CSV-stream order on the entry directly.
        declarationOrder: context.nextDeclarationOrder++,
      });
      context.textDstGroups.push([]);
    } else if (command === '#DST_TEXT') {
      const group = context.textDstGroups.at(-1);
      if (group) {
        appendDestinationKeyframe(group, row, context);
      }
    } else if (command === '#SRC_BARGRAPH') {
      // #SRC_BARGRAPH,(NULL),gr,x,y,w,h,divx,divy,cycle,timer,type,muki
      context.bargraphSources.push({
        source: parseSource(row, context),
        type: Math.max(0, Math.trunc(toNumber(row[11], 0))),
        muki: parseBarGraphMuki(row[12]),
      });
      context.bargraphDstGroups.push([]);
    } else if (command === '#DST_BARGRAPH') {
      const group = context.bargraphDstGroups.at(-1);
      if (group) {
        appendDestinationKeyframe(group, row, context);
      }
    } else if (command === '#SRC_SLIDER') {
      // #SRC_SLIDER,(NULL),gr,x,y,w,h,divx,divy,cycle,timer,muki,range,type,disable `parseSource` already stamps
      // `source.declarationOrder` for the z-order stratification — no need for a second counter on the entry itself.
      context.sliderSources.push({
        source: parseSource(row, context),
        muki: parseSliderMuki(row[11]),
        range: Math.max(0, Math.trunc(toNumber(row[12], 0))),
        type: Math.max(0, Math.trunc(toNumber(row[13], 0))),
      });
      context.sliderDstGroups.push([]);
    } else if (command === '#DST_SLIDER') {
      const group = context.sliderDstGroups.at(-1);
      if (group) {
        appendDestinationKeyframe(group, row, context);
      }
    } else if (command === '#SRC_GAUGECHART_1P' || command === '#SRC_GAUGECHART_2P') {
      // #SRC_GAUGECHART_*,index,gr,x,y,w,h,divx,divy,cycle,timer,field_w,field_h,start,end The LR2 spec puts `index` at
      // row[1] (where #SRC_IMAGE has the `(NULL)` placeholder), and the per-chart-area / animation fields at
      // row[11..14]. `parseSource` already reads gr/x/y/w/h/ /divx/divy/cycle/timer from row[2..10] which aligns; we
      // only need to pull the chart-specific extras separately.
      context.gaugeChartSources.push({
        source: parseSource(row, context),
        index: Math.max(0, Math.trunc(toNumber(row[1], 0))),
        fieldWidth: Math.max(0, Math.trunc(toNumber(row[11], 0))),
        fieldHeight: Math.max(0, Math.trunc(toNumber(row[12], 0))),
        start: Math.max(0, Math.trunc(toNumber(row[13], 0))),
        end: Math.max(0, Math.trunc(toNumber(row[14], 0))),
        side: command === '#SRC_GAUGECHART_2P' ? '2P' : '1P',
      });
      context.gaugeChartDstGroups.push([]);
    } else if (command === '#DST_GAUGECHART_1P' || command === '#DST_GAUGECHART_2P') {
      // The DST keyframe attaches to the most-recently-pushed SRC of the matching side. The LR2 default skins
      // interleave 1P / 2P SRC + DST so "last SRC of this side" picks the right group.
      const targetSide = command === '#DST_GAUGECHART_2P' ? '2P' : '1P';
      let lastSideIndex = -1;
      for (let index = context.gaugeChartSources.length - 1; index >= 0; index -= 1) {
        if (context.gaugeChartSources[index]!.side === targetSide) {
          lastSideIndex = index;
          break;
        }
      }
      if (lastSideIndex >= 0) {
        const group = context.gaugeChartDstGroups[lastSideIndex];
        if (group) {
          appendDestinationKeyframe(group, row, context);
        }
      }
    } else if (command === '#SRC_SCORECHART') {
      // Same layout as `#SRC_GAUGECHART_*` minus the side dimension (the spec uses `index` for current/best/target
      // instead).
      context.scoreChartSources.push({
        source: parseSource(row, context),
        index: Math.max(0, Math.trunc(toNumber(row[1], 0))),
        fieldWidth: Math.max(0, Math.trunc(toNumber(row[11], 0))),
        fieldHeight: Math.max(0, Math.trunc(toNumber(row[12], 0))),
        start: Math.max(0, Math.trunc(toNumber(row[13], 0))),
        end: Math.max(0, Math.trunc(toNumber(row[14], 0))),
      });
      context.scoreChartDstGroups.push([]);
    } else if (command === '#DST_SCORECHART') {
      const group = context.scoreChartDstGroups.at(-1);
      if (group) {
        appendDestinationKeyframe(group, row, context);
      }
    } else if (command === '#SRC_BUTTON') {
      // #SRC_BUTTON,(NULL),gr,x,y,w,h,divx,divy,cycle,timer,type,click,panel,plusonly `plusonly` is optional in the LR2
      // spec — `toNumber(..., 0)` keeps it at 0 (= both directions allowed) when the column is missing.
      context.buttonSources.push({
        source: parseSource(row, context),
        type: Math.max(0, Math.trunc(toNumber(row[11], 0))),
        click: Math.max(0, Math.trunc(toNumber(row[12], 0))),
        panel: Math.trunc(toNumber(row[13], 0)),
        plusOnly: Math.trunc(toNumber(row[14], 0)),
      });
      context.buttonDstGroups.push([]);
    } else if (command === '#DST_BUTTON') {
      const group = context.buttonDstGroups.at(-1);
      if (group) {
        appendDestinationKeyframe(group, row, context);
      }
    } else if (command === '#SRC_ONMOUSE') {
      // #SRC_ONMOUSE,(NULL),gr,x,y,w,h,divx,divy,cycle,timer,panel,x2,y2,w2,h2
      context.onMouseSources.push({
        source: parseSource(row, context),
        panel: Math.trunc(toNumber(row[11], 0)),
        hitOffsetX: Math.trunc(toNumber(row[12], 0)),
        hitOffsetY: Math.trunc(toNumber(row[13], 0)),
        hitWidth: Math.trunc(toNumber(row[14], 0)),
        hitHeight: Math.trunc(toNumber(row[15], 0)),
      });
      context.onMouseDstGroups.push([]);
    } else if (command === '#DST_ONMOUSE') {
      const group = context.onMouseDstGroups.at(-1);
      if (group) {
        appendDestinationKeyframe(group, row, context);
      }
    } else if (command === '#SRC_README') {
      // #SRC_README,(NULL),font,(NULL),(NULL),kankaku
      context.readmeSources.push({
        font: Math.max(0, Math.trunc(toNumber(row[2], 0))),
        lineSpacing: Math.max(0, Math.trunc(toNumber(row[5], 0))),
      });
      context.readmeDstGroups.push([]);
    } else if (command === '#DST_README') {
      const group = context.readmeDstGroups.at(-1);
      if (group) {
        appendDestinationKeyframe(group, row, context);
      }
    } else if (command === '#SRC_MOUSECURSOR') {
      // #SRC_MOUSECURSOR,(NULL),gr,x,y,w,h,divx,divy,cycle,timer
      context.mouseCursorSources.push(parseSource(row, context));
      context.mouseCursorDstGroups.push([]);
    } else if (command === '#DST_MOUSECURSOR') {
      const group = context.mouseCursorDstGroups.at(-1);
      if (group) {
        appendDestinationKeyframe(group, row, context);
      }
    } else if (command === '#SRC_BAR_FLASH') {
      // Spec only allows one — last wins. Used as the focused-bar pulse / glow overlay; DST coordinates are relative to
      // the focused bar's `BAR_BODY_ON` rect.
      context.barFlashSource = parseSource(row, context);
    } else if (command === '#DST_BAR_FLASH') {
      appendDestinationKeyframe(context.barFlashDst, row, context);
    } else if (command === '#SRC_BAR_RIVAL') {
      // #SRC_BAR_RIVAL,index,gr,x,y,w,h,divx,divy,cycle,timer index 0=WIN / 1=LOSE / 2=DRAW (3=NOT PLAYED is
      // recommended omitted by the spec; we accept it but don't model it).
      const kind = parseBarRivalKind(row[1]);
      if (kind) {
        const entry: BarRivalSourceEntry = { kind, source: parseSource(row, context) };
        const existingIndex = context.barRivalSources.findIndex((existing) => existing.kind === kind);
        if (existingIndex >= 0) {
          context.barRivalSources[existingIndex] = entry;
        } else {
          context.barRivalSources.push(entry);
        }
      }
    } else if (command === '#DST_BAR_RIVAL') {
      appendDestinationKeyframe(context.barRivalDst, row, context);
    } else if (command === '#SRC_BAR_MY_LAMP') {
      // Rival-mode self lamp. Same kind enum as `#SRC_BAR_LAMP`.
      const kind = parseBarLampKind(row[1]);
      if (kind) {
        const entry: BarLampSourceEntry = { kind, source: parseSource(row, context) };
        const existingIndex = context.barMyLampSources.findIndex((existing) => existing.kind === kind);
        if (existingIndex >= 0) {
          context.barMyLampSources[existingIndex] = entry;
        } else {
          context.barMyLampSources.push(entry);
        }
      }
    } else if (command === '#DST_BAR_MY_LAMP') {
      appendDestinationKeyframe(context.barMyLampDst, row, context);
    } else if (command === '#SRC_BAR_RIVAL_LAMP') {
      // Rival-mode opponent lamp. Same kind enum.
      const kind = parseBarLampKind(row[1]);
      if (kind) {
        const entry: BarLampSourceEntry = { kind, source: parseSource(row, context) };
        const existingIndex = context.barRivalLampSources.findIndex((existing) => existing.kind === kind);
        if (existingIndex >= 0) {
          context.barRivalLampSources[existingIndex] = entry;
        } else {
          context.barRivalLampSources.push(entry);
        }
      }
    } else if (command === '#DST_BAR_RIVAL_LAMP') {
      appendDestinationKeyframe(context.barRivalLampDst, row, context);
    } else if (command === '#SRC_BAR_BODY') {
      // #SRC_BAR_BODY,kind,gr,x,y,w,h,divx,divy,cycle,timer
      const kind = parseBarBodyKind(row[1]);
      if (kind) {
        // Stamp the FIRST `#SRC_BAR_BODY` we see — that's the anchor `Lr2BarLayout.declarationOrder` ends up at, and
        // every chrome element compared against it. Later bar-body declarations (e.g. inside an #IF branch overriding
        // the kind) don't shift the anchor — the bar list as a whole is "declared" at its first slot.
        if (context.barLayoutDeclarationOrder === undefined) {
          context.barLayoutDeclarationOrder = context.nextDeclarationOrder++;
        }
        // Last definition for a given kind wins, mirroring LR2's "later #IF branch overrides earlier" convention.
        const existingIndex = context.barBodySources.findIndex((entry) => entry.kind === kind);
        const entry: BarBodySourceEntry = { kind, source: parseSource(row, context) };
        if (existingIndex >= 0) {
          context.barBodySources[existingIndex] = entry;
        } else {
          context.barBodySources.push(entry);
        }
      }
    } else if (command === '#DST_BAR_BODY_OFF') {
      const slot = Math.max(0, Math.trunc(toNumber(row[1], 0)));
      const group = context.barBodyOffDstGroups[slot] ?? [];
      appendDestinationKeyframe(group, row, context);
      context.barBodyOffDstGroups[slot] = group;
    } else if (command === '#DST_BAR_BODY_ON') {
      const slot = Math.max(0, Math.trunc(toNumber(row[1], 0)));
      const group = context.barBodyOnDstGroups[slot] ?? [];
      appendDestinationKeyframe(group, row, context);
      context.barBodyOnDstGroups[slot] = group;
    } else if (command === '#BAR_CENTER') {
      context.barCenter = Math.max(0, Math.trunc(toNumber(row[1], 0)));
    } else if (command === '#BAR_AVAILABLE') {
      context.barAvailable = Math.max(0, Math.trunc(toNumber(row[1], 0)));
    } else if (command === '#SRC_BAR_TITLE') {
      // #SRC_BAR_TITLE,(NULL),font,(NULL)... — only the font index is meaningful; everything else is a placeholder kept
      // for SRC-row format symmetry with #SRC_TEXT.
      context.barTitleSource = { font: Math.max(0, Math.trunc(toNumber(row[2], 0))) };
    } else if (command === '#DST_BAR_TITLE') {
      appendDestinationKeyframe(context.barTitleDst, row, context);
    } else if (command === '#SRC_BAR_LEVEL') {
      // #SRC_BAR_LEVEL,index,gr,x,y,w,h,divx,divy,cycle,timer,(null),align,keta
      const kind = parseBarLevelKind(row[1]);
      if (kind) {
        const entry: BarLevelSourceEntry = {
          kind,
          source: parseSource(row, context),
          alignment: parseNumberAlignment(row[12]),
          padding: Math.max(0, Math.trunc(toNumber(row[13], 0))),
        };
        const existingIndex = context.barLevelSources.findIndex((existing) => existing.kind === kind);
        if (existingIndex >= 0) {
          context.barLevelSources[existingIndex] = entry;
        } else {
          context.barLevelSources.push(entry);
        }
      }
    } else if (command === '#DST_BAR_LEVEL') {
      appendDestinationKeyframe(context.barLevelDst, row, context);
    } else if (command === '#SRC_BAR_LAMP') {
      // #SRC_BAR_LAMP,index,gr,x,y,w,h,divx,divy,cycle,timer
      const kind = parseBarLampKind(row[1]);
      if (kind) {
        const entry: BarLampSourceEntry = { kind, source: parseSource(row, context) };
        const existingIndex = context.barLampSources.findIndex((existing) => existing.kind === kind);
        if (existingIndex >= 0) {
          context.barLampSources[existingIndex] = entry;
        } else {
          context.barLampSources.push(entry);
        }
      }
    } else if (command === '#DST_BAR_LAMP') {
      appendDestinationKeyframe(context.barLampDst, row, context);
    } else if (command === '#SRC_BAR_RANK') {
      // #SRC_BAR_RANK,index,gr,x,y,w,h,divx,divy,cycle,timer
      const kind = parseBarRankKind(row[1]);
      if (kind) {
        const entry: BarRankSourceEntry = { kind, source: parseSource(row, context) };
        const existingIndex = context.barRankSources.findIndex((existing) => existing.kind === kind);
        if (existingIndex >= 0) {
          context.barRankSources[existingIndex] = entry;
        } else {
          context.barRankSources.push(entry);
        }
      }
    } else if (command === '#DST_BAR_RANK') {
      appendDestinationKeyframe(context.barRankDst, row, context);
    } else if (command in NOTE_COMMANDS) {
      const kind = NOTE_COMMANDS[command]!;
      const lane = toNumber(row[1], 0);
      const sources = context.noteSources.get(kind) ?? [];
      sources[lane] = parseSource(row, context);
      context.noteSources.set(kind, sources);
    } else if (command === '#DST_NOTE') {
      const lane = toNumber(row[1], 0);
      context.laneRects[lane] = parseDestination(row);
    }
  }
}

function registerCustomOption(context: ParseContext, row: string[]): void {
  const name = (row[1] ?? '').trim();
  const defaultOp = toNumber(row[2], 0);
  const labels = row.slice(3).filter((value) => value.length > 0);
  if (!name || defaultOp <= 0 || labels.length === 0) {
    return;
  }
  context.customOptions.push({ name, defaultOp, numChoices: labels.length });
  context.trueOps.add(defaultOp);
}

function registerCustomFile(
  context: ParseContext,
  sourceFiles: ReadonlyMap<string, Lr2SkinFileEntry>,
  baseDirectory: string,
  row: string[],
): void {
  const name = (row[1] ?? '').trim();
  const pattern = (row[2] ?? '').trim();
  const defaultName = (row[3] ?? '').trim();
  if (!name || !pattern || !defaultName) {
    return;
  }
  const expanded = pattern.replaceAll('*', defaultName);
  const resolvedPath = resolveLr2IncludePath(sourceFiles, baseDirectory, expanded);
  if (resolvedPath) {
    context.customFiles.push({ name, path: resolvedPath });
    context.customFileLookup.set(normalizeLr2Path(pattern).toLowerCase(), resolvedPath);
  }
}

function evaluateOps(values: string[], trueOps: ReadonlySet<number>): boolean {
  for (const value of values) {
    const op = toNumber(value, 0);
    if (op === 0) {
      continue;
    }
    if (op > 0) {
      if (!trueOps.has(op)) {
        return false;
      }
    } else if (trueOps.has(-op)) {
      return false;
    }
  }
  return true;
}
