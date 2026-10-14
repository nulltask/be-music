import {
  formatPlayVariantLabel,
  resolveStageOrientation,
  resolveSongRowFacts,
  type BeMusicSelectLayout,
  type BrowserBrowseEntry,
  type BeMusicSelectFrame,
  type BeMusicSurface,
  selectListRows,
} from '@be-music/skin-sdk';
import { PORTRAIT_SELECT_LAYOUT, resolvePortraitSelectCard } from './layout.ts';
import { ACCENT, INK, LINE, MUTED, PANEL, TEXT, stat, text } from './theme.ts';

/** Where the song list sits; the player uses the same numbers to tell which row was clicked. */
export const SELECT_LAYOUT: BeMusicSelectLayout = { listX: 322, listTop: 56, listBottomInset: 28, rowHeight: 28 };

/** Fade to black after a chart is picked. */
export const SELECT_OUTRO_MS = 300;

const MARGIN = 16;
const PANEL_W = 290;

/**
 * The select screen. Landscape: the focused chart's card and buttons on the left, the song list on the right. Portrait
 * (the skin's `portraitStage`, while a phone or tablet is held upright): the card across the top and the list under it.
 * The host tells the two apart by the surface's size, and so does Plain — the size can change between two draws when
 * the screen rotates, so nothing here is worked out once and kept.
 */
export function drawSelect(surface: BeMusicSurface<'2d'>, frame: BeMusicSelectFrame): void {
  const { context: ctx, width, height } = surface;
  const portrait = resolveStageOrientation(surface) === 'portrait';
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, width, height);
  text(ctx, 'MUSIC SELECT', MARGIN, 24, { size: 14, weight: 800 });
  text(ctx, frame.folderLabel ?? `${frame.totalCharts} charts`, width - MARGIN, 24, {
    size: 11,
    color: MUTED,
    align: 'right',
    maxWidth: width - MARGIN * 2 - 140,
    nowMs: frame.nowMs,
  });

  if (portrait) {
    drawPortraitCard(ctx, frame, width);
    drawList(ctx, frame, width, PORTRAIT_SELECT_LAYOUT, drawPortraitRow);
  } else {
    drawFocusedSong(ctx, frame);
    drawList(ctx, frame, width, SELECT_LAYOUT, drawRow);
  }

  // The search box, in the strip under the list (`listBottomInset` keeps it free). Clicking it starts typing there;
  // while the player types, the host's field sits over it and shows the text.
  const searchY = portrait ? height - PORTRAIT_SELECT_LAYOUT.listBottomInset / 2 : height - 20;
  const searchW = portrait ? width - MARGIN * 2 : PANEL_W;
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1;
  ctx.strokeRect(MARGIN + 0.5, searchY - 9.5, searchW - 1, 19);
  text(ctx, 'SEARCH', MARGIN + 8, searchY, { size: 9, weight: 800, color: MUTED });
  if (!frame.searchEditing) {
    text(ctx, frame.searchQuery || 'Title / artist / genre', MARGIN + 60, searchY, {
      size: 11,
      color: frame.searchQuery ? TEXT : MUTED,
      maxWidth: searchW - 68,
    });
  }
  frame.hit(MARGIN + 56, searchY - 10, searchW - 56, 20, frame.actions.activateSearch, 'text');

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
  // Genre, title, artist — the order every built-in skin uses.
  const { nowMs } = frame;
  const lift = song.genre ? 12 : 0;
  const textW = PANEL_W - 32;
  if (song.genre) text(ctx, song.genre, x + 16, y + 22, { size: 10, color: MUTED, maxWidth: textW, nowMs });
  text(ctx, song.title, x + 16, y + 28 + lift, { size: 18, weight: 800, maxWidth: textW, nowMs });
  text(ctx, song.artist ?? '', x + 16, y + 52 + lift, { size: 11, color: MUTED, maxWidth: textW, nowMs });

  // Three columns of facts; each value keeps to its column (a wide BPM range or gimmick list scrolls).
  const facts = resolveSongRowFacts(song);
  const narrow = { maxWidth: 86, nowMs };
  const wide = { maxWidth: 84, nowMs };
  stat(ctx, 'MODE', formatPlayVariantLabel(song), x + 16, y + 92, narrow);
  stat(ctx, 'LEVEL', String(song.playLevel ?? '-'), x + 110, y + 92, { maxWidth: 72, nowMs });
  stat(ctx, 'BPM', facts.bpm, x + 190, y + 92, wide);
  stat(ctx, 'NOTES', facts.notes, x + 16, y + 140, narrow);
  stat(ctx, 'LENGTH', facts.length, x + 110, y + 140, { maxWidth: 72, nowMs });
  stat(ctx, 'GIMMICKS', facts.tags.join(' ') || '-', x + 190, y + 140, wide);

  button(ctx, frame, 'PLAY', x + 16, y + 236, 160, frame.actions.play, true);
  button(ctx, frame, 'AUTO', x + 186, y + 236, 88, frame.actions.autoPlay, false);
}

/**
 * The portrait card: the same contents as the landscape one, given the stage's width — the track in larger type, the
 * facts in three wider columns, and thumb-sized buttons (see {@link resolvePortraitSelectCard}).
 */
function drawPortraitCard(ctx: CanvasRenderingContext2D, frame: BeMusicSelectFrame, width: number): void {
  const {
    card,
    factColumns: [c0, c1, c2],
    factWidth,
    factRows: [r0, r1],
    play,
    auto,
  } = resolvePortraitSelectCard(width);
  ctx.fillStyle = PANEL;
  ctx.fillRect(card.x, card.y, card.w, card.h);
  const song = frame.focusedSong;
  const left = card.x + 16;
  if (!song) {
    text(ctx, 'Pick a folder', left, card.y + 28, { size: 14, color: MUTED });
    return;
  }
  const { nowMs } = frame;
  const textW = card.w - 32;
  const lift = song.genre ? 12 : 0;
  if (song.genre) text(ctx, song.genre, left, card.y + 20, { size: 10, color: MUTED, maxWidth: textW, nowMs });
  text(ctx, song.title, left, card.y + 30 + lift, { size: 20, weight: 800, maxWidth: textW, nowMs });
  text(ctx, song.artist ?? '', left, card.y + 56 + lift, { size: 12, color: MUTED, maxWidth: textW, nowMs });

  const facts = resolveSongRowFacts(song);
  const fit = { maxWidth: factWidth, nowMs, labelSize: 10 };
  stat(ctx, 'MODE', formatPlayVariantLabel(song), c0, r0, fit);
  stat(ctx, 'LEVEL', String(song.playLevel ?? '-'), c1, r0, fit);
  stat(ctx, 'BPM', facts.bpm, c2, r0, fit);
  stat(ctx, 'NOTES', facts.notes, c0, r1, fit);
  stat(ctx, 'LENGTH', facts.length, c1, r1, fit);
  stat(ctx, 'GIMMICKS', facts.tags.join(' ') || '-', c2, r1, fit);

  button(ctx, frame, 'PLAY', play.x, play.y, play.w, frame.actions.play, true, play.h);
  button(ctx, frame, 'AUTO', auto.x, auto.y, auto.w, frame.actions.autoPlay, false, auto.h);
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
  h = 40,
): void {
  ctx.fillStyle = primary ? ACCENT : INK;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = primary ? ACCENT : LINE;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  text(ctx, label, x + w / 2, y + h / 2, { size: 14, weight: 800, align: 'center' });
  frame.hit(x, y, w, h, action);
}

/** Draws one list row, its text centred on `midY`. */
type RowDrawer = (
  ctx: CanvasRenderingContext2D,
  entry: BrowserBrowseEntry,
  x: number,
  midY: number,
  w: number,
  nowMs: number | undefined,
) => void;

/**
 * The visible window of the list: one row per entry, the selected one highlighted. The rows follow `layout` — the
 * same numbers the skin declares, which the host hit-tests taps and clicks with.
 */
function drawList(
  ctx: CanvasRenderingContext2D,
  frame: BeMusicSelectFrame,
  width: number,
  layout: BeMusicSelectLayout,
  drawEntry: RowDrawer,
): void {
  const { listX, listTop, rowHeight } = layout;
  const rowW = width - listX - MARGIN;
  // Rows follow the list's pull (`frame.listScroll`), fading where they slide past the window's edge.
  for (const { entryIndex: index, slot, alpha } of selectListRows(frame, rowHeight)) {
    const entry = frame.entries[index]!;
    const y = listTop + slot * rowHeight;
    const selected = index === frame.selectedIndex;
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.fillStyle = selected ? ACCENT : index % 2 === 0 ? PANEL : INK;
    ctx.fillRect(listX, y, rowW, rowHeight - 2);
    drawEntry(ctx, entry, listX, y + (rowHeight - 2) / 2, rowW, selected ? frame.nowMs : undefined);
    ctx.restore();
  }
}

function drawRow(
  ctx: CanvasRenderingContext2D,
  entry: BrowserBrowseEntry,
  x: number,
  midY: number,
  w: number,
  /** The frame clock on the selected row, whose long texts scroll; other rows just clip theirs. */
  nowMs: number | undefined,
): void {
  const dim = nowMs !== undefined ? TEXT : MUTED;
  if (entry.kind === 'folder') {
    text(ctx, `▸ ${entry.folder.label}`, x + 12, midY, { size: 12, weight: 700, maxWidth: w - 120, nowMs });
    text(ctx, `${entry.folder.songs.length} charts`, x + w - 12, midY, { size: 11, color: dim, align: 'right' });
    return;
  }
  const song = entry.song;
  const facts = resolveSongRowFacts(song);
  text(ctx, String(song.playLevel ?? '-'), x + 22, midY, { size: 12, weight: 800, align: 'center' });
  text(ctx, song.title, x + 44, midY, { size: 12, weight: 700, maxWidth: w - 300, nowMs });
  text(ctx, `${facts.notes} NOTES   ${facts.length}   ${facts.bpm} BPM`, x + w - 12, midY, {
    size: 11,
    color: dim,
    align: 'right',
    maxWidth: 236,
    nowMs,
  });
}

/**
 * A portrait row: too narrow for the landscape row's one line, so the title takes a line of its own and the facts go
 * under it, both beside the level.
 */
function drawPortraitRow(
  ctx: CanvasRenderingContext2D,
  entry: BrowserBrowseEntry,
  x: number,
  midY: number,
  w: number,
  nowMs: number | undefined,
): void {
  const dim = nowMs !== undefined ? TEXT : MUTED;
  const textW = w - 56;
  if (entry.kind === 'folder') {
    text(ctx, `▸ ${entry.folder.label}`, x + 12, midY - 8, { size: 13, weight: 700, maxWidth: w - 24, nowMs });
    text(ctx, `${entry.folder.songs.length} charts`, x + 12, midY + 9, { size: 10, color: dim });
    return;
  }
  const song = entry.song;
  const facts = resolveSongRowFacts(song);
  text(ctx, String(song.playLevel ?? '-'), x + 22, midY, { size: 13, weight: 800, align: 'center' });
  text(ctx, song.title, x + 44, midY - 8, { size: 13, weight: 700, maxWidth: textW, nowMs });
  text(ctx, `${facts.notes} NOTES   ${facts.length}   ${facts.bpm} BPM`, x + 44, midY + 9, {
    size: 10,
    color: dim,
    maxWidth: textW,
    nowMs,
  });
}
