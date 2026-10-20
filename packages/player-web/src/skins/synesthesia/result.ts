import { Container, Graphics } from 'pixi.js';
import { drawFrame, drawReticle } from './draw.ts';
import {
  burstParticlePosition,
  burstParticles,
  emberColor,
  hsvToHex,
  projectPoint,
  rotateY,
  starfieldPoint,
} from './space.ts';
import {
  SYN_AMBER,
  SYN_CYAN,
  SYN_DEEP,
  SYN_DIM,
  SYN_DISPLAY_FONT,
  SYN_EMBER,
  SYN_FLARE,
  SYN_MAGENTA,
  SYN_MIST,
  SYN_RED,
  SYN_TEXT_FONT,
  SYN_VOID,
  SYN_WHITE,
  sceneHue,
} from './style.ts';
import {
  easeOutBack,
  easeOutCubic,
  resolveResultLamp,
  resolveResultTrackRows,
  rollUpValue,
  stageProgress,
  resolveResultVerdict,
} from '@be-music/skin-sdk';
import { resolveResultGrid } from './result-grid.ts';
import { addSkinText, type PixiResultFrame, type PixiResultSkin, type SkinTextOptions } from '../pixi-kit/index.ts';

/** How fast the entrance timeline plays: the choreography below is authored at 1x and runs 1.3x, so the card settles
 * sooner without changing its order or easing. */
const ENTRANCE_PACE = 1.3;
const ROLL_DELAY_MS = 700;
const ROLL_MS = 1100;
const RANK_DELAY_MS = 1600;

const RANK_BURST = burstParticles(29, 260);

export const synesthesiaResultSkin: PixiResultSkin = { render: (frame) => renderSynesthesiaResult(frame) };

/**
 * Synesthesia result, in the light of a cosmic particle world: a black void with ember dust and a floor of light
 * points; the verdict condenses out of wide-tracked light, hairline frames fade up in sequence while counters roll,
 * graphs draw as glowing filaments, and the rank letter ignites in a burst of sparks the moment it lands — a lock-on
 * reticle snapping shut on it.
 */
export function renderSynesthesiaResult(frame: PixiResultFrame): void {
  const { result, designWidth, designHeight, nowMs, rankLabel, layer } = frame;
  // Panels sit on the landscape grid, or stack on a portrait stage (see resolveResultGrid).
  const grid = resolveResultGrid(designWidth, designHeight);
  const portrait = designHeight > designWidth;
  const margin = grid.margin;
  // Effects off: skip the entrance and render the settled result.
  const elapsed = frame.effects === 'off' ? Number.POSITIVE_INFINITY : frame.elapsedMs * ENTRANCE_PACE;
  const seconds = nowMs / 1000;
  const hue = sceneHue(seconds);
  const accent = hsvToHex(hue, 0.6, 1);
  const cleared = result.cleared;
  const verdictColor = cleared ? SYN_AMBER : SYN_RED;
  const exMax = Math.max(0, result.score.total * 2);
  const roll = stageProgress(elapsed, ROLL_DELAY_MS, ROLL_MS);

  const group = (label: string): { root: Container; g: Graphics } => {
    const root = new Container();
    root.label = `synesthesia-result/${label}`;
    const g = new Graphics();
    root.addChild(g);
    layer.addChild(root);
    return { root, g };
  };
  const text = (target: Container, value: string, x: number, y: number, options: SkinTextOptions) =>
    addSkinText(target, value, x, y, options);
  /** Fade + rise a group in. */
  const rise = (root: Container, delayMs: number, distance = 18, durationMs = 520): void => {
    const eased = easeOutCubic(stageProgress(elapsed, delayMs, durationMs));
    root.y = distance * (1 - eased);
    root.alpha = eased;
  };
  const display = (size: number, fill: number, extra: SkinTextOptions = {}): SkinTextOptions => ({
    size,
    fill,
    fontFamily: SYN_DISPLAY_FONT,
    ...extra,
  });
  // Labels read at 9 px on the landscape stage; the portrait stage is shown smaller on a phone, so they go up to 10.
  const labelSize = portrait ? 10 : 9;
  const label = (value: string, x: number, y: number, target: Container, fill: number = SYN_DIM, maxWidth?: number) =>
    text(target, value, x, y, display(labelSize, fill, { letterSpacing: 2, maxWidth }));

  // Space: warm black, dust pouring out of the vanishing point, and a floor of points.
  const space = group('space');
  const bands: ReadonlyArray<readonly [number, number]> = [
    [SYN_DEEP, 0.3],
    [0x070201, 0.55],
    [0x040100, 0.8],
    [SYN_VOID, 1],
  ];
  let top = 0;
  for (const [color, until] of bands) {
    const bottom = designHeight * until;
    space.g.rect(0, top, designWidth, bottom - top).fill(color);
    top = bottom;
  }
  const light = new Graphics();
  light.blendMode = 'add';
  space.root.addChild(light);
  const horizon = designHeight * 0.74;
  const vanishX = designWidth / 2;
  const vanishY = designHeight * 0.45;
  for (let index = 0; index < 260; index += 1) {
    const point = starfieldPoint(index, seconds, { spread: 560, near: 20, far: 900, speed: 90 });
    const projected = projectPoint(point, vanishX, vanishY, 180);
    if (!projected.visible) continue;
    const nearness = Math.min(1, projected.scale);
    const color = index % 9 === 0 ? SYN_CYAN : index % 13 === 0 ? SYN_MAGENTA : emberColor(0.35 + 0.65 * nearness);
    const size = 0.5 + 1.3 * nearness;
    light
      .rect(projected.x - size / 2, projected.y - size / 2, size, size)
      .fill({ color, alpha: 0.25 + 0.6 * nearness });
  }
  const floor = (x: number, z: number) => projectPoint({ x, y: 130, z }, vanishX, horizon, 200);
  const offset = (seconds * 110) % 100;
  for (let z = 100 - offset; z < 2600; z += 100) {
    const nearness = 1 - z / 2600;
    const size = 0.6 + 1.4 * nearness * nearness;
    const color = emberColor(0.3 + 0.65 * nearness);
    const alpha = 0.12 + 0.7 * nearness * nearness;
    for (let x = -1400; x <= 1400; x += 50) {
      const point = floor(x, z);
      if (point.x < -4 || point.x > designWidth + 4) continue;
      light.rect(point.x - size / 2, point.y - size / 2, size, size);
    }
    // One fill per row: its points share a colour and alpha and never overlap.
    light.fill({ color, alpha });
  }

  // Verdict: tracking condenses from wide to settled while it fades in.
  const verdict = group('verdict');
  const verdictT = easeOutCubic(stageProgress(elapsed, 100, 900));
  verdict.g.rect(0, 44, designWidth, 1).fill({ color: verdictColor, alpha: 0.5 * verdictT });
  text(verdict.root, resolveResultVerdict(result), margin, 14, {
    ...display(15, SYN_WHITE),
    letterSpacing: 6 + 22 * (1 - verdictT),
    alpha: verdictT,
    dropShadow: { color: verdictColor, distance: 0, blur: 12, alpha: 1 },
  });

  // Rank: sparks burst outward as the letter ignites.
  const rank = group('rank');
  const rankBox = grid.rank;
  const rankCx = rankBox.x + rankBox.w / 2;
  // The rank sits between the DJ LEVEL label and the rate, clear of both.
  const rankCy = rankBox.y + Math.round(rankBox.h / 2);
  const topRank = rankLabel === 'AAA' || rankLabel === 'AA';
  const rankColor = topRank ? SYN_AMBER : accent;
  glass(rank.g, rankBox.x, rankBox.y, rankBox.w, rankBox.h, rankColor);
  label('DJ LEVEL', rankBox.x + 14, rankBox.y + 12, rank.root, rankColor);
  const burstT = stageProgress(elapsed, RANK_DELAY_MS, 1100);
  if (burstT > 0 && burstT < 1) {
    for (const particle of RANK_BURST) {
      const life = burstT / particle.life;
      if (life >= 1) continue;
      const position = burstParticlePosition(particle, life, 120, 30);
      const point = projectPoint(rotateY(position, seconds * 0.4), rankCx, rankCy, 240);
      if (!point.visible) continue;
      const color = particle.hueShift > 0.06 ? SYN_CYAN : emberColor(1 - life * 0.7);
      rank.g
        .circle(point.x, point.y, (1 + 2.5 * particle.size) * point.scale)
        .fill({ color, alpha: 0.12 * (1 - life) });
      rank.g
        .circle(point.x, point.y, (0.5 + 0.8 * particle.size) * point.scale)
        .fill({ color: SYN_WHITE, alpha: 1 - life });
    }
  }
  const stamp = stageProgress(elapsed, RANK_DELAY_MS, 420);
  if (stamp > 0) {
    // Lock-on: brackets snap shut on the letter as it lands.
    const snap = easeOutCubic(Math.min(1, stamp * 1.6));
    const lock = 46 + 60 * (1 - snap);
    drawReticle(rank.g, rankCx - lock, rankCy - lock, lock * 2, lock * 2, SYN_FLARE, 0.4 + 0.5 * snap, {
      arm: 12,
      width: 1.75,
      cross: stamp < 1,
    });
  }
  const letter = new Container();
  rank.root.addChild(letter);
  const heartbeat = (1 - ((seconds * 1.4) % 1)) ** 4;
  text(letter, rankLabel, rankCx, rankCy, {
    ...display(rankLabel.length >= 3 ? 28 : 40, SYN_WHITE),
    anchorX: 0.5,
    anchorY: 0.5,
    maxWidth: 130,
    alpha: Math.min(1, stamp * 2),
    dropShadow: { color: rankColor, distance: 0, blur: 14 + 8 * heartbeat, alpha: 1 },
  });
  letter.pivot.set(rankCx, rankCy);
  letter.position.set(rankCx, rankCy);
  letter.scale.set(stamp >= 1 ? 1 + 0.03 * heartbeat : 1.8 - 0.8 * easeOutBack(stamp));
  const rate = frame.ratePercent * easeOutCubic(roll);
  text(rank.root, `${rate.toFixed(2)}%`, rankCx, rankBox.y + rankBox.h - 14, {
    ...display(10, SYN_MIST),
    anchorX: 0.5,
    anchorY: 0.5,
    letterSpacing: 1,
  });
  rise(rank.root, 250);

  // Metric panels.
  const metrics: ReadonlyArray<readonly [name: string, value: string, fill: number]> = [
    ['SCORE', String(rollUpValue(result.score.score, roll)), SYN_WHITE],
    ['EX SCORE', `${rollUpValue(result.score.exScore, roll)} / ${exMax}`, SYN_WHITE],
    ['MAX COMBO', String(rollUpValue(result.maxCombo, roll)), SYN_AMBER],
    ['GAUGE', `${rollUpValue(Math.round(result.gauge), roll)}%`, cleared ? SYN_AMBER : SYN_RED],
    ['PLAY TIME', `${(result.playSeconds * easeOutCubic(roll)).toFixed(1)}s`, SYN_WHITE],
    ['NOTES', String(rollUpValue(result.score.total, roll)), SYN_WHITE],
  ];
  metrics.forEach(([name, value, fill], index) => {
    const { x, y, w, h } = grid.metrics[index]!;
    const panel = group(`metric-${index}`);
    glass(panel.g, x, y, w, h, accent);
    label(name, x + 14, y + 10, panel.root);
    text(panel.root, value, x + w - 14, y + h - 15, {
      ...display(14, fill),
      anchorX: 1,
      anchorY: 0.5,
      maxWidth: Math.min(120, w - 28),
      dropShadow: { color: fill, distance: 0, blur: 6, alpha: 0.7 },
    });
    rise(panel.root, 320 + index * 80);
  });

  // Judgement rows.
  const judges = group('judgement');
  const judgeBox = grid.judges;
  glass(judges.g, judgeBox.x, judgeBox.y, judgeBox.w, judgeBox.h, SYN_EMBER);
  label('JUDGEMENT', judgeBox.x + 14, judgeBox.y + 12, judges.root, SYN_EMBER);
  const rows: ReadonlyArray<readonly [name: string, count: number, color: number]> = [
    ['PGREAT', result.score.perfect, SYN_FLARE],
    ['GREAT', result.score.great, SYN_AMBER],
    ['GOOD', result.score.good, SYN_CYAN],
    ['BAD', result.score.bad, SYN_MAGENTA],
    ['POOR', result.score.poor, SYN_RED],
  ];
  const judgeTotal = Math.max(1, result.score.total);
  rows.forEach(([name, count, color], index) => {
    const y = grid.rowsTop + index * grid.rowPitch;
    const grow = easeOutCubic(stageProgress(elapsed, ROLL_DELAY_MS + index * 70, ROLL_MS));
    const x = judgeBox.x;
    const barX = x + grid.barOffset;
    judges.g.circle(x + 18, y + 6, 2.5).fill({ color, alpha: 1 });
    judges.g.circle(x + 18, y + 6, 6).fill({ color, alpha: 0.2 });
    label(name, x + 30, y + 2, judges.root, color);
    judges.g.rect(barX, y + 6, grid.barWidth, 1).fill({ color: SYN_DIM, alpha: 0.35 });
    const barW = (grid.barWidth * Math.min(count, judgeTotal) * grow) / judgeTotal;
    if (barW > 0) {
      judges.g.rect(barX, y + 4, barW, 5).fill({ color, alpha: 0.18 });
      judges.g.rect(barX, y + 6, barW, 1.5).fill({ color, alpha: 0.95 });
    }
    text(judges.root, String(rollUpValue(count, roll)), x + judgeBox.w - 14, y + 6, {
      ...display(11, SYN_WHITE),
      anchorX: 1,
      anchorY: 0.5,
    });
  });
  rise(judges.root, 520);

  // Graphs as glowing filaments drawing in.
  const graphs = group('graphs');
  // The two filaments share the judgement rows' top and bottom lines.
  const graphBox = grid.graphs;
  const graphX = graphBox.x + 14;
  const graphW = graphBox.x + graphBox.w - 14 - graphX;
  const graphH = (grid.graphsBottom - grid.graphsTop - 24) / 2;
  glass(graphs.g, graphBox.x, graphBox.y, graphBox.w, graphBox.h, accent);
  label(`${(result.gaugeType ?? 'GROOVE').toUpperCase()} GAUGE`, graphX, graphBox.y + 12, graphs.root);
  label('EX SCORE', graphX, grid.graphsTop + graphH + 12, graphs.root);
  const draw = easeOutCubic(stageProgress(elapsed, ROLL_DELAY_MS + 150, ROLL_MS + 300));
  filament(
    graphs.g,
    graphX,
    grid.graphsTop,
    graphW,
    graphH,
    result.gaugeHistory.map((s) => ({ x: s.progress, y: s.value / 100 })),
    cleared ? SYN_AMBER : SYN_RED,
    draw,
  );
  filament(
    graphs.g,
    graphX,
    grid.graphsBottom - graphH,
    graphW,
    graphH,
    result.scoreHistory.map((s) => ({ x: s.progress, y: exMax > 0 ? s.exScore / exMax : 0 })),
    SYN_CYAN,
    draw,
  );
  rise(graphs.root, 600);

  // Track column: the chart's card, its facts, and the clear lamp glowing at the foot.
  const track = group('track');
  const { x: trackX, y: trackTop, w: trackW, h: trackH } = grid.track;
  glass(track.g, trackX, trackTop, trackW, trackH, accent);
  const trackTextX = trackX + 14;
  const trackTextW = trackW - 28;
  label('TRACK', trackTextX, trackTop + 12, track.root, SYN_EMBER);
  // Genre, title, artist — the order every built-in skin uses.
  const genreLift = result.song.genre ? 14 : 0;
  if (result.song.genre) {
    label(result.song.genre.toUpperCase(), trackTextX, trackTop + 30, track.root, SYN_DIM, trackTextW);
  }
  text(track.root, result.song.title || 'Untitled chart', trackTextX, trackTop + 30 + genreLift, {
    size: 15,
    weight: '500',
    fill: SYN_WHITE,
    fontFamily: SYN_TEXT_FONT,
    maxWidth: trackTextW,
    dropShadow: { color: accent, alpha: 0.7, blur: 6, distance: 0 },
  });
  text(track.root, result.song.artist ?? '', trackTextX, trackTop + 52 + genreLift, {
    size: 10,
    weight: '300',
    fill: SYN_MIST,
    fontFamily: SYN_TEXT_FONT,
    maxWidth: trackTextW,
  });
  track.g.rect(trackTextX, trackTop + 88, trackTextW, 1).fill({ color: accent, alpha: 0.3 });
  // The fact rows run down one column (landscape) or fill two side by side (portrait), 34 / 30 px apart.
  const columns = grid.trackColumns;
  const columnGap = 24;
  const columnW = (trackTextW - columnGap * (columns - 1)) / columns;
  const rowPitch = columns > 1 ? 30 : 34;
  resolveResultTrackRows(result).forEach((row, index) => {
    const columnX = trackTextX + (index % columns) * (columnW + columnGap);
    const rowY = trackTop + 100 + Math.floor(index / columns) * rowPitch;
    label(row.label, columnX, rowY + 4, track.root, SYN_DIM, columnW - 50);
    text(track.root, row.value, columnX + columnW, rowY + 9, {
      ...display(columns > 1 ? 13 : 15, SYN_WHITE),
      anchorX: 1,
      anchorY: 0.5,
      maxWidth: columns > 1 ? 56 : trackTextW - 90,
    });
    track.g.rect(columnX, rowY + 24, columnW, 1).fill({ color: SYN_DIM, alpha: 0.3 });
  });
  const lamp = resolveResultLamp(result);
  const lampColor =
    lamp === 'PERFECT' ? SYN_WHITE : lamp === 'FULL COMBO' ? SYN_CYAN : lamp === 'CLEAR' ? SYN_AMBER : SYN_RED;
  // The lamp sits 16 px off the card's foot (10 px under two fact columns, which take the room).
  const lampY = trackTop + trackH - (columns > 1 ? 44 : 50);
  drawFrame(track.g, trackTextX, lampY, trackTextW, 34, lampColor, { fill: 0.6, arm: 8 });
  text(track.root, lamp, trackTextX + trackTextW / 2, lampY + 17, {
    ...display(14, SYN_WHITE),
    anchorX: 0.5,
    anchorY: 0.5,
    letterSpacing: 4,
    maxWidth: trackTextW - 16,
    dropShadow: { color: lampColor, distance: 0, blur: 12, alpha: 1 },
  });
  rise(track.root, 680);

  // Total score.
  const total = group('total');
  total.g.rect(0, grid.totalY, designWidth, 1).fill({ color: accent, alpha: 0.4 });
  label('TOTAL SCORE', margin, grid.totalY + 18, total.root, accent);
  text(total.root, String(rollUpValue(result.score.score, roll)), 150, grid.totalY + 22, {
    ...display(16, SYN_WHITE),
    anchorY: 0.5,
    letterSpacing: 2,
    dropShadow: { color: accent, distance: 0, blur: 10, alpha: 0.9 },
  });
  rise(total.root, 440, 10);
}

function glass(graphics: Graphics, x: number, y: number, w: number, h: number, rim: number): void {
  drawFrame(graphics, x, y, w, h, rim, { fill: 0.6, arm: 10 });
}

/** Polyline drawn up to `progress` of its horizontal span, stroked twice (bloom + filament) with a glowing head. */
function filament(
  graphics: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  points: ReadonlyArray<{ x: number; y: number }>,
  color: number,
  progress: number,
): void {
  graphics.rect(x, y + h, w, 1).fill({ color: SYN_DIM, alpha: 0.3 });
  if (points.length === 0 || progress <= 0) return;
  const clamp = (value: number) => (Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0);
  const path: number[] = [];
  let previous = points[0]!;
  path.push(x + clamp(previous.x) * w, y + (1 - clamp(previous.y)) * h);
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index]!;
    if (clamp(point.x) > progress) {
      const span = clamp(point.x) - clamp(previous.x);
      const t = span > 0 ? (progress - clamp(previous.x)) / span : 0;
      path.push(x + progress * w, y + (1 - (clamp(previous.y) + (clamp(point.y) - clamp(previous.y)) * t)) * h);
      break;
    }
    path.push(x + clamp(point.x) * w, y + (1 - clamp(point.y)) * h);
    previous = point;
  }
  if (path.length < 4) path.push(path[0]! + 0.5, path[1]!);
  graphics.poly(path, false).stroke({ color, width: 5, alpha: 0.12 });
  graphics.poly(path, false).stroke({ color, width: 1.5, alpha: 0.95 });
  const headX = path[path.length - 2]!;
  const headY = path[path.length - 1]!;
  graphics.circle(headX, headY, 6).fill({ color, alpha: 0.2 });
  graphics.circle(headX, headY, 2).fill({ color: SYN_WHITE, alpha: 1 });
}
