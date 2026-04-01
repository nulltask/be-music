import type { BeMusicPlayLevel } from '@be-music/json';

const PLAY_LEVEL_HEADER = 'PLEVEL';
const PLAY_LEVEL_TEXT_MAX_WIDTH = 4;

export interface SelectionDisplayEntry {
  kind: 'random' | 'group' | 'chart';
  label?: string;
  fileLabel?: string;
  totalNotes?: number;
  player?: number;
  difficulty?: number;
  rank?: number;
  rankLabel?: string;
  playLevel?: BeMusicPlayLevel;
  bpmInitial?: number;
  bpmMin?: number;
  bpmMax?: number;
}

export interface SelectionColumnLayout {
  fileWidth: number;
  playerWidth: number;
  difficultyWidth: number;
  rankWidth: number;
  playLevelWidth: number;
  bpmWidth: number;
  notesWidth: number;
}

export function createSelectionColumnLayout(
  itemLabelWidth: number,
  entries: readonly SelectionDisplayEntry[],
): SelectionColumnLayout {
  let playerWidth = 'PLAYER'.length;
  let difficultyWidth = 'DIFF'.length;
  let rankWidth = 'RANK'.length;
  let playLevelWidth = PLAY_LEVEL_HEADER.length;
  let bpmWidth = 'BPM'.length;
  let notesWidth = 'NOTES'.length;
  for (const entry of entries) {
    if (entry.kind !== 'chart') {
      continue;
    }
    playerWidth = Math.max(playerWidth, formatPlayerLabel(entry.player).length);
    difficultyWidth = Math.max(difficultyWidth, formatDifficultyLabel(entry.difficulty).length);
    rankWidth = Math.max(rankWidth, formatRankCellValue(entry).length);
    playLevelWidth = Math.max(playLevelWidth, measureDisplayWidth(formatPlayLevelCellValue(entry.playLevel)));
    bpmWidth = Math.max(bpmWidth, formatBpmLabel(entry.bpmMin, entry.bpmInitial, entry.bpmMax).length);
    notesWidth = Math.max(notesWidth, formatTotalNotesLabel(entry.totalNotes).length);
  }

  const spacingWidth = 12;
  const fixedMetaWidth =
    playerWidth + difficultyWidth + rankWidth + playLevelWidth + bpmWidth + notesWidth + spacingWidth;
  const fileWidth = Math.max(1, itemLabelWidth - fixedMetaWidth);

  return {
    fileWidth,
    playerWidth,
    difficultyWidth,
    rankWidth,
    playLevelWidth,
    bpmWidth,
    notesWidth,
  };
}

export function formatSelectionColumnHeader(layout: SelectionColumnLayout): string {
  const file = formatColumnCell('File', layout.fileWidth);
  const player = formatColumnCell('PLAYER', layout.playerWidth, 'right');
  const difficulty = formatColumnCell('DIFF', layout.difficultyWidth, 'right');
  const rank = formatColumnCell('RANK', layout.rankWidth, 'right');
  const playLevel = formatColumnCell(PLAY_LEVEL_HEADER, layout.playLevelWidth, 'left');
  const bpm = formatColumnCell('BPM', layout.bpmWidth, 'right');
  const notes = formatColumnCell('NOTES', layout.notesWidth, 'right');
  return `${file}  ${player}  ${difficulty}  ${rank}  ${playLevel}  ${bpm}  ${notes}`;
}

export function formatSelectionEntryLabel(entry: SelectionDisplayEntry, layout: SelectionColumnLayout): string {
  if (entry.kind === 'group') {
    return entry.label ?? '';
  }
  if (entry.kind === 'random') {
    const file = formatColumnCell(entry.label ?? '', layout.fileWidth);
    const player = formatColumnCell('-', layout.playerWidth, 'right');
    const difficulty = formatColumnCell('-', layout.difficultyWidth, 'right');
    const rank = formatColumnCell('-', layout.rankWidth, 'right');
    const playLevel = formatColumnCell('-', layout.playLevelWidth, 'right');
    const bpm = formatColumnCell('-', layout.bpmWidth, 'right');
    const notes = formatColumnCell('-', layout.notesWidth, 'right');
    return `${file}  ${player}  ${difficulty}  ${rank}  ${playLevel}  ${bpm}  ${notes}`;
  }

  const file = formatColumnCell(`  ${entry.fileLabel ?? ''}`, layout.fileWidth);
  const player = formatColumnCell(formatPlayerLabel(entry.player), layout.playerWidth, 'right');
  const difficulty = formatColumnCell(formatDifficultyLabel(entry.difficulty), layout.difficultyWidth, 'right');
  const rank = formatColumnCell(formatRankCellValue(entry), layout.rankWidth, 'right');
  const playLevel = formatColumnCell(
    formatPlayLevelCellValue(entry.playLevel),
    layout.playLevelWidth,
    resolvePlayLevelCellAlign(entry.playLevel),
  );
  const bpm = formatColumnCell(formatBpmLabel(entry.bpmMin, entry.bpmInitial, entry.bpmMax), layout.bpmWidth, 'right');
  const notes = formatColumnCell(formatTotalNotesLabel(entry.totalNotes), layout.notesWidth, 'right');
  return `${file}  ${player}  ${difficulty}  ${rank}  ${playLevel}  ${bpm}  ${notes}`;
}

function formatRankCellValue(entry: SelectionDisplayEntry): string {
  if (typeof entry.rankLabel === 'string' && entry.rankLabel.length > 0) {
    return entry.rankLabel;
  }
  return formatRankLabel(entry.rank);
}

function formatColumnCell(value: string, width: number, align: 'left' | 'right' = 'left'): string {
  const truncated = truncateForDisplay(value, width);
  return padDisplayWidth(truncated, width, align);
}

export function formatPlayerLabel(value: number | undefined): string {
  if (typeof value !== 'number') {
    return '-';
  }
  const normalized = Math.floor(value);
  if (normalized === 1) {
    return 'SINGLE';
  }
  if (normalized === 2) {
    return 'COUPLE';
  }
  if (normalized === 3) {
    return 'DOUBLE';
  }
  if (normalized === 4) {
    return 'BATTLE';
  }
  return String(normalized);
}

export function formatDifficultyLabel(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '-';
  }
  const normalized = Math.trunc(value);
  if (normalized < 1 || normalized > 5) {
    return '-';
  }
  return String(normalized);
}

export function formatRankLabel(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '-';
  }
  const normalized = Math.trunc(value);
  if (normalized === value) {
    if (normalized === 0) {
      return 'VERY HARD';
    }
    if (normalized === 1) {
      return 'HARD';
    }
    if (normalized === 2) {
      return 'NORMAL';
    }
    if (normalized === 3) {
      return 'EASY';
    }
    if (normalized === 4) {
      return 'VERY EASY';
    }
  }
  return formatRankValue(value);
}

function formatRankValue(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return rounded.toFixed(2).replace(/(?:\.0+|(\.\d+?)0+)$/, '$1');
}

export function formatPlayLevelLabel(value: BeMusicPlayLevel | undefined): string {
  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : '-';
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return '-';
  }
  if (value === 0) {
    return '?';
  }
  const rounded = Math.round(value * 100) / 100;
  return rounded.toFixed(2).replace(/(?:\.0+|(\.\d+?)0+)$/, '$1');
}

function formatPlayLevelCellValue(value: BeMusicPlayLevel | undefined): string {
  const label = formatPlayLevelLabel(value);
  if (typeof value === 'string') {
    return truncateForDisplay(label, PLAY_LEVEL_TEXT_MAX_WIDTH);
  }
  return label;
}

function resolvePlayLevelCellAlign(value: BeMusicPlayLevel | undefined): 'left' | 'right' {
  return typeof value === 'number' ? 'right' : 'left';
}

function formatTotalNotesLabel(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return '-';
  }
  return String(Math.floor(value));
}

function formatBpmLabel(min: number | undefined, initial: number | undefined, max: number | undefined): string {
  if (
    typeof min !== 'number' ||
    typeof initial !== 'number' ||
    typeof max !== 'number' ||
    !Number.isFinite(min) ||
    !Number.isFinite(initial) ||
    !Number.isFinite(max) ||
    min <= 0 ||
    initial <= 0 ||
    max <= 0
  ) {
    return '-';
  }

  const values = [formatBpmValue(min), formatBpmValue(initial), formatBpmValue(max)];
  const collapsed = values.filter((value, index) => index === 0 || value !== values[index - 1]);
  if (collapsed.length <= 1) {
    return collapsed[0] ?? '-';
  }
  return collapsed.join('-');
}

function formatBpmValue(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return rounded.toFixed(2).replace(/(?:\.0+|(\.\d+?)0+)$/, '$1');
}

export function truncateForDisplay(value: string, width: number): string {
  if (measureDisplayWidth(value) <= width) {
    return value;
  }
  if (width <= 1) {
    return width <= 0 ? '' : '…'.slice(0, width);
  }
  let result = '';
  let consumedWidth = 0;
  for (const char of value) {
    const charWidth = measureDisplayWidth(char);
    if (consumedWidth + charWidth > width - 1) {
      break;
    }
    result += char;
    consumedWidth += charWidth;
  }
  return `${result}…`;
}

function padDisplayWidth(value: string, width: number, align: 'left' | 'right'): string {
  const paddingWidth = Math.max(0, width - measureDisplayWidth(value));
  const padding = ' '.repeat(paddingWidth);
  return align === 'right' ? `${padding}${value}` : `${value}${padding}`;
}

function measureDisplayWidth(value: string): number {
  let width = 0;
  for (const char of value) {
    width += measureCharacterDisplayWidth(char);
  }
  return width;
}

function measureCharacterDisplayWidth(char: string): number {
  const codePoint = char.codePointAt(0);
  if (codePoint === undefined) {
    return 0;
  }
  if (
    codePoint === 0 ||
    codePoint < 32 ||
    (codePoint >= 0x7f && codePoint < 0xa0) ||
    codePoint === 0x200d ||
    codePoint === 0xfe0e ||
    codePoint === 0xfe0f ||
    /\p{Mark}/u.test(char)
  ) {
    return 0;
  }
  return isFullWidthCodePoint(codePoint) ? 2 : 1;
}

function isFullWidthCodePoint(codePoint: number): boolean {
  if (codePoint < 0x1100) {
    return false;
  }
  return (
    codePoint <= 0x115f ||
    codePoint === 0x2329 ||
    codePoint === 0x232a ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1f64f) ||
    (codePoint >= 0x1f680 && codePoint <= 0x1f6ff) ||
    (codePoint >= 0x1f900 && codePoint <= 0x1f9ff) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  );
}
