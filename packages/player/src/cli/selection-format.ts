export interface SelectionDisplayEntry {
  kind: 'random' | 'group' | 'chart';
  label?: string;
  fileLabel?: string;
  totalNotes?: number;
  player?: number;
  rank?: number;
  playLevel?: number;
  bpmInitial?: number;
  bpmMin?: number;
  bpmMax?: number;
}

export interface SelectionColumnLayout {
  fileWidth: number;
  playerWidth: number;
  rankWidth: number;
  playLevelWidth: number;
  bpmWidth: number;
  notesWidth: number;
}

export function createSelectionColumnLayout(
  itemLabelWidth: number,
  entries: readonly SelectionDisplayEntry[],
): SelectionColumnLayout {
  const fileHeaderWidth = 'File'.length;
  let playerWidth = 'PLAYER'.length;
  let rankWidth = 'RANK'.length;
  let playLevelWidth = 'PLAYLEVEL'.length;
  let bpmWidth = 'BPM'.length;
  let notesWidth = 'NOTES'.length;
  for (const entry of entries) {
    if (entry.kind !== 'chart') {
      continue;
    }
    playerWidth = Math.max(playerWidth, formatPlayerLabel(entry.player).length);
    rankWidth = Math.max(rankWidth, formatRankLabel(entry.rank).length);
    playLevelWidth = Math.max(playLevelWidth, formatPlayLevelLabel(entry.playLevel).length);
    bpmWidth = Math.max(bpmWidth, formatBpmLabel(entry.bpmMin, entry.bpmInitial, entry.bpmMax).length);
    notesWidth = Math.max(notesWidth, formatTotalNotesLabel(entry.totalNotes).length);
  }

  const spacingWidth = 10;
  const fixedMetaWidth = playerWidth + rankWidth + playLevelWidth + bpmWidth + notesWidth + spacingWidth;
  const fileWidth = Math.max(fileHeaderWidth, Math.max(8, itemLabelWidth - fixedMetaWidth));

  return {
    fileWidth,
    playerWidth,
    rankWidth,
    playLevelWidth,
    bpmWidth,
    notesWidth,
  };
}

export function formatSelectionColumnHeader(layout: SelectionColumnLayout): string {
  const file = formatColumnCell('File', layout.fileWidth);
  const player = formatColumnCell('PLAYER', layout.playerWidth, 'right');
  const rank = formatColumnCell('RANK', layout.rankWidth, 'right');
  const playLevel = formatColumnCell('PLAYLEVEL', layout.playLevelWidth, 'left');
  const bpm = formatColumnCell('BPM', layout.bpmWidth, 'right');
  const notes = formatColumnCell('NOTES', layout.notesWidth, 'right');
  return `${file}  ${player}  ${rank}  ${playLevel}  ${bpm}  ${notes}`;
}

export function formatSelectionEntryLabel(entry: SelectionDisplayEntry, layout: SelectionColumnLayout): string {
  if (entry.kind === 'group') {
    return entry.label ?? '';
  }
  if (entry.kind === 'random') {
    const file = formatColumnCell(entry.label ?? '', layout.fileWidth);
    const player = formatColumnCell('-', layout.playerWidth, 'right');
    const rank = formatColumnCell('-', layout.rankWidth, 'right');
    const playLevel = formatColumnCell('-', layout.playLevelWidth, 'left');
    const bpm = formatColumnCell('-', layout.bpmWidth, 'right');
    const notes = formatColumnCell('-', layout.notesWidth, 'right');
    return `${file}  ${player}  ${rank}  ${playLevel}  ${bpm}  ${notes}`;
  }

  const file = formatColumnCell(`  ${entry.fileLabel ?? ''}`, layout.fileWidth);
  const player = formatColumnCell(formatPlayerLabel(entry.player), layout.playerWidth, 'right');
  const rank = formatColumnCell(formatRankLabel(entry.rank), layout.rankWidth, 'right');
  const playLevel = formatColumnCell(formatPlayLevelLabel(entry.playLevel), layout.playLevelWidth, 'left');
  const bpm = formatColumnCell(formatBpmLabel(entry.bpmMin, entry.bpmInitial, entry.bpmMax), layout.bpmWidth, 'right');
  const notes = formatColumnCell(formatTotalNotesLabel(entry.totalNotes), layout.notesWidth, 'right');
  return `${file}  ${player}  ${rank}  ${playLevel}  ${bpm}  ${notes}`;
}

function formatColumnCell(value: string, width: number, align: 'left' | 'right' = 'left'): string {
  const truncated = truncateForDisplay(value, width);
  return align === 'right' ? truncated.padStart(width, ' ') : truncated.padEnd(width, ' ');
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

export function formatRankLabel(value: number | undefined): string {
  if (typeof value !== 'number') {
    return '-';
  }
  const normalized = Math.floor(value);
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
  return String(normalized);
}

export function formatPlayLevelLabel(value: number | undefined): string {
  if (typeof value !== 'number') {
    return '-';
  }
  const normalized = Math.floor(value);
  if (!Number.isFinite(normalized)) {
    return '-';
  }
  return String(normalized);
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
  if (value.length <= width) {
    return value;
  }
  if (width <= 1) {
    return value.slice(0, width);
  }
  return `${value.slice(0, width - 1)}…`;
}
