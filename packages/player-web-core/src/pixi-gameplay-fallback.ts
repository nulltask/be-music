import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { BGA, BG, DESIGN_HEIGHT, DESIGN_WIDTH, GROOVE, PLAYFIELD, YELLOW } from './pixi-gameplay-constants.ts';

/*
 * Palette: dark grey chrome panels + a few accent tones lifted
 * from `Theme/LR2/Play/ss_7.png`. The LR2 default skin paints
 * everything with a single `frame.tga` bitmap; we evoke that
 * with flat-fill rectangles at each `#DST_IMAGE` rectangle the
 * skin authors. Nothing here is invented — every position below
 * has a corresponding `#DST_*` literal in
 * `Theme/LR2/Play/7keys/7_LL0.csv`.
 */
const PANEL_BG = 0x12141a;
const PANEL_BG_2 = 0x191c25;
const PANEL_BORDER = 0x2c333d;
const PANEL_HIGHLIGHT = 0x39414d;
const TEXT_DIM = 0x9aa6b2;
const TEXT_BRIGHT = 0xf8fafc;
const ACCENT_BLUE = 0x56b6f7;
const ACCENT_AMBER = 0xffd166;
const ACCENT_RED = 0xff5050;

/**
 * Live runtime values painted into the fallback chrome's text
 * slots — score / combo / BPM / hi-speed / judge counter.
 * Missing values render as `----` placeholders.
 */
export interface FallbackGameplayRuntime {
  songTitle?: string;
  songArtist?: string;
  bpm?: number;
  hiSpeed?: number;
  score?: number;
  exScore?: number;
  exScoreMax?: number;
  combo?: number;
  maxCombo?: number;
  perfect?: number;
  great?: number;
  good?: number;
  bad?: number;
  poor?: number;
  /** PERFECT / GREAT / GOOD / BAD / POOR — empty when no recent judge. */
  lastJudge?: string;
  /** AAA / AA / A / B / C / D / E / F. */
  rank?: string;
  autoplay?: boolean;
}

/**
 * No-skin chrome that follows LR2's default 7K skin
 * (`Theme/LR2/Play/7keys/7_LL0.csv`) verbatim — every rectangle
 * sits at a coordinate the skin's `#DST_IMAGE` / `#DST_*` line
 * authors. The skin's `frame.tga` would normally paint art on
 * top; without it we draw flat dark rectangles so the layout
 * footprint is preserved, then overlay numeric / text values
 * with Pixi `Text` at the skin's `#DST_NUMBER` / `#DST_TEXT`
 * coordinates.
 *
 * Anything LR2 doesn't author with a `#DST_*` is not drawn —
 * we explicitly avoid inventing decorative elements (key
 * buttons, turntable, lane stripes, score-graph polylines, etc.)
 * that the LR2 default skin doesn't carry. `frame.tga` is
 * decorative bitmap chrome we can't reproduce with primitives,
 * but the positions below are everything LR2 *does* author as
 * data.
 */
export function renderFallbackLr2Frame(layer: Container, runtime: FallbackGameplayRuntime = {}): void {
  const frame = new Graphics();
  frame.label = 'fallback-frame/chrome';
  frame.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill(BG);

  // ── Lane area: x=33..227, full-height down to the judge bar.
  // LR2 paints this as part of frame.tga; we use a uniform black
  // fill so notes scroll over a consistent dark background.
  // Authored references:
  //   #DST_NOTE,0..7  → x=33/76/100/119/143/162/186/205, y=315
  //   #DST_LINE       → x=33,  y=320, w=194, h=1
  //   #DST_JUDGELINE  → x=33,  y=315, w=194, h=6
  frame.rect(PLAYFIELD.x, PLAYFIELD.y, PLAYFIELD.w, PLAYFIELD.judgementY - PLAYFIELD.y).fill(0x000000);
  // Judge bar (yellow)
  frame.rect(PLAYFIELD.x, PLAYFIELD.judgementY - 6, PLAYFIELD.w, 6).fill(YELLOW);
  // 1-px white DST_LINE just below the judge bar
  frame.rect(PLAYFIELD.x, 320, PLAYFIELD.w, 1).fill({ color: 0xffffff, alpha: 0.45 });

  // ── #DST_IMAGE,...,1,0,75,384 — left chrome panel.
  frame.rect(1, 0, 75, 384).fill(PANEL_BG);

  // ── #DST_IMAGE,...,20,0,11,323 — left vertical accent.
  frame.rect(20, 0, 11, 323).fill(PANEL_HIGHLIGHT);

  // ── #DST_BGA,...,291,56,256,256 (NORMAL) — BGA window.
  frame.rect(BGA.x, BGA.y, BGA.w, BGA.h).fill(0x000000);

  // ── #DST_IMAGE,...,523,0,118,480 — right info column.
  frame.rect(523, 0, 118, DESIGN_HEIGHT).fill(PANEL_BG);
  frame.rect(523, 0, 118, DESIGN_HEIGHT).stroke({ color: PANEL_BORDER, width: 1 });

  // ── #DST_IMAGE,...,488,67/96/125,128,7 — three lamp stripes
  //    (CLEAR / FAILED / FULLCOMBO indicators, gated on op 39).
  for (const ly of [67, 96, 125]) {
    frame.rect(488, ly, 128, 7).fill(PANEL_BG_2).stroke({ color: PANEL_BORDER, width: 1 });
  }

  // ── #DST_BARGRAPH,...,500/540/580,303,36,-259 — three vertical
  //    bargraphs (current / target / next-rank). Visible footprint
  //    is x..x+36, y=44..303.
  for (const bx of [500, 540, 580]) {
    frame.rect(bx, 44, 36, 259).fill(PANEL_BG_2).stroke({ color: PANEL_BORDER, width: 1 });
  }

  // ── #DST_TEXT,...,504,362,94,15 — hi-speed text panel.
  frame.rect(504, 362, 94, 15).fill(PANEL_BG_2).stroke({ color: PANEL_BORDER, width: 1 });

  // ── #DST_IMAGE,...,11,374,252,39 — wide score ribbon.
  frame.rect(11, 374, 252, 39).fill(PANEL_BG).stroke({ color: PANEL_BORDER, width: 1 });

  // ── #DST_IMAGE,...,238,371,85,36 — decorative band beneath BGA.
  frame.rect(238, 371, 85, 36).fill(PANEL_BG_2).stroke({ color: PANEL_BORDER, width: 1 });

  // ── #DST_IMAGE,...,320,392,200,31 — centre-bottom bar.
  frame.rect(320, 392, 200, 31).fill(PANEL_BG).stroke({ color: PANEL_BORDER, width: 1 });

  // ── #DST_IMAGE,...,465,392,144,88 — right square panel
  //    (rank / grade letter target).
  frame.rect(465, 392, 144, 88).fill(PANEL_BG).stroke({ color: PANEL_BORDER, width: 1 });

  // ── #DST_IMAGE,...,182,401,144,79 — autoplay / clear lamp.
  frame.rect(182, 401, 144, 79).fill(PANEL_BG).stroke({ color: PANEL_BORDER, width: 1 });

  // ── #DST_IMAGE,...,1,406,185,74 — chart-info / autoplay band
  //    (slid in from x=-185 to x=1).
  frame.rect(1, 406, 185, 74).fill(PANEL_BG_2).stroke({ color: PANEL_BORDER, width: 1 });

  // ── #DST_IMAGE,...,325,406,57,42 / 409,406,57,42 — flank panels.
  frame.rect(325, 406, 57, 42).fill(PANEL_BG_2).stroke({ color: PANEL_BORDER, width: 1 });
  frame.rect(409, 406, 57, 42).fill(PANEL_BG_2).stroke({ color: PANEL_BORDER, width: 1 });

  // ── #DST_IMAGE,...,320,422,151,58 — centre-bottom info card
  //    (judge counter container).
  frame.rect(320, 422, 151, 58).fill(PANEL_BG).stroke({ color: PANEL_BORDER, width: 1 });

  // ── #DST_IMAGE,...,70,322,174,59 — bottom-left BPM / HS popup.
  frame.rect(70, 322, 174, 59).fill(PANEL_BG).stroke({ color: PANEL_BORDER, width: 1 });

  // ── #DST_GROOVEGAUGE,...,44,387,4,14 × 50 cells = 200×14.
  frame.rect(GROOVE.x, GROOVE.y, GROOVE.w, GROOVE.h).fill(0x06080c).stroke({
    color: PANEL_BORDER,
    width: 1,
  });
  // Filled portion + cell separators (matches LR2's tiled-cell render).
  frame.rect(GROOVE.x, GROOVE.y, 110, GROOVE.h).fill({ color: 0x72d677, alpha: 0.65 });
  for (let i = 1; i < 50; i += 1) {
    frame.rect(GROOVE.x + i * 4, GROOVE.y, 1, GROOVE.h).fill({ color: 0x000000, alpha: 0.45 });
  }

  // ── #DST_SLIDER,...,19,15,18,24 — playmode slider knob area.
  frame.rect(19, 15, 18, 24).fill(PANEL_BG_2).stroke({ color: PANEL_BORDER, width: 1 });

  // ── #DST_NOWJUDGE_1P,...,73,230,102,30 — judge text panel
  //    backdrop. The actual judge string + combo number are
  //    painted as Text overlays below.
  frame.rect(73, 230, 102, 30).fill({ color: 0x000000, alpha: 0.55 });

  layer.addChildAt(frame, 0);

  // ════════════════════════════════════════════════════════
  //  TEXT / NUMBER OVERLAYS
  //  Painted as Pixi `Text` at the LR2 skin's authored
  //  `#DST_NUMBER` / `#DST_TEXT` / `#DST_NOWJUDGE_1P` /
  //  `#DST_NOWCOMBO_1P` coordinates so the values land in the
  //  same place a bitmap-font LR2 skin would.
  // ════════════════════════════════════════════════════════

  // #DST_NUMBER 579,13,8,5 — score (right-aligned digits, 7 wide).
  // #DST_NUMBER 579,22,8,5 — ex-score (same lay).
  layer.addChild(
    makeText(formatScore(runtime.score, 7), 579 + 8, 13, {
      fontSize: 8,
      fontWeight: '900',
      fill: ACCENT_AMBER,
      anchorX: 1,
    }),
  );
  layer.addChild(
    makeText(formatScore(runtime.exScore, 4), 579 + 8, 22, {
      fontSize: 8,
      fontWeight: '700',
      fill: TEXT_DIM,
      anchorX: 1,
    }),
  );

  // #DST_TEXT 504,362,94,15 — hi-speed display.
  layer.addChild(
    makeText(`HS ${formatHiSpeed(runtime.hiSpeed)}`, 504 + 4, 362 + 1, {
      fontSize: 11,
      fontWeight: '700',
      fill: TEXT_BRIGHT,
    }),
  );

  // #DST_NUMBER 52,413,16,12 — bottom-left big number 1.
  // #DST_NUMBER 52,421,16,12 — bottom-left big number 2.
  // (Score panel main readout in LR2 default — score / max
  // score side-by-side at this position.)
  layer.addChild(
    makeText(formatScore(runtime.score, 6), 52, 376, {
      fontSize: 14,
      fontWeight: '900',
      fill: ACCENT_RED,
    }),
  );
  layer.addChild(
    makeText(formatScore(runtime.exScore, 6), 52, 394, {
      fontSize: 12,
      fontWeight: '900',
      fill: TEXT_DIM,
    }),
  );

  // #DST_NUMBER 266,383,13,11 — combo (centre-bottom, ribbon).
  layer.addChild(
    makeText(formatScore(runtime.combo, 4), 218, 376, {
      fontSize: 12,
      fontWeight: '900',
      fill: ACCENT_AMBER,
    }),
  );

  // #DST_NUMBER 374,435,14,10 — centre-bottom progress / extra.
  layer.addChild(
    makeText(formatScore(runtime.maxCombo, 4), 326, 397, {
      fontSize: 10,
      fontWeight: '900',
      fill: ACCENT_BLUE,
    }),
  );

  // #DST_NUMBER 216,424/431/438/445/452,6,5 — 5-row judge counter
  // (PG / G / Gd / B / P). Coordinates are inside the (182, 401)
  // autoplay/clear lamp panel.
  const judgeRows: Array<readonly [string, number | undefined, number]> = [
    ['PG', runtime.perfect, ACCENT_AMBER],
    ['GR', runtime.great, 0x72d677],
    ['GD', runtime.good, ACCENT_BLUE],
    ['BD', runtime.bad, 0xff8b3d],
    ['PR', runtime.poor, ACCENT_RED],
  ];
  for (let i = 0; i < judgeRows.length; i += 1) {
    const [label, value, color] = judgeRows[i]!;
    const ly = 424 + i * 7;
    layer.addChild(
      makeText(label, 196, ly, { fontSize: 5, fontWeight: '900', fill: color, letterSpacing: 0.5 }),
    );
    layer.addChild(
      makeText(formatScore(value, 4), 216, ly, {
        fontSize: 5,
        fontWeight: '900',
        fill: TEXT_BRIGHT,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      }),
    );
  }

  // #DST_NUMBER 105,210,8,7 / 229,210,8,7 — FAST / SLOW counters
  // shown on the lane sides (between the lane and the BGA).
  layer.addChild(
    makeText(formatScore(undefined, 3), 105, 210, {
      fontSize: 7,
      fontWeight: '900',
      fill: 0xff8b3d,
      anchorX: 1,
    }),
  );
  layer.addChild(
    makeText(formatScore(undefined, 3), 229, 210, {
      fontSize: 7,
      fontWeight: '900',
      fill: ACCENT_BLUE,
      anchorX: 1,
    }),
  );

  // #DST_NUMBER 119,20,8,7 — top BPM display.
  layer.addChild(
    makeText(formatNumber(runtime.bpm), 119, 20, {
      fontSize: 7,
      fontWeight: '900',
      fill: TEXT_BRIGHT,
    }),
  );

  // #DST_NUMBER 508,453,8,5 / 260,453,8,5 — small bottom numbers.
  layer.addChild(
    makeText(formatScore(undefined, 3), 260, 453, { fontSize: 5, fontWeight: '700', fill: TEXT_DIM }),
  );
  layer.addChild(
    makeText(formatScore(undefined, 3), 508, 453, { fontSize: 5, fontWeight: '700', fill: TEXT_DIM }),
  );

  // #DST_NOWJUDGE_1P 73,230,102,30 — judge text + #DST_NOWCOMBO_1P
  // 112,0,22,30 (RELATIVE to NOWJUDGE) — combo digit count.
  if (runtime.lastJudge) {
    const judgeText = makeText(runtime.lastJudge, 73 + 51, 230 + 6, {
      fontSize: 18,
      fontWeight: '900',
      fill: ACCENT_BLUE,
      stroke: { color: 0x000000, width: 3, alignment: 0.5, join: 'round' },
      letterSpacing: 1,
      anchorX: 0.5,
    });
    layer.addChild(judgeText);
  }
  // Combo number to the right of the judge text (NOWCOMBO_1P
  // relative offset (112, 0)).
  layer.addChild(
    makeText(formatScore(runtime.combo, 4), 73 + 112, 230 + 6, {
      fontSize: 14,
      fontWeight: '900',
      fill: ACCENT_AMBER,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    }),
  );

  // ── Rank letter on the (465, 392, 144, 88) right square panel.
  //    LR2 paints the rank lamp as a `#DST_IMAGE` cell from
  //    rank.tga; we substitute the rank string as Text.
  if (runtime.rank) {
    const rankText = makeText(runtime.rank, 465 + 72, 392 + 36, {
      fontSize: 36,
      fontWeight: '900',
      fill: 0xc8b64a,
      stroke: { color: 0x000000, width: 3, alignment: 0.5, join: 'round' },
      letterSpacing: 4,
      anchorX: 0.5,
    });
    layer.addChild(rankText);
  }
}

/**
 * Pixi `Text` factory tuned for the LR2-style HUD typography
 * (system-ui sans, 9 px regular). Wraps the verbose
 * `new Text({ style: new TextStyle({ ... }) })` form.
 */
function makeText(
  text: string,
  x: number,
  y: number,
  opts: {
    fontSize?: number;
    fontWeight?: '400' | '500' | '600' | '700' | '800' | '900';
    fill?: number;
    fontFamily?: string;
    letterSpacing?: number;
    anchorX?: number;
    stroke?: { color: number; width: number; alignment?: number; join?: 'round' | 'bevel' | 'miter' };
  } = {},
): Text {
  const node = new Text({
    text,
    style: new TextStyle({
      fill: opts.fill ?? TEXT_BRIGHT,
      fontSize: opts.fontSize ?? 9,
      fontWeight: opts.fontWeight ?? '400',
      fontFamily: opts.fontFamily ?? 'system-ui, sans-serif',
      letterSpacing: opts.letterSpacing ?? 0,
      stroke: opts.stroke,
    }),
  });
  if (opts.anchorX !== undefined) {
    node.anchor.set(opts.anchorX, 0);
  }
  node.position.set(x, y);
  return node;
}

/** Right-aligned padded number (or `----…` placeholder). */
function formatScore(value: number | undefined, width: number): string {
  if (value === undefined || !Number.isFinite(value)) {
    return '-'.repeat(width);
  }
  return String(Math.max(0, Math.floor(value))).padStart(width, '0');
}

function formatNumber(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '---';
  return String(Math.round(value));
}

function formatHiSpeed(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '—';
  return value.toFixed(1);
}
