import {
  formatPlayVariantLabel,
  resolveSongRowFacts,
  type BeMusicSelectLayout,
  type BrowserBrowseEntry,
  type BeMusicSelectFrame,
  type BeMusicSurface,
} from '@be-music/skin-sdk';
import { ACCENT, INK, LINE, MUTED, PANEL, TEXT, stat, text } from './theme.ts';

/** Where the song list sits; the player uses the same numbers to tell which row was clicked. */
export const SELECT_LAYOUT: BeMusicSelectLayout = { listX: 322, listTop: 56, listBottomInset: 28, rowHeight: 28 };

/** Fade to black after a chart is picked. */
export const SELECT_OUTRO_MS = 300;

const MARGIN = 16;
const PANEL_W = 290;

/** The select screen: the focused chart's card and buttons on the left, the song list on the right. */
export function drawSelect({ context: ctx, width, height }: BeMusicSurface<'2d'>, frame: BeMusicSelectFrame): void {
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, width, height);
  text(ctx, 'MUSIC SELECT', MARGIN, 24, { size: 14, weight: 800 });
  text(ctx, frame.folderLabel ?? `${frame.totalCharts} charts`, width - MARGIN, 24, {
    size: 11,
    color: MUTED,
    align: 'right',
  });

  drawFocusedSong(ctx, frame);
  drawList(ctx, frame, width);

  if (frame.searchQuery) {
    text(ctx, `SEARCH: ${frame.searchQuery}`, MARGIN, height - 20, { size: 11, color: MUTED });
  }

  // After a pick, darken the screen over the outro.
  if (frame.launchAt !== undefined) {
    const t = Math.min(1, (frame.nowMs - frame.launchAt) / SELECT_OUTRO_MS);
    ctx.fillStyle = `rgba(0, 0, 0, ${t})`;
    ctx.fillRect(0, 0, width, height);
  }
}

/** The left card: title, artist, the chart's key facts, and the PLAY / AUTO buttons. */
function drawFocusedSong(ctx: CanvasRenderingContext2D, frame: BeMusicSelectFrame): void {
  const song = frame.focusedSong;
  const x = MARGIN;
  const y = 56;
  ctx.fillStyle = PANEL;
  ctx.fillRect(x, y, PANEL_W, 300);
  if (!song) {
    text(ctx, 'Pick a folder', x + 16, y + 28, { size: 14, color: MUTED });
    return;
  }
  text(ctx, song.title, x + 16, y + 28, { size: 18, weight: 800, maxWidth: PANEL_W - 32 });
  text(ctx, song.artist ?? '', x + 16, y + 52, { size: 11, color: MUTED, maxWidth: PANEL_W - 32 });

  const facts = resolveSongRowFacts(song);
  stat(ctx, 'MODE', formatPlayVariantLabel(song), x + 16, y + 92);
  stat(ctx, 'LEVEL', String(song.playLevel ?? '-'), x + 110, y + 92);
  stat(ctx, 'BPM', facts.bpm, x + 190, y + 92);
  stat(ctx, 'NOTES', facts.notes, x + 16, y + 140);
  stat(ctx, 'LENGTH', facts.length, x + 110, y + 140);
  stat(ctx, 'GIMMICKS', facts.tags.join(' ') || '-', x + 190, y + 140);

  button(ctx, frame, 'PLAY', x + 16, y + 236, 160, frame.actions.play, true);
  button(ctx, frame, 'AUTO', x + 186, y + 236, 88, frame.actions.autoPlay, false);
}

function button(
  ctx: CanvasRenderingContext2D,
  frame: BeMusicSelectFrame,
  label: string,
  x: number,
  y: number,
  w: number,
  action: () => void,
  primary: boolean,
): void {
  const h = 40;
  ctx.fillStyle = primary ? ACCENT : INK;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = primary ? ACCENT : LINE;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  text(ctx, label, x + w / 2, y + h / 2, { size: 14, weight: 800, align: 'center' });
  frame.hit(x, y, w, h, action);
}

/** The visible window of the list: one row per entry, the selected one highlighted. */
function drawList(ctx: CanvasRenderingContext2D, frame: BeMusicSelectFrame, width: number): void {
  const { listX, listTop, rowHeight } = SELECT_LAYOUT;
  const rowW = width - listX - MARGIN;
  for (let row = 0; row < frame.visibleRows; row += 1) {
    const index = frame.firstVisibleIndex + row;
    const entry = frame.entries[index];
    if (!entry) break;
    const y = listTop + row * rowHeight;
    const selected = index === frame.selectedIndex;
    ctx.fillStyle = selected ? ACCENT : row % 2 === 0 ? PANEL : INK;
    ctx.fillRect(listX, y, rowW, rowHeight - 2);
    drawRow(ctx, entry, listX, y + (rowHeight - 2) / 2, rowW, selected);
  }
}

function drawRow(
  ctx: CanvasRenderingContext2D,
  entry: BrowserBrowseEntry,
  x: number,
  midY: number,
  w: number,
  selected: boolean,
): void {
  const dim = selected ? TEXT : MUTED;
  if (entry.kind === 'folder') {
    text(ctx, `▸ ${entry.folder.label}`, x + 12, midY, { size: 12, weight: 700, maxWidth: w - 120 });
    text(ctx, `${entry.folder.songs.length} charts`, x + w - 12, midY, { size: 11, color: dim, align: 'right' });
    return;
  }
  const song = entry.song;
  const facts = resolveSongRowFacts(song);
  text(ctx, String(song.playLevel ?? '-'), x + 22, midY, { size: 12, weight: 800, align: 'center' });
  text(ctx, song.title, x + 44, midY, { size: 12, weight: 700, maxWidth: w - 300 });
  text(ctx, `${facts.notes} N   ${facts.length}   ${facts.bpm} BPM`, x + w - 12, midY, {
    size: 11,
    color: dim,
    align: 'right',
  });
}
