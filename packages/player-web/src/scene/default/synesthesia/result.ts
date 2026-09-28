import { Container, Graphics } from 'pixi.js';
import type { BeMusicResultFrame, BeMusicResultSkin } from '../../../skin/be-music/types.ts';
import { easeOutBack, easeOutCubic, rollUpValue, stageProgress } from '../phantom-style.ts';
import { addSkinText, type SkinTextOptions } from '../skin-text.ts';
import {
  burstParticlePosition,
  burstParticles,
  hsvToHex,
  projectPoint,
  rotateX,
  rotateY,
  starfieldPoint,
} from './space.ts';
import {
  SYN_AMBER,
  SYN_CYAN,
  SYN_DEEP,
  SYN_DIM,
  SYN_DISPLAY_FONT,
  SYN_GLASS,
  SYN_GREEN,
  SYN_MAGENTA,
  SYN_MIST,
  SYN_RED,
  SYN_TEXT_FONT,
  SYN_VIOLET,
  SYN_VOID,
  SYN_WHITE,
  sceneHue,
} from './style.ts';

const ROLL_DELAY_MS = 700;
const ROLL_MS = 1100;
const RANK_DELAY_MS = 1600;
const RANK_BURST = burstParticles(29, 90);

export const synesthesiaResultSkin: BeMusicResultSkin = { render: (frame) => renderSynesthesiaResult(frame) };

/**
 * Synesthesia result: deep space with streaming stars and a floor grid; the verdict condenses out of wide-tracked
 * light, glass panels fade up in sequence while counters roll, graphs draw as glowing filaments, and the rank letter
 * ignites inside a spinning 3D ring of particles that bursts outward the moment it lands.
 */
export function renderSynesthesiaResult(frame: BeMusicResultFrame): void {
  const { result, designWidth, designHeight, nowMs, rankLabel, layer } = frame;
  // Effects off: skip the entrance and render the settled result.
  const elapsed = frame.effects === 'off' ? Number.POSITIVE_INFINITY : frame.elapsedMs;
  const seconds = nowMs / 1000;
  const hue = sceneHue(seconds);
  const accent = hsvToHex(hue, 0.6, 1);
  const cleared = result.cleared;
  const verdictColor = cleared ? SYN_CYAN : SYN_RED;
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
  const label = (value: string, x: number, y: number, target: Container, fill: number = SYN_DIM) =>
    text(target, value, x, y, display(9, fill, { letterSpacing: 2 }));

  // Space.
  const space = group('space');
  const bands: ReadonlyArray<readonly [number, number]> = [
    [SYN_DEEP, 0.25],
    [0x080620, 0.45],
    [0x05051a, 0.65],
    [0x030410, 0.82],
    [SYN_VOID, 1],
  ];
  let top = 0;
  for (const [color, until] of bands) {
    const bottom = designHeight * until;
    space.g.rect(0, top, designWidth, bottom - top).fill(color);
    top = bottom;
  }
  for (let index = 0; index < 110; index += 1) {
    const point = starfieldPoint(index, seconds, { spread: 560, near: 20, far: 900, speed: 90 });
    const projected = projectPoint(point, designWidth / 2, designHeight * 0.45, 180);
    if (!projected.visible) continue;
    const nearness = Math.min(1, projected.scale);
    const color = hsvToHex(hue + (index % 5) * 0.06, 0.4, 1);
    space.g.circle(projected.x, projected.y, (0.5 + 2 * nearness) * 3).fill({ color, alpha: 0.05 * nearness });
    space.g
      .circle(projected.x, projected.y, 0.5 + 2 * nearness)
      .fill({ color: SYN_WHITE, alpha: 0.2 + 0.6 * nearness });
  }
  const horizon = designHeight * 0.74;
  const floor = (x: number, z: number) => projectPoint({ x, y: 130, z }, designWidth / 2, horizon, 200);
  for (let x = -1400; x <= 1400; x += 100) {
    const near = floor(x, 0);
    const far = floor(x, 2600);
    space.g.moveTo(near.x, near.y).lineTo(far.x, far.y).stroke({ color: accent, width: 1, alpha: 0.1 });
  }
  const offset = (seconds * 110) % 100;
  for (let z = 100 - offset; z < 2600; z += 100) {
    const left = floor(-1400, z);
    const right = floor(1400, z);
    space.g
      .moveTo(left.x, left.y)
      .lineTo(right.x, right.y)
      .stroke({ color: accent, width: 1, alpha: 0.05 + 0.16 * (1 - z / 2600) });
  }

  // Verdict: tracking condenses from wide to settled while it fades in.
  const verdict = group('verdict');
  const verdictT = easeOutCubic(stageProgress(elapsed, 100, 900));
  verdict.g.rect(0, 44, designWidth, 1).fill({ color: verdictColor, alpha: 0.5 * verdictT });
  text(verdict.root, cleared ? 'STAGE CLEAR' : 'FAILED', 24, 14, {
    ...display(15, SYN_WHITE),
    letterSpacing: 6 + 22 * (1 - verdictT),
    alpha: verdictT,
    dropShadow: { color: verdictColor, distance: 0, blur: 12, alpha: 1 },
  });
  text(
    verdict.root,
    `${result.song.title}${result.song.artist ? ` / ${result.song.artist}` : ''}`,
    designWidth - 20,
    17,
    {
      size: 12,
      weight: '500',
      fill: SYN_MIST,
      fontFamily: SYN_TEXT_FONT,
      anchorX: 1,
      maxWidth: 360,
      alpha: easeOutCubic(stageProgress(elapsed, 300, 600)),
    },
  );

  // Rank: a spinning 3D particle ring that bursts outward as the letter ignites.
  const rank = group('rank');
  const rankCx = 110;
  const rankCy = 150;
  const topRank = rankLabel === 'AAA' || rankLabel === 'AA';
  const rankColor = topRank ? SYN_AMBER : accent;
  glass(rank.g, 20, 66, 180, 164, rankColor);
  label('DJ LEVEL', 34, 78, rank.root, rankColor);
  const ringIn = easeOutCubic(stageProgress(elapsed, 400, 900));
  for (let index = 0; index < 60; index += 1) {
    const angle = (Math.PI * 2 * index) / 60 + seconds * 0.9;
    const radius = 56 * ringIn;
    const point = projectPoint(
      rotateX(
        rotateY({ x: Math.cos(angle) * radius, y: 0, z: Math.sin(angle) * radius }, 0.2),
        1.05 + 0.1 * Math.sin(seconds),
      ),
      rankCx,
      rankCy,
      220,
    );
    const color = hsvToHex(hue + index / 60 / 2, 0.55, 1);
    rank.g.circle(point.x, point.y, 3.5 * point.scale).fill({ color, alpha: 0.12 * ringIn });
    rank.g.circle(point.x, point.y, 1.3 * point.scale).fill({ color: SYN_WHITE, alpha: 0.8 * ringIn * point.scale });
  }
  const burstT = stageProgress(elapsed, RANK_DELAY_MS, 1100);
  if (burstT > 0 && burstT < 1) {
    for (const particle of RANK_BURST) {
      const life = burstT / particle.life;
      if (life >= 1) continue;
      const position = burstParticlePosition(particle, life, 120, 30);
      const point = projectPoint(rotateY(position, seconds * 0.4), rankCx, rankCy, 240);
      if (!point.visible) continue;
      const color = hsvToHex(hue + particle.hueShift, Math.min(0.85, life * 1.5), 1);
      rank.g.circle(point.x, point.y, (2 + 5 * particle.size) * point.scale).fill({ color, alpha: 0.15 * (1 - life) });
      rank.g
        .circle(point.x, point.y, (0.8 + 1.4 * particle.size) * point.scale)
        .fill({ color: SYN_WHITE, alpha: 1 - life });
    }
  }
  const stamp = stageProgress(elapsed, RANK_DELAY_MS, 420);
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
  text(rank.root, `${rate.toFixed(2)}%`, rankCx, 212, {
    ...display(10, SYN_MIST),
    anchorX: 0.5,
    anchorY: 0.5,
    letterSpacing: 1,
  });
  rise(rank.root, 250);

  // Metric panels.
  const metrics: ReadonlyArray<readonly [x: number, y: number, name: string, value: string, fill: number]> = [
    [218, 66, 'SCORE', String(rollUpValue(result.score.score, roll)), SYN_WHITE],
    [218, 122, 'EX SCORE', `${rollUpValue(result.score.exScore, roll)} / ${exMax}`, SYN_WHITE],
    [218, 178, 'MAX COMBO', String(rollUpValue(result.maxCombo, roll)), SYN_AMBER],
    [424, 66, 'GAUGE', `${rollUpValue(Math.round(result.gauge), roll)}%`, cleared ? SYN_CYAN : SYN_RED],
    [424, 122, 'PLAY TIME', `${(result.playSeconds * easeOutCubic(roll)).toFixed(1)}s`, SYN_WHITE],
    [424, 178, 'NOTES', String(rollUpValue(result.score.total, roll)), SYN_WHITE],
  ];
  metrics.forEach(([x, y, name, value, fill], index) => {
    const panel = group(`metric-${index}`);
    glass(panel.g, x, y, 196, 46, accent);
    label(name, x + 14, y + 10, panel.root);
    text(panel.root, value, x + 182, y + 30, {
      ...display(14, fill),
      anchorX: 1,
      anchorY: 0.5,
      maxWidth: 120,
      dropShadow: { color: fill, distance: 0, blur: 6, alpha: 0.7 },
    });
    rise(panel.root, 320 + index * 80);
  });

  // Judgement rows.
  const judges = group('judgement');
  glass(judges.g, 20, 244, 290, 176, SYN_VIOLET);
  label('JUDGEMENT', 34, 256, judges.root, SYN_VIOLET);
  const rows: ReadonlyArray<readonly [name: string, count: number, color: number]> = [
    ['PGREAT', result.score.perfect, 0xc8fbff],
    ['GREAT', result.score.great, SYN_AMBER],
    ['GOOD', result.score.good, SYN_GREEN],
    ['BAD', result.score.bad, SYN_VIOLET],
    ['POOR', result.score.poor, SYN_RED],
  ];
  const judgeTotal = Math.max(1, result.score.total);
  rows.forEach(([name, count, color], index) => {
    const y = 278 + index * 27;
    const grow = easeOutCubic(stageProgress(elapsed, ROLL_DELAY_MS + index * 70, ROLL_MS));
    judges.g.circle(38, y + 6, 2.5).fill({ color, alpha: 1 });
    judges.g.circle(38, y + 6, 6).fill({ color, alpha: 0.2 });
    label(name, 50, y + 2, judges.root, color);
    judges.g.rect(118, y + 6, 130, 1).fill({ color: SYN_DIM, alpha: 0.35 });
    const barW = (130 * Math.min(count, judgeTotal) * grow) / judgeTotal;
    if (barW > 0) {
      judges.g.rect(118, y + 4, barW, 5).fill({ color, alpha: 0.18 });
      judges.g.rect(118, y + 6, barW, 1.5).fill({ color, alpha: 0.95 });
    }
    text(judges.root, String(rollUpValue(count, roll)), 294, y + 6, {
      ...display(11, SYN_WHITE),
      anchorX: 1,
      anchorY: 0.5,
    });
  });
  rise(judges.root, 520);

  // Graphs as glowing filaments drawing in.
  const graphs = group('graphs');
  glass(graphs.g, 326, 244, 294, 176, accent);
  label('GROOVE GAUGE', 342, 256, graphs.root);
  label('EX SCORE', 342, 338, graphs.root);
  const draw = easeOutCubic(stageProgress(elapsed, ROLL_DELAY_MS + 150, ROLL_MS + 300));
  filament(
    graphs.g,
    342,
    270,
    262,
    56,
    result.gaugeHistory.map((s) => ({ x: s.progress, y: s.value / 100 })),
    cleared ? SYN_CYAN : SYN_RED,
    draw,
  );
  filament(
    graphs.g,
    342,
    352,
    262,
    56,
    result.scoreHistory.map((s) => ({ x: s.progress, y: exMax > 0 ? s.exScore / exMax : 0 })),
    SYN_MAGENTA,
    draw,
  );
  rise(graphs.root, 600);

  // Total score.
  const total = group('total');
  total.g.rect(0, designHeight - 44, designWidth, 1).fill({ color: accent, alpha: 0.4 });
  label('TOTAL SCORE', 24, designHeight - 26, total.root, accent);
  text(total.root, String(rollUpValue(result.score.score, roll)), 130, designHeight - 22, {
    ...display(16, SYN_WHITE),
    anchorY: 0.5,
    letterSpacing: 2,
    dropShadow: { color: accent, distance: 0, blur: 10, alpha: 0.9 },
  });
  rise(total.root, 440, 10);
}

function glass(graphics: Graphics, x: number, y: number, w: number, h: number, rim: number): void {
  graphics.roundRect(x, y, w, h, 8).fill({ color: SYN_GLASS, alpha: 0.6 });
  graphics.roundRect(x - 2, y - 2, w + 4, h + 4, 10).stroke({ color: rim, width: 4, alpha: 0.07 });
  graphics.roundRect(x, y, w, h, 8).stroke({ color: rim, width: 1, alpha: 0.5 });
  graphics.rect(x + 12, y, w - 24, 1).fill({ color: SYN_WHITE, alpha: 0.4 });
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
