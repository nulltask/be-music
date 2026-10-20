import { relative } from 'node:path';
import readline from 'node:readline';
import type { BeMusicPlayLevel } from '@be-music/chart-source';
import type { PlayerSummary } from '@be-music/player-engine';
import { resolveResultScreenActionFromKey, type ResultScreenAction } from './music-select-navigation.ts';
import { formatPlayLevelLabel, formatPlayerLabel, formatRankLabel, truncateForDisplay } from './selection-format.ts';
import { beginRawInputCapture } from './input-capture.ts';

export interface PlayedChartResult {
  chartPath: string;
  summary: PlayerSummary;
  title?: string;
  artist?: string;
  player?: number;
  rank?: number;
  rankLabel?: string;
  playLevel?: BeMusicPlayLevel;
}

interface ResultScreenOptions {
  allowReplay?: boolean;
  nextActionLabel?: string;
}

export async function showResultScreen(
  rootDir: string,
  played: PlayedChartResult,
  options: ResultScreenOptions = {},
): Promise<ResultScreenAction> {
  const allowReplay = options.allowReplay ?? true;
  const nextActionLabel = options.nextActionLabel ?? 'return to music selection';
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return 'enter';
  }

  const relativePath = relative(rootDir, played.chartPath).replaceAll('\\', '/');
  const titleLine = played.title ?? relativePath;
  const artistLine = played.artist ? `ARTIST ${played.artist}` : undefined;
  const totalNotes = Math.max(0, Math.floor(played.summary.total));
  const maxExScore = Math.max(0, totalNotes * 2);
  const judgedNotes = Math.max(
    0,
    Math.floor(
      played.summary.perfect + played.summary.great + played.summary.good + played.summary.bad + played.summary.poor,
    ),
  );
  const notesProgress = `${Math.min(totalNotes, judgedNotes)}/${totalNotes}`;
  const gaugeLine = formatGrooveGaugeResultLine(played.summary);

  const inputCapture = beginRawInputCapture();
  process.stdout.write('\u001b[?25l');

  const render = (): void => {
    const columns = process.stdout.columns ?? 80;
    const lineWidth = Math.max(16, columns - 2);
    const lines: string[] = [];
    lines.push('RESULT');
    lines.push(truncateForDisplay(titleLine, lineWidth));
    if (artistLine) {
      lines.push(truncateForDisplay(artistLine, lineWidth));
    }
    lines.push(truncateForDisplay(`FILE ${relativePath}`, lineWidth));
    lines.push('');
    lines.push(
      `PLAYER ${formatPlayerLabel(played.player)}  RANK ${played.rankLabel ?? formatRankLabel(played.rank)}  PLAYLEVEL ${formatPlayLevelLabel(played.playLevel)}`,
    );
    if (gaugeLine) {
      lines.push(truncateForDisplay(gaugeLine, lineWidth));
    }
    lines.push(`NOTES ${notesProgress}`);
    lines.push(`EX-SCORE ${played.summary.exScore}/${maxExScore}  SCORE ${played.summary.score}/200000`);
    lines.push(
      `PGREAT ${played.summary.perfect}  GREAT ${played.summary.great}  GOOD ${played.summary.good}  BAD ${played.summary.bad}  POOR ${played.summary.poor}`,
    );
    lines.push(`FAST ${played.summary.fast}  SLOW ${played.summary.slow}`);
    lines.push('');
    if (allowReplay) {
      lines.push('Press r to replay this chart.');
    }
    lines.push('Press Enter or Esc to close result screen.');
    lines.push(`Next: ${nextActionLabel}.`);
    lines.push('Press Ctrl+C to quit.');
    process.stdout.write(`\u001b[2J\u001b[H${lines.join('\n')}\u001b[J`);
  };

  return new Promise<ResultScreenAction>((resolvePromise) => {
    let finished = false;

    const cleanup = (action: ResultScreenAction): void => {
      if (finished) {
        return;
      }
      finished = true;
      inputCapture.stdin.removeListener('keypress', onKeyPress);
      inputCapture.restore();
      process.stdout.write('\u001b[?25h\u001b[2J\u001b[H');
      resolvePromise(action);
    };

    const onKeyPress = (chunk: string | undefined, key: readline.Key): void => {
      const action = resolveResultScreenActionFromKey(chunk, key);
      if (!action) {
        return;
      }
      if (action === 'replay' && !allowReplay) {
        return;
      }
      cleanup(action);
    };

    inputCapture.stdin.on('keypress', onKeyPress);
    render();
  });
}

function formatGrooveGaugeResultLine(summary: PlayerSummary): string | undefined {
  const gauge = summary.gauge;
  if (!gauge) {
    return undefined;
  }
  const status = gauge.cleared ? 'CLEAR' : 'FAILED';
  return `GAUGE ${renderPlainGrooveGaugeBar(gauge.current, gauge.max, 24)} ${gauge.current.toFixed(2)}% ${status} TOTAL ${formatGrooveGaugeNumber(gauge.effectiveTotal)}`;
}

function renderPlainGrooveGaugeBar(current: number, max: number, width: number): string {
  const safeWidth = Math.max(1, Math.floor(width));
  const safeMax = Number.isFinite(max) && max > 0 ? max : 100;
  const filled = Math.round(safeWidth * Math.max(0, Math.min(1, current / safeMax)));
  return `[${'#'.repeat(filled)}${'-'.repeat(safeWidth - filled)}]`;
}

function formatGrooveGaugeNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return '-';
  }
  const rounded = Math.round(value);
  return Math.abs(value - rounded) <= 1e-9 ? String(rounded) : value.toFixed(2);
}
