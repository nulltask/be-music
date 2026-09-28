import { Container, Graphics, Text, TextStyle, type Color } from 'pixi.js';
import type { BeMusicResultFrame, BeMusicResultSkin } from '../../../skin/be-music/types.ts';
import { DEFAULT_DISPLAY_FONT, DEFAULT_HEADLINE_FONT, DEFAULT_TEXT_FONT } from '../fonts.ts';
import {
  PHANTOM_BLACK,
  PHANTOM_CHARCOAL,
  PHANTOM_CYAN,
  PHANTOM_GOLD,
  PHANTOM_INK,
  PHANTOM_ORANGE,
  PHANTOM_RED,
  PHANTOM_RED_DEEP,
  PHANTOM_RED_HOT,
  PHANTOM_SLATE,
  PHANTOM_WHITE,
  easeOutBack,
  easeOutCubic,
  halftoneField,
  hash01,
  parallelogramPoints,
  rollUpValue,
  stageProgress,
  starburstPoints,
} from '../phantom-style.ts';

/** Default-family result entrance timeline (ms from scene start): counters roll up, then the rank badge lands. */
const RESULT_ROLL_DELAY_MS = 760;
const RESULT_ROLL_MS = 1000;
const RESULT_RANK_DELAY_MS = 1500;

export const phantomResultSkin: BeMusicResultSkin = { render: (frame) => renderPhantomResult(frame) };

/**
 * Phantom result: an entrance timeline (red slash sweep, verdict slam, staggered plates, counter roll-up, growing
 * bars, graphs drawing in, rank stamp) over ambient loops (drifting halftone, scrolling kicker, streaks, rank pulse).
 */
export function renderPhantomResult(frame: BeMusicResultFrame): void {
  const { result, designWidth, designHeight, elapsedMs: elapsed, nowMs: now, rankLabel } = frame;
  const rate = frame.ratePercent;
  const seconds = now / 1000;
  const layer = frame.layer;

  /** A positioned sub-container holding one panel's graphics + texts, so the panel can slide / scale as a unit. */
  const group = (label: string): { root: Container; g: Graphics } => {
    const root = new Container();
    root.label = `default-result/${label}`;
    const g = new Graphics();
    root.addChild(g);
    layer.addChild(root);
    return { root, g };
  };
  const addText = (
    target: Container,
    text: string,
    x: number,
    y: number,
    options: {
      size?: number;
      weight?: '400' | '500' | '600' | '700' | '800' | '900';
      fill?: number | Color;
      fontFamily?: string;
      letterSpacing?: number;
      anchorX?: number;
      anchorY?: number;
      maxWidth?: number;
      stroke?: { color: number; width: number; alignment?: number; join?: 'round' | 'bevel' | 'miter' };
      skew?: number;
    } = {},
  ): Text => {
    const node = new Text({
      text,
      style: new TextStyle({
        fill: options.fill ?? PHANTOM_WHITE,
        fontSize: options.size ?? 10,
        fontWeight: options.weight ?? '500',
        fontFamily: options.fontFamily ?? DEFAULT_TEXT_FONT,
        letterSpacing: options.letterSpacing ?? 0,
        stroke: options.stroke,
      }),
    });
    node.anchor.set(options.anchorX ?? 0, options.anchorY ?? 0);
    node.position.set(x, y);
    node.skew.set(options.skew ?? 0, 0);
    if (options.maxWidth !== undefined && node.width > options.maxWidth) {
      node.scale.x = options.maxWidth / node.width;
    }
    target.addChild(node);
    return node;
  };
  /** Slide a group in from an offset with an ease-out, fading as it lands. */
  const slideIn = (root: Container, delayMs: number, fromX: number, fromY: number, durationMs = 320): void => {
    const eased = easeOutCubic(stageProgress(elapsed, delayMs, durationMs));
    root.position.set(fromX * (1 - eased), fromY * (1 - eased));
    root.alpha = Math.min(1, eased * 1.6);
  };
  /** Slam a group down onto `(cx, cy)` from an oversized scale with an overshoot. */
  const slam = (
    root: Container,
    delayMs: number,
    cx: number,
    cy: number,
    fromScale: number,
    durationMs = 360,
  ): void => {
    const t = stageProgress(elapsed, delayMs, durationMs);
    const scale = fromScale + (1 - fromScale) * easeOutBack(t);
    root.pivot.set(cx, cy);
    root.position.set(cx, cy);
    root.scale.set(Math.max(0, scale));
    root.alpha = Math.min(1, t * 3);
  };

  const cleared = result.cleared;
  const statusColor = cleared ? PHANTOM_WHITE : PHANTOM_RED_HOT;
  const exMax = Math.max(0, result.score.total * 2);
  const display = (size: number, fill: number) => ({
    size,
    fill,
    fontFamily: DEFAULT_DISPLAY_FONT,
    skew: -0.18,
  });
  // Counters roll up together once the plates have landed.
  const roll = stageProgress(elapsed, RESULT_ROLL_DELAY_MS, RESULT_ROLL_MS);

  // Ground: ink base, then the red slash sweeping in from the right with a drifting halftone.
  const ground = group('ground');
  ground.g.rect(0, 0, designWidth, designHeight).fill(PHANTOM_BLACK);
  const slash = group('slash');
  slash.g.poly([392, 48, designWidth, 48, designWidth, designHeight, 196, designHeight]).fill(PHANTOM_RED);
  const drift = (seconds * 9) % 11;
  for (const dot of halftoneField({
    x: 196 - 11,
    y: 48,
    w: designWidth - 196 + 11,
    h: designHeight - 48,
    pitch: 11,
    maxRadius: 4.6,
    direction: { x: 1, y: -0.3 },
  })) {
    const dx = dot.x + drift;
    if ((dx - 392) * (designHeight - 48) + (dot.y - 48) * (392 - 196) > 0 && dx <= designWidth) {
      slash.g.circle(dx, dot.y, dot.r).fill({ color: PHANTOM_INK, alpha: 0.5 });
    }
  }
  slash.g.poly([380, 48, 386, 48, 190, designHeight, 184, designHeight]).fill(PHANTOM_WHITE);
  slideIn(slash.root, 0, 460, 0, 380);
  slash.root.alpha = 1;

  // Speed streaks raking across the whole screen.
  const streaks = group('streaks');
  for (let index = 0; index < 8; index += 1) {
    const speed = 160 + hash01(index + 7) * 220;
    const span = designWidth + 300;
    const sx = ((seconds * speed + hash01(index + 17) * span) % span) - 220;
    const sy = 60 + hash01(index + 27) * (designHeight - 120);
    streaks.g
      .poly(parallelogramPoints(sx, sy, 70 + hash01(index + 37) * 120, 2, 3))
      .fill({ color: PHANTOM_WHITE, alpha: 0.12 + hash01(index + 47) * 0.18 });
  }

  // Header: ink bar with a scrolling sawtooth kicker; the verdict slams onto its slanted tag.
  const header = group('header');
  header.g.rect(0, 0, designWidth, 46).fill(PHANTOM_INK);
  const kickerShift = -((seconds * 36) % 20);
  const teeth: number[] = [kickerShift - 20, 46];
  for (let x = kickerShift - 20; x <= designWidth + 20; x += 20) {
    teeth.push(x, 46, x + 10, 52);
  }
  teeth.push(designWidth + 20, 46);
  header.g.poly(teeth).fill(PHANTOM_RED);
  header.g.rect(0, 45, designWidth, 1).fill(PHANTOM_WHITE);
  const title = group('title');
  addText(
    title.root,
    `${result.song.title}${result.song.artist ? ` / ${result.song.artist}` : ''}`,
    designWidth - 18,
    16,
    {
      size: 13,
      fill: PHANTOM_WHITE,
      fontFamily: DEFAULT_HEADLINE_FONT,
      anchorX: 1,
      maxWidth: 420,
    },
  );
  slideIn(title.root, 260, 120, 0);
  const verdict = group('verdict');
  verdict.g.poly(parallelogramPoints(18, 12, 150, 28, 10)).fill(cleared ? PHANTOM_WHITE : PHANTOM_RED);
  verdict.g.poly(parallelogramPoints(12, 7, 150, 28, 10)).fill(cleared ? PHANTOM_RED : PHANTOM_WHITE);
  addText(verdict.root, cleared ? 'STAGE CLEAR' : 'FAILED', 92, 21, {
    ...display(20, cleared ? PHANTOM_WHITE : PHANTOM_RED),
    letterSpacing: 1.5,
    anchorX: 0.5,
    anchorY: 0.5,
  });
  // A glint sweeps the verdict tag every few seconds once it has landed.
  const glint = (seconds % 3.2) / 0.45;
  if (elapsed > 800 && glint <= 1) {
    verdict.g
      .poly(parallelogramPoints(12 + glint * 136, 7, 12, 28, 10))
      .fill({ color: cleared ? PHANTOM_WHITE : PHANTOM_RED, alpha: 0.55 });
  }
  slam(verdict.root, 120, 88, 21, 2.6);

  // Rank panel slides in from the left; the burst pops, then the letter stamps down on it.
  const topRank = rankLabel === 'AAA' || rankLabel === 'AA';
  const rankPanel = group('rank-panel');
  rankPanel.g
    .poly(parallelogramPoints(18, 72, 172, 148, -8))
    .fill(PHANTOM_INK)
    .stroke({ color: PHANTOM_WHITE, width: 2 });
  rankPanel.g.poly(parallelogramPoints(26, 66, 56, 16, 6)).fill(PHANTOM_RED);
  addText(rankPanel.root, 'RANK', 38, 74, { ...display(11, PHANTOM_WHITE), anchorY: 0.5 });
  slideIn(rankPanel.root, 280, -220, 0);

  const burst = group('rank-burst');
  // Ambient: a slow wobble plus a heartbeat pulse keeps the badge alive after it lands.
  const heartbeat = (1 - ((seconds * 1.6) % 1)) ** 4;
  burst.g
    .poly(starburstPoints(106, 134, 60, 44, 18, seconds * 0.35, 0.15, 11))
    .fill({ color: topRank ? PHANTOM_RED : PHANTOM_RED_DEEP, alpha: 0.9 });
  burst.g
    .poly(starburstPoints(106, 134, 50, 33, 13, -0.15 + Math.sin(seconds * 1.3) * 0.06, 0.2, rankLabel.length + 3))
    .fill(topRank ? PHANTOM_GOLD : PHANTOM_RED)
    .stroke({ color: PHANTOM_WHITE, width: 2, join: 'miter' });
  slam(burst.root, RESULT_RANK_DELAY_MS, 106, 134, 0, 420);
  if (stageProgress(elapsed, RESULT_RANK_DELAY_MS, 420) >= 1) {
    burst.root.scale.set(1 + 0.05 * heartbeat);
  }
  const letter = group('rank-letter');
  addText(letter.root, rankLabel, 108, 134, {
    ...display(rankLabel.length >= 3 ? 34 : 50, topRank ? PHANTOM_INK : PHANTOM_WHITE),
    anchorX: 0.5,
    anchorY: 0.5,
    stroke: { color: topRank ? PHANTOM_WHITE : PHANTOM_INK, width: 4, alignment: 0.5, join: 'miter' },
    maxWidth: 96,
  });
  slam(letter.root, RESULT_RANK_DELAY_MS + 220, 106, 134, 2.4, 300);
  // The rate sits in front of the badge so the pulsing burst never covers it.
  const rateGroup = group('rank-rate');
  const shownRate = rate * easeOutCubic(roll);
  addText(rateGroup.root, `${shownRate.toFixed(1)}%`, 104, 202, {
    ...display(18, PHANTOM_WHITE),
    anchorX: 0.5,
    anchorY: 0.5,
  });
  slideIn(rateGroup.root, 280, -220, 0);

  // Metric plates fly in from the right one after another; their values roll up.
  const metrics: ReadonlyArray<readonly [x: number, y: number, label: string, value: string, fill: number]> = [
    [228, 80, 'SCORE', String(rollUpValue(result.score.score, roll)), PHANTOM_WHITE],
    [228, 126, 'EX SCORE', `${rollUpValue(result.score.exScore, roll)} / ${exMax}`, PHANTOM_WHITE],
    [228, 172, 'MAX COMBO', String(rollUpValue(result.maxCombo, roll)), PHANTOM_GOLD],
    [434, 80, 'GAUGE', `${rollUpValue(Math.round(result.gauge), roll)}%`, statusColor],
    [434, 126, 'PLAY TIME', `${(result.playSeconds * easeOutCubic(roll)).toFixed(1)}s`, PHANTOM_WHITE],
    [434, 172, 'NOTES', String(rollUpValue(result.score.total, roll)), PHANTOM_WHITE],
  ];
  metrics.forEach(([x, y, label, value, fill], index) => {
    const plate = group(`metric-${index}`);
    renderMetric(plate.root, plate.g, x, y, label, value, fill);
    slideIn(plate.root, 340 + index * 70, 260, 0);
  });

  // Judgement tally — ransom-note chips; each row slides in, then its count bar grows while the number rolls up.
  const judgePanel = group('judgement');
  judgePanel.g
    .poly(parallelogramPoints(18, 246, 286, 180, -8))
    .fill(PHANTOM_INK)
    .stroke({ color: PHANTOM_WHITE, width: 2 });
  judgePanel.g.poly(parallelogramPoints(26, 240, 96, 16, 6)).fill(PHANTOM_RED);
  addText(judgePanel.root, 'JUDGEMENT', 38, 248, { ...display(11, PHANTOM_WHITE), letterSpacing: 1, anchorY: 0.5 });
  slideIn(judgePanel.root, 560, -260, 0);
  const judges: Array<readonly [string, number, number]> = [
    ['PGREAT', result.score.perfect, PHANTOM_WHITE],
    ['GREAT', result.score.great, PHANTOM_GOLD],
    ['GOOD', result.score.good, PHANTOM_CYAN],
    ['BAD', result.score.bad, PHANTOM_ORANGE],
    ['POOR', result.score.poor, PHANTOM_RED_HOT],
  ];
  const judgeTotal = Math.max(1, result.score.total);
  for (let i = 0; i < judges.length; i += 1) {
    const jy = 270 + i * 29;
    const [label, count, fill] = judges[i]!;
    const inverted = i % 2 === 1;
    const row = group(`judge-${i}`);
    row.g.poly(parallelogramPoints(34, jy, 70, 20, inverted ? -5 : 5)).fill(inverted ? PHANTOM_WHITE : PHANTOM_RED);
    addText(row.root, label, 70, jy + 10, {
      ...display(13, inverted ? PHANTOM_INK : PHANTOM_WHITE),
      anchorX: 0.5,
      anchorY: 0.5,
      maxWidth: 60,
    });
    row.g.poly(parallelogramPoints(112, jy + 14, 140, 4, 3)).fill(PHANTOM_SLATE);
    const barProgress = easeOutCubic(stageProgress(elapsed, RESULT_ROLL_DELAY_MS + i * 60, RESULT_ROLL_MS));
    if (count > 0 && barProgress > 0) {
      row.g
        .poly(
          parallelogramPoints(
            112,
            jy + 14,
            Math.max(3, ((140 * Math.min(count, judgeTotal)) / judgeTotal) * barProgress),
            4,
            3,
          ),
        )
        .fill(fill);
    }
    addText(row.root, String(rollUpValue(count, roll)), 282, jy - 2, { ...display(20, fill), anchorX: 1 });
    slideIn(row.root, 640 + i * 60, -200, 0, 280);
  }

  // Run graphs rise in from below and draw left to right.
  const run = group('run');
  run.g
    .poly(parallelogramPoints(324, 246, 298, 180, -8))
    .fill(PHANTOM_INK)
    .stroke({ color: PHANTOM_WHITE, width: 2 });
  run.g.poly(parallelogramPoints(332, 240, 56, 16, 6)).fill(PHANTOM_RED);
  addText(run.root, 'RUN', 346, 248, { ...display(11, PHANTOM_WHITE), letterSpacing: 1, anchorY: 0.5 });
  run.g.rect(342, 272, 264, 62).fill(PHANTOM_CHARCOAL);
  run.g.rect(342, 346, 264, 62).fill(PHANTOM_CHARCOAL);
  addText(run.root, 'GAUGE', 352, 278, { ...display(10, PHANTOM_RED_HOT), letterSpacing: 1 });
  addText(run.root, 'EX SCORE', 352, 352, { ...display(10, PHANTOM_RED_HOT), letterSpacing: 1 });
  const graphProgress = easeOutCubic(stageProgress(elapsed, RESULT_ROLL_DELAY_MS + 100, RESULT_ROLL_MS + 300));
  drawSeries(
    run.g,
    420,
    282,
    176,
    44,
    result.gaugeHistory.map((sample) => ({ x: sample.progress, y: sample.value / 100 })),
    cleared ? PHANTOM_WHITE : PHANTOM_RED_HOT,
    graphProgress,
  );
  drawSeries(
    run.g,
    420,
    356,
    176,
    44,
    result.scoreHistory.map((sample) => ({ x: sample.progress, y: exMax > 0 ? sample.exScore / exMax : 0 })),
    PHANTOM_GOLD,
    graphProgress,
  );
  slideIn(run.root, 620, 0, 160);

  // Footer rises; the total score rolls up with the rest.
  const footer = group('footer');
  footer.g.rect(0, designHeight - 36, designWidth, 36).fill(PHANTOM_INK);
  footer.g.rect(0, designHeight - 36, designWidth, 2).fill(PHANTOM_WHITE);
  footer.g.poly(parallelogramPoints(12, designHeight - 28, 118, 20, 8)).fill(PHANTOM_RED);
  addText(footer.root, 'TOTAL SCORE', 72, designHeight - 18, {
    ...display(13, PHANTOM_WHITE),
    letterSpacing: 1,
    anchorX: 0.5,
    anchorY: 0.5,
  });
  addText(footer.root, String(rollUpValue(result.score.score, roll)), 146, designHeight - 18, {
    ...display(22, PHANTOM_WHITE),
    anchorY: 0.5,
  });
  slideIn(footer.root, 420, 0, 50);

  // Entrance wipe: the screen opens behind an ink slab carrying a giant RESULT slug that tears away to the right with a
  // red leading edge, uncovering the panels as they fly in.
  const wipeT = stageProgress(elapsed, 0, 760);
  if (wipeT < 1) {
    const wipe = group('wipe');
    const eased = wipeT * wipeT * (3 - 2 * wipeT);
    const edge = -120 + eased * (designWidth + 360);
    wipe.g
      .poly([edge + 120, 0, designWidth + 200, 0, designWidth + 200, designHeight, edge, designHeight])
      .fill(PHANTOM_INK);
    wipe.g.poly([edge + 80, 0, edge + 128, 0, edge + 8, designHeight, edge - 40, designHeight]).fill(PHANTOM_RED);
    wipe.g.poly([edge + 136, 0, edge + 142, 0, edge + 22, designHeight, edge + 16, designHeight]).fill(PHANTOM_WHITE);
    addText(wipe.root, 'RESULT', edge + 150 + designWidth / 2, designHeight / 2, {
      ...display(120, PHANTOM_WHITE),
      letterSpacing: 8,
      anchorX: 0.5,
      anchorY: 0.5,
    });
  }
}

function renderMetric(
  target: Container,
  chrome: Graphics,
  x: number,
  y: number,
  label: string,
  value: string,
  fill: number,
): void {
  chrome.poly(parallelogramPoints(x + 4, y + 4, 172, 36, 8)).fill(PHANTOM_INK);
  chrome
    .poly(parallelogramPoints(x, y, 172, 36, 8))
    .fill(PHANTOM_BLACK)
    .stroke({ color: PHANTOM_WHITE, width: 1.5, join: 'miter' });
  const labelText = new Text({
    text: label,
    style: new TextStyle({
      fill: PHANTOM_RED_HOT,
      fontSize: 10,
      fontFamily: DEFAULT_DISPLAY_FONT,
      letterSpacing: 1,
    }),
  });
  labelText.skew.set(-0.18, 0);
  labelText.position.set(x + 12, y + 5);
  target.addChild(labelText);

  const valueText = new Text({
    text: value,
    style: new TextStyle({
      fill,
      fontSize: 22,
      fontFamily: DEFAULT_DISPLAY_FONT,
    }),
  });
  valueText.skew.set(-0.18, 0);
  valueText.anchor.set(1, 0.5);
  valueText.position.set(x + 166, y + 19);
  if (valueText.width > 100) {
    valueText.scale.x = 100 / valueText.width;
  }
  target.addChild(valueText);
}

/** Polyline of `points` inside the rect, drawn up to `progress` (0..1) of the horizontal span. */
function drawSeries(
  chrome: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  points: Array<{ x: number; y: number }>,
  color: number,
  progress = 1,
): void {
  if (points.length === 0) return;
  chrome.rect(x, y + h, w, 1).fill({ color: 0xffffff, alpha: 0.12 });
  if (progress <= 0) return;
  const limit = clamp01(progress);
  const first = points[0]!;
  chrome.moveTo(x + clamp01(first.x) * w, y + (1 - clamp01(first.y)) * h);
  let previous = first;
  for (let i = 1; i < points.length; i += 1) {
    const point = points[i]!;
    if (clamp01(point.x) > limit) {
      // Interpolate the segment that crosses the draw head so the line grows smoothly.
      const span = clamp01(point.x) - clamp01(previous.x);
      const t = span > 0 ? (limit - clamp01(previous.x)) / span : 0;
      const headY = clamp01(previous.y) + (clamp01(point.y) - clamp01(previous.y)) * t;
      chrome.lineTo(x + limit * w, y + (1 - headY) * h);
      break;
    }
    chrome.lineTo(x + clamp01(point.x) * w, y + (1 - clamp01(point.y)) * h);
    previous = point;
  }
  if (points.length === 1) {
    chrome.lineTo(x + clamp01(first.x) * w + 0.5, y + (1 - clamp01(first.y)) * h);
  }
  chrome.stroke({ color, width: 2, alpha: 0.95, alignment: 0.5 });
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
