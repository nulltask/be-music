/**
 * Draws a play's share card (1200 x 630, the link-preview picture of its score page) on a canvas. The player's browser
 * draws it, since the Worker cannot rasterize on the Free plan, and main.ts uploads it.
 *
 * The lamp sets the card's mood: its colour glows behind the title and lights the judge line of the playfield on the
 * right. The DJ Rank and the EX-Score are the headline; the chart, the player and the judgments fill in the rest.
 */
import type { ScoreCardData } from '../src/pages/score-card-data.ts';

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

const FONT =
  '"Inter", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", system-ui, sans-serif';
const font = (weight: number, size: number) => `${weight} ${size}px ${FONT}`;

/** The largest size in [min, max] at which `text` fits `maxWidth`, by `measure(text, size)`. */
export function fitFontSize(
  measure: (text: string, size: number) => number,
  text: string,
  maxWidth: number,
  maxSize: number,
  minSize: number,
): number {
  for (let size = maxSize; size > minSize; size -= 2) {
    if (measure(text, size) <= maxWidth) return size;
  }
  return minSize;
}

/** `text`, cut with an ellipsis where it would pass `maxWidth` (whole characters, emoji included). */
export function ellipsize(measure: (text: string) => number, text: string, maxWidth: number): string {
  if (measure(text) <= maxWidth) return text;
  const characters = [...text];
  while (characters.length > 0 && measure(`${characters.join('')}…`) > maxWidth) characters.pop();
  return `${characters.join('').trimEnd()}…`;
}

/** Black or white, whichever reads better on `hex` (#rrggbb). */
export function readableTextColor(hex: string): string {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.4 ? '#0a0e18' : '#ffffff';
}

/** The DJ Rank's colours: gold for AAA down to grey for F. */
export function djRankGradient(rank: string): [string, string] {
  switch (rank) {
    case 'AAA':
      return ['#fff3b0', '#f5b301'];
    case 'AA':
      return ['#ffffff', '#b8c4d6'];
    case 'A':
      return ['#ffd9a8', '#e08a2c'];
    default:
      return ['#c7cde0', '#7c86a3'];
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function hexAlpha(hex: string, alpha: number): string {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

/**
 * The 7-key playfield on the right, as in the site icon; the judge line takes the lamp's colour. It is drawn on a
 * layer of its own and faded out to the left there, so the fade leaves the background untouched.
 */
function drawPlayfield(ctx: CanvasRenderingContext2D, lampColor: string): void {
  const left = 770;
  const lane = 62;
  const width = lane * 7;
  const layer = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(width + 160, CARD_HEIGHT) : null;
  const target = layer?.getContext('2d') ?? null;
  const g = target ?? ctx;
  const x0 = target !== null ? 160 : left;
  for (let i = 0; i < 7; i++) {
    g.fillStyle = i % 2 === 0 ? '#1a2036' : '#10152a';
    g.fillRect(x0 + i * lane, 0, lane, CARD_HEIGHT);
  }
  const notes: Array<[number, number, string]> = [
    [0, 40, '#ffffff'],
    [3, 40, '#4ec9ff'],
    [4, 120, '#ffffff'],
    [1, 200, '#4ec9ff'],
    [6, 200, '#ffffff'],
    [2, 290, '#ffffff'],
    [5, 290, '#4ec9ff'],
    [0, 370, '#ffffff'],
    [3, 440, '#4ec9ff'],
  ];
  for (const [laneIndex, y, color] of notes) {
    g.fillStyle = color;
    g.beginPath();
    g.roundRect(x0 + laneIndex * lane + 4, y, lane - 8, 18, 3);
    g.fill();
  }
  const glow = g.createLinearGradient(0, 480, 0, 540);
  glow.addColorStop(0, hexAlpha(lampColor, 0));
  glow.addColorStop(1, hexAlpha(lampColor, 0.55));
  g.fillStyle = glow;
  g.fillRect(x0, 480, width, 60);
  g.fillStyle = lampColor;
  g.fillRect(x0, 536, width, 10);
  if (target === null || layer === null) return;
  // Fade the layer's left edge to transparent, then lay it over the background.
  target.globalCompositeOperation = 'destination-out';
  const fade = target.createLinearGradient(160, 0, 160 + 220, 0);
  fade.addColorStop(0, 'rgba(0, 0, 0, 1)');
  fade.addColorStop(1, 'rgba(0, 0, 0, 0)');
  target.fillStyle = fade;
  target.fillRect(0, 0, width + 160, CARD_HEIGHT);
  ctx.drawImage(layer, left - 160, 0);
}

/** Draws the card. `avatar` is the player's icon, already loaded, or null to draw their initial instead. */
export function drawScoreCard(
  ctx: CanvasRenderingContext2D,
  data: ScoreCardData,
  avatar: CanvasImageSource | null,
  playedOn: string,
): void {
  const measureAt = (weight: number) => (text: string, size: number) => {
    ctx.font = font(weight, size);
    return ctx.measureText(text).width;
  };

  // Background: deep navy, the lamp's colour glowing from the top left.
  const sky = ctx.createLinearGradient(0, 0, CARD_WIDTH, CARD_HEIGHT);
  sky.addColorStop(0, '#0a0e18');
  sky.addColorStop(1, '#161c38');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  const aura = ctx.createRadialGradient(160, 120, 0, 160, 120, 640);
  aura.addColorStop(0, hexAlpha(data.lamp.color, 0.32));
  aura.addColorStop(1, hexAlpha(data.lamp.color, 0));
  ctx.fillStyle = aura;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  drawPlayfield(ctx, data.lamp.color);

  const left = 72;
  const textWidth = 700;
  ctx.textBaseline = 'alphabetic';

  // Wordmark and ruleset.
  ctx.fillStyle = '#ffffff';
  ctx.font = font(700, 26);
  ctx.fillText('be-music', left, 78);
  const markWidth = ctx.measureText('be-music').width;
  ctx.fillStyle = '#9aa4bf';
  ctx.font = font(400, 26);
  ctx.fillText('Leaderboard', left + markWidth + 10, 78);
  const rulesetX = left + markWidth + 10 + ctx.measureText('Leaderboard').width + 18;
  ctx.font = font(700, 18);
  const rulesetWidth = ctx.measureText(data.rulesetLabel).width + 24;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 2;
  roundRect(ctx, rulesetX, 55, rulesetWidth, 30, 15);
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.fillText(data.rulesetLabel, rulesetX + 12, 77);

  // Chart title (shrunk to fit, then cut) and artist.
  const titleSize = fitFontSize(measureAt(800), data.title, textWidth, 64, 40);
  ctx.font = font(800, titleSize);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(
    ellipsize((text) => ctx.measureText(text).width, data.title, textWidth),
    left,
    170,
  );
  const byline = [data.subtitle, data.artist].filter((part) => part !== null && part.length > 0).join(' · ');
  if (byline.length > 0) {
    ctx.font = font(400, 28);
    ctx.fillStyle = '#c7cde0';
    ctx.fillText(
      ellipsize((text) => ctx.measureText(text).width, byline, textWidth),
      left,
      214,
    );
  }

  // DJ Rank: the headline, in its colour.
  const [rankLight, rankDark] = djRankGradient(data.djRank);
  ctx.font = font(900, 168);
  const rankGradient = ctx.createLinearGradient(0, 260, 0, 410);
  rankGradient.addColorStop(0, rankLight);
  rankGradient.addColorStop(1, rankDark);
  ctx.fillStyle = rankGradient;
  ctx.fillText(data.djRank, left - 6, 400);
  const rankWidth = ctx.measureText(data.djRank).width;

  // EX-Score and rate.
  const scoreX = left + rankWidth + 40;
  ctx.fillStyle = '#9aa4bf';
  ctx.font = font(700, 20);
  ctx.fillText('EX-SCORE', scoreX, 300);
  ctx.fillStyle = '#ffffff';
  ctx.font = font(800, 84);
  ctx.fillText(String(data.exScore), scoreX, 378);
  const exWidth = ctx.measureText(String(data.exScore)).width;
  ctx.fillStyle = '#9aa4bf';
  ctx.font = font(500, 34);
  ctx.fillText(`/ ${data.maxExScore}`, scoreX + exWidth + 12, 378);
  ctx.fillStyle = '#ffffff';
  ctx.font = font(700, 34);
  ctx.fillText(data.rate, scoreX, 420);

  // Lamp pill and gauge.
  ctx.font = font(800, 24);
  const lampWidth = ctx.measureText(data.lamp.label).width + 36;
  ctx.fillStyle = data.lamp.color;
  ctx.shadowColor = hexAlpha(data.lamp.color, 0.7);
  ctx.shadowBlur = 24;
  roundRect(ctx, left, 452, lampWidth, 44, 22);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = readableTextColor(data.lamp.color);
  ctx.fillText(data.lamp.label, left + 18, 482);
  ctx.fillStyle = '#c7cde0';
  ctx.font = font(500, 22);
  ctx.fillText(data.gauge, left + lampWidth + 16, 482);

  // Judgments.
  const judges = data.judges;
  const counts = `PG ${judges.pgreat}  GR ${judges.great}  GD ${judges.good}  BD ${judges.bad}  PR ${judges.poor}   BP ${data.bp}   MAX COMBO ${data.maxCombo}`;
  ctx.fillStyle = '#9aa4bf';
  ctx.font = font(500, 20);
  ctx.fillText(
    ellipsize((text) => ctx.measureText(text).width, counts, textWidth),
    left,
    532,
  );

  // Player and date.
  const avatarSize = 52;
  const footerY = 560;
  ctx.save();
  ctx.beginPath();
  ctx.arc(left + avatarSize / 2, footerY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
  ctx.clip();
  if (avatar !== null) {
    ctx.drawImage(avatar, left, footerY, avatarSize, avatarSize);
  } else {
    ctx.fillStyle = '#334155';
    ctx.fillRect(left, footerY, avatarSize, avatarSize);
    ctx.fillStyle = '#ffffff';
    ctx.font = font(700, 26);
    ctx.textAlign = 'center';
    ctx.fillText([...data.playerName][0] ?? '?', left + avatarSize / 2, footerY + 36);
    ctx.textAlign = 'left';
  }
  ctx.restore();
  ctx.fillStyle = '#ffffff';
  ctx.font = font(700, 28);
  const name = ellipsize((text) => ctx.measureText(text).width, data.playerName, 360);
  ctx.fillText(name, left + avatarSize + 16, footerY + 25);
  ctx.fillStyle = '#9aa4bf';
  ctx.font = font(400, 20);
  ctx.fillText(`@${data.handle}`, left + avatarSize + 16, footerY + 50);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#9aa4bf';
  ctx.font = font(500, 20);
  ctx.fillText(`${playedOn}   #bemusic`, CARD_WIDTH - 40, CARD_HEIGHT - 26);
  ctx.textAlign = 'left';
}
