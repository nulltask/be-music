import type { LibraryEntry } from '@be-music/player-skin-sdk';
import type { Container, Graphics } from 'pixi.js';
import { addSynesthesiaText } from './figures.ts';
import { SYN_DISPLAY_FONT, SYN_MIST, SYN_WHITE } from './style.ts';

const COURSE_MARKS = {
  expert: { label: 'EXPERT', color: 0x83dff0, width: 52 },
  nonstop: { label: 'NON STOP', color: 0xffbc80, width: 65 },
  grade: { label: 'DAN', color: 0xe2b4fa, width: 39 },
};

export function drawSelectEntryIcon(
  row: Graphics,
  entry: Exclude<LibraryEntry, { kind: 'chart' }>,
  x: number,
  y: number,
): void {
  const style = { color: SYN_MIST, width: 1.3, cap: 'round', join: 'round' } as const;
  if (entry.kind === 'course') {
    row
      .moveTo(x - 4, y + 6)
      .lineTo(x - 4, y - 5)
      .lineTo(x + 5, y - 5)
      .lineTo(x + 2, y - 2)
      .lineTo(x + 5, y + 1)
      .lineTo(x - 4, y + 1)
      .stroke(style);
  } else if (entry.folder.kind === 'bemuse-server') {
    row
      .moveTo(x - 4, y + 4)
      .bezierCurveTo(x - 10, y + 4, x - 9, y - 3, x - 4, y - 3)
      .bezierCurveTo(x - 2, y - 9, x + 5, y - 7, x + 5, y - 3)
      .bezierCurveTo(x + 11, y - 3, x + 10, y + 4, x + 5, y + 4)
      .closePath()
      .stroke(style);
  } else if (entry.folder.kind === 'difficulty-table') {
    row.roundRect(x - 6, y - 5, 12, 10, 1).stroke(style);
    row
      .moveTo(x - 6, y - 1)
      .lineTo(x + 6, y - 1)
      .stroke(style);
    row
      .moveTo(x - 1, y - 1)
      .lineTo(x - 1, y + 5)
      .stroke(style);
  } else {
    row.poly([x - 7, y + 5, x - 7, y - 5, x - 2, y - 5, x, y - 3, x + 7, y - 3, x + 7, y + 5]).stroke(style);
  }
}

export function drawSelectEntryMark(
  row: Graphics,
  layer: Container,
  entry: LibraryEntry,
  x: number,
  y: number,
  alpha: number,
): number {
  const mark =
    entry.kind === 'course'
      ? COURSE_MARKS[entry.course.definition.kind]
      : entry.kind === 'folder' && entry.folder.kind === 'difficulty-table'
        ? { label: 'DIFFICULTY TABLE', color: 0x9be2cb, width: 104 }
        : undefined;
  if (!mark) return x;
  row.roundRect(x, y - 7, mark.width, 14, 4).fill({ color: mark.color, alpha: 0.15 });
  addSynesthesiaText(layer, mark.label, x + mark.width / 2, y, {
    size: 8,
    fill: mark.color,
    fontFamily: SYN_DISPLAY_FONT,
    letterSpacing: 0.6,
    anchorX: 0.5,
    anchorY: 0.5,
    alpha,
  });
  return x + mark.width + 8;
}

export function drawSelectEntryArrow(row: Graphics, x: number, y: number): void {
  row
    .moveTo(x - 2, y - 4)
    .lineTo(x + 2, y)
    .lineTo(x - 2, y + 4)
    .stroke({ color: SYN_WHITE, alpha: 0.8, width: 1.3, cap: 'round', join: 'round' });
}
