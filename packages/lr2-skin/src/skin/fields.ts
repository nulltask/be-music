import { LR2_BAR_BODY, LR2_BAR_LAMP } from '../ids/bar.ts';
import type { ParseContext, SourceRect } from './parse-context.ts';
import type {
  LR2BarBodyKind,
  LR2BarGraphMuki,
  LR2BarLampKind,
  LR2BarLevelKind,
  LR2BarRankKind,
  LR2BarRivalKind,
  LR2DestinationRect,
  LR2NumberAlignment,
  LR2SliderMuki,
  LR2TextAlignment,
} from './types.ts';

export function clampColorByte(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(255, Math.max(0, Math.trunc(value)));
}

export function parseSource(row: string[], context: ParseContext): SourceRect {
  return {
    gr: toNumber(row[2], 0),
    x: toNumber(row[3], 0),
    y: toNumber(row[4], 0),
    w: toNumber(row[5], 0),
    h: toNumber(row[6], 0),
    // LR2 frequently sets divx/divy=0 to mean "treat as 1" (single cell).
    divx: Math.max(1, Math.trunc(toNumber(row[7], 1)) || 1),
    divy: Math.max(1, Math.trunc(toNumber(row[8], 1)) || 1),
    cycle: Math.max(0, Math.trunc(toNumber(row[9], 0))),
    timer: Math.max(0, Math.trunc(toNumber(row[10], 0))),
    // Stamp every parsed source with the next free CSV-stream index so the renderer can compare it against the bar
    // layout's own index to decide which side of the bar list this element sits on.
    declarationOrder: context.nextDeclarationOrder++,
  };
}

export function parseDestination(row: string[]): LR2DestinationRect {
  // #DST_*,(NULL),time,x,y,w,h,acc,a,r,g,b,blend,filter,angle,center,loop,timer,op1,op2,op3 row index: 0 1 2 3 4 5 6 7
  // 8 9 10 11 12 13 14 15 16 17 18 19 20 (row[0] is the command itself when split by parseRow.)
  const ops = [toNumber(row[18], 0), toNumber(row[19], 0), toNumber(row[20], 0)].filter(
    (op) => Number.isFinite(op) && op !== 0,
  );
  // LR2 keyframes commonly leave the trailing fields blank past the first row (e.g. `#DST_IMAGE,0,1500,...,,,,,`). An
  // empty field for `timer` should be treated as "inherit from the previous keyframe", not as `timer=0` -- this is what
  // kept things like the "STAGE FAILED" plate (timer=3 on the first keyframe) drawing during gameplay. Use -1 here as a
  // sentinel and let the DST-list builder resolve the inheritance.
  const timerRaw = row[17];
  const timerProvided = typeof timerRaw === 'string' && timerRaw.trim() !== '';
  const timer = timerProvided ? Math.max(0, Math.trunc(toNumber(timerRaw, 0))) : -1;
  return {
    time: Math.max(0, toNumber(row[2], 0)),
    x: toNumber(row[3], 0),
    y: toNumber(row[4], 0),
    w: toNumber(row[5], 0),
    h: toNumber(row[6], 0),
    acc: Math.max(0, Math.min(3, Math.trunc(toNumber(row[7], 0)))),
    alpha: Math.max(0, Math.min(1, toNumber(row[8], 255) / 255)),
    r: clampColorByte(toNumber(row[9], 255)),
    g: clampColorByte(toNumber(row[10], 255)),
    b: clampColorByte(toNumber(row[11], 255)),
    blend: Math.max(0, Math.trunc(toNumber(row[12], 0))),
    filter: Math.max(0, Math.trunc(toNumber(row[13], 0))),
    angle: toNumber(row[14], 0),
    center: Math.max(0, Math.trunc(toNumber(row[15], 0))),
    loop: toNumber(row[16], 0),
    timer,
    ops,
    op4: Math.trunc(toNumber(row[21], 0)),
  };
}

/**
 * Push a freshly-parsed `#DST_*` row into a keyframe group, inheriting the `timer`, `loop`, and `ops` values from the
 * previous keyframe when they were omitted on the trailing row.
 *
 * Per the LR2 spec, a chain like `#DST_IMAGE,0,400,...,1000,0,161,0,0` `#DST_IMAGE,0,1000,...,,,,,` is read as "second
 * keyframe inherits everything that was blank from the first." Without inheritance, the second keyframe would silently
 * default to `timer=0, loop=0, ops=[]`, which made gated overlays (5keys lane cover with op=161, autoscratch lane cover
 * with op=55, …) leak in unrelated modes. The destination check uses the *final* keyframe, so its `ops` MUST carry the
 * gate forward.
 */
export function appendDestinationKeyframe(group: LR2DestinationRect[], row: string[], context?: ParseContext): void {
  const dst = parseDestination(row);
  const previous = group[group.length - 1];
  if (dst.timer === -1) {
    dst.timer = previous?.timer ?? 0;
  }
  if (previous) {
    // `loop`, `acc`, and the trailing op fields are blank-inherited the same way: a row that only specifies
    // `time,x,y,w,h,...` keeps the original easing / loop gate / op gate.
    if (isBlank(row[16])) {
      dst.loop = previous.loop;
    }
    if (isBlank(row[7])) {
      dst.acc = previous.acc;
    }
    if (isBlank(row[18]) && isBlank(row[19]) && isBlank(row[20])) {
      dst.ops = previous.ops;
    }
    // `op4` (scratch-turntable spin marker) inherits the same way. Without this the LR2 default 7-keys skin's turntable
    // disc has op4=1 on its first keyframe but a blank op4 on the second (final) keyframe — `evaluateElementDst` reads
    // the final, sees op4=0, and the spin code in `player-web`'s `view/lr2/play-elements.ts` never fires.
    if (isBlank(row[21])) {
      dst.op4 = previous.op4;
    }
  }
  group.push(dst);
  // Feed the right-bottom corner into the canvas auto-detector's sample set. We skip entries with negative `x` or
  // `y` (animation slide-in / slide-out start points authored off-screen) so the detector's percentile is dominated
  // by ON-screen authored geometry. Entries with zero width / height also drop out — they don't render anything
  // and add noise at the origin. `context` is optional so callers that just want the inheritance semantics
  // (currently none, but the signature stays open for unit tests) can pass `undefined`.
  if (context !== undefined && dst.x >= 0 && dst.y >= 0 && dst.w > 0 && dst.h > 0) {
    context.observedDstCorners.push([dst.x + dst.w, dst.y + dst.h]);
  }
}

function isBlank(value: string | undefined): boolean {
  return typeof value !== 'string' || value.trim() === '';
}

export function parseNumberAlignment(value: string | undefined): LR2NumberAlignment {
  switch (toNumber(value, 0)) {
    case 1:
      return 'left';
    case 2:
      return 'center';
    default:
      return 'right';
  }
}

// LR2 NOWCOMBO_1P alignment. The spec says 0=left/1=center/2=right but matching the LR2 reference video visually
// requires NUMBER's encoding (0=right, 1=left, 2=center) — for the LR2 default 7-keys skin (`align=1`) the combo digits
// sit IMMEDIATELY to the right of the judgement plate (left-aligned at the relative x), not centered on it.
export function parseNowComboAlignment(value: string | undefined): LR2NumberAlignment {
  switch (toNumber(value, 0)) {
    case 1:
      return 'left';
    case 2:
      return 'center';
    default:
      return 'right';
  }
}

/** LR2 SRC_TEXT alignment: 0=left, 1=center, 2=right. */
export function parseTextAlignment(value: string | undefined): LR2TextAlignment {
  switch (toNumber(value, 0)) {
    case 1:
      return 'center';
    case 2:
      return 'right';
    default:
      return 'left';
  }
}

/** LR2 SRC_BARGRAPH `muki`: 0=horizontal, 1=vertical. */
export function parseBarGraphMuki(value: string | undefined): LR2BarGraphMuki {
  return toNumber(value, 0) === 1 ? 'vertical' : 'horizontal';
}

/**
 * LR2 SRC_SLIDER `muki`: empirically derived from the LR2 default 7-keys skin's song-progress slider
 * (`#SRC_SLIDER,…,muki=2,range=278,type=6`) and the verified behavior that the indicator travels top → bottom over 278
 * px starting at y=15. So muki=2 ⇒ "down" — vertical, growing downward.
 *
 * 0=right (horizontal default), 1=left, 2=down, 3=up.
 */
export function parseSliderMuki(value: string | undefined): LR2SliderMuki {
  switch (toNumber(value, 0)) {
    case 1:
      return 'left';
    case 2:
      return 'down';
    case 3:
      return 'up';
    default:
      return 'right';
  }
}

export function parseBarBodyKind(value: string | undefined): LR2BarBodyKind | undefined {
  switch (Math.trunc(toNumber(value, -1))) {
    case LR2_BAR_BODY.SONG:
      return 'song';
    case LR2_BAR_BODY.FOLDER:
      return 'folder';
    case LR2_BAR_BODY.CUSTOM_FOLDER:
      return 'customFolder';
    case LR2_BAR_BODY.NEW_SONG_FOLDER:
      return 'newSongFolder';
    case LR2_BAR_BODY.RIVAL_FOLDER:
      return 'rivalFolder';
    case LR2_BAR_BODY.RIVAL_SONG:
      return 'rivalSong';
    case LR2_BAR_BODY.COURSE_FOLDER:
      return 'courseFolder';
    case LR2_BAR_BODY.COURSE_CREATE:
      return 'courseCreate';
    case LR2_BAR_BODY.COURSE:
      return 'course';
    case LR2_BAR_BODY.RANDOM_COURSE:
      return 'randomCourse';
    default:
      return undefined;
  }
}

export function parseBarLevelKind(value: string | undefined): LR2BarLevelKind | undefined {
  switch (Math.trunc(toNumber(value, -1))) {
    case 0:
      return 'undefined';
    case 1:
      return 'beginner';
    case 2:
      return 'normal';
    case 3:
      return 'hyper';
    case 4:
      return 'another';
    case 5:
      return 'insane';
    case 6:
      return 'irRanking';
    default:
      return undefined;
  }
}

export function parseBarLampKind(value: string | undefined): LR2BarLampKind | undefined {
  switch (Math.trunc(toNumber(value, -1))) {
    case LR2_BAR_LAMP.NO_PLAY:
      return 'noplay';
    case LR2_BAR_LAMP.FAILED:
      return 'failed';
    case LR2_BAR_LAMP.EASY:
      return 'easy';
    case LR2_BAR_LAMP.CLEAR:
      return 'clear';
    case LR2_BAR_LAMP.HARD:
      return 'hard';
    case LR2_BAR_LAMP.FULL_COMBO:
      return 'fullcombo';
    default:
      return undefined;
  }
}

export function parseBarRankKind(value: string | undefined): LR2BarRankKind | undefined {
  switch (Math.trunc(toNumber(value, -1))) {
    case 0:
      return 'noplay';
    case 1:
      return 'F';
    case 2:
      return 'E';
    case 3:
      return 'D';
    case 4:
      return 'C';
    case 5:
      return 'B';
    case 6:
      return 'A';
    case 7:
      return 'AA';
    case 8:
      return 'AAA';
    default:
      return undefined;
  }
}

export function parseBarRivalKind(value: string | undefined): LR2BarRivalKind | undefined {
  switch (Math.trunc(toNumber(value, -1))) {
    case 0:
      return 'win';
    case 1:
      return 'lose';
    case 2:
      return 'draw';
    default:
      return undefined;
  }
}

export function toNumber(value: string | undefined, fallback: number): number {
  const number = Number.parseFloat(value ?? '');
  return Number.isFinite(number) ? number : fallback;
}
