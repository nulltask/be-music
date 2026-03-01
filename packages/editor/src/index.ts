import { readFile, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import {
  createEmptyJson,
  ensureMeasure,
  normalizeChannel,
  normalizeObjectKey,
  sortEvents,
  type BmsEvent,
  type BmsJson,
} from '@be-music/json';
import { parseChart, parseChartFile } from '@be-music/parser';
import { stringifyBmson, stringifyBms } from '@be-music/stringifier';

/**
 * 非同期でimport Chart に対応する処理を実行します。
 * @param inputPath - 対象ファイルまたはディレクトリのパス。
 * @returns 非同期処理完了後の結果（BmsJson）を解決する Promise。
 */
export async function importChart(inputPath: string): Promise<BmsJson> {
  return parseChartFile(resolve(inputPath));
}

/**
 * 非同期で外部データを読み込み、処理可能な形式で返します。
 * @param filePath - 対象ファイルまたはディレクトリのパス。
 * @returns 非同期処理完了後の結果（BmsJson）を解決する Promise。
 */
export async function loadJsonFile(filePath: string): Promise<BmsJson> {
  const content = await readFile(resolve(filePath), 'utf8');
  return parseChart(content, 'json');
}

/**
 * 非同期で指定先へデータを書き込みます。
 * @param filePath - 対象ファイルまたはディレクトリのパス。
 * @param json - 処理対象の BMS/BMSON 中間表現。
 * @returns 戻り値はありません。
 */
export async function saveJsonFile(filePath: string, json: BmsJson): Promise<void> {
  await writeFile(resolve(filePath), `${JSON.stringify(normalizeJson(json), null, 2)}\n`, 'utf8');
}

/**
 * 非同期でexport Chart に対応する処理を実行します。
 * @param filePath - 対象ファイルまたはディレクトリのパス。
 * @param json - 処理対象の BMS/BMSON 中間表現。
 * @returns 戻り値はありません。
 */
export async function exportChart(filePath: string, json: BmsJson): Promise<void> {
  const outputPath = resolve(filePath);
  const extension = extname(outputPath).toLowerCase();
  const content = extension === '.bmson' ? stringifyBmson(json) : stringifyBms(json);
  await writeFile(outputPath, content, 'utf8');
}

/**
 * set Metadata に対応する処理を実行します。
 * @param json - 処理対象の BMS/BMSON 中間表現。
 * @param key - キー入力イベント情報。
 * @param value - 処理対象の値。
 * @returns 処理結果（BmsJson）。
 */
export function setMetadata(json: BmsJson, key: string, value: string): BmsJson {
  const normalized = normalizeJson(json);
  const property = key.toLowerCase();

  switch (property) {
    case 'title':
      normalized.metadata.title = value;
      return normalized;
    case 'subtitle':
      normalized.metadata.subtitle = value;
      return normalized;
    case 'artist':
      normalized.metadata.artist = value;
      return normalized;
    case 'genre':
      normalized.metadata.genre = value;
      return normalized;
    case 'comment':
      normalized.metadata.comment = value;
      return normalized;
    case 'stagefile':
      normalized.metadata.stageFile = value;
      return normalized;
    case 'playlevel':
      normalized.metadata.playLevel = Number.parseFloat(value);
      return normalized;
    case 'rank':
      normalized.metadata.rank = Number.parseFloat(value);
      return normalized;
    case 'total':
      normalized.metadata.total = Number.parseFloat(value);
      return normalized;
    case 'difficulty':
      normalized.metadata.difficulty = Number.parseFloat(value);
      return normalized;
    case 'bpm': {
      const bpm = Number.parseFloat(value);
      if (Number.isFinite(bpm) && bpm > 0) {
        normalized.metadata.bpm = bpm;
      }
      return normalized;
    }
    default:
      normalized.metadata.extras[key.toUpperCase()] = value;
      return normalized;
  }
}

/**
 * add Note に対応する処理を実行します。
 * @param json - 処理対象の BMS/BMSON 中間表現。
 * @param params - params に対応する入力値。
 * @returns 処理結果（BmsJson）。
 */
export function addNote(
  json: BmsJson,
  params: {
    measure: number;
    channel: string;
    positionNumerator: number;
    positionDenominator: number;
    value: string;
  },
): BmsJson {
  const normalized = normalizeJson(json);
  ensureMeasure(normalized, params.measure);
  const position = normalizePositionFraction(params.positionNumerator, params.positionDenominator);

  const event: BmsEvent = {
    measure: Math.max(0, Math.floor(params.measure)),
    channel: normalizeChannel(params.channel),
    position: [position.numerator, position.denominator],
    value: normalizeObjectKey(params.value),
  };

  normalized.events.push(event);
  normalized.events = sortEvents(normalized.events);
  return normalized;
}

/**
 * delete Note に対応する処理を実行します。
 * @param json - 処理対象の BMS/BMSON 中間表現。
 * @param params - params に対応する入力値。
 * @returns 処理結果（BmsJson）。
 */
export function deleteNote(
  json: BmsJson,
  params: {
    measure: number;
    channel: string;
    positionNumerator: number;
    positionDenominator: number;
    value?: string;
  },
): BmsJson {
  const normalized = normalizeJson(json);
  const channel = normalizeChannel(params.channel);
  const position = normalizePositionFraction(params.positionNumerator, params.positionDenominator);

  normalized.events = normalized.events.filter((event) => {
    if (event.measure !== params.measure) {
      return true;
    }
    if (normalizeChannel(event.channel) !== channel) {
      return true;
    }
    if (!isSamePosition(event, position)) {
      return true;
    }
    if (params.value && normalizeObjectKey(event.value) !== normalizeObjectKey(params.value)) {
      return true;
    }
    return false;
  });

  return normalized;
}

/**
 * 対象データの一覧を返します。
 * @param json - 処理対象の BMS/BMSON 中間表現。
 * @param measure - 対象小節番号。
 * @returns 処理結果の配列。
 */
export function listNotes(json: BmsJson, measure?: number): BmsEvent[] {
  const target = normalizeJson(json);
  return sortEvents(target.events).filter((event) => (measure === undefined ? true : event.measure === measure));
}

/**
 * 処理に必要な初期データを生成します。
 * @returns 処理結果（BmsJson）。
 */
export function createBlankJson(): BmsJson {
  return createEmptyJson('json');
}

/**
 * 入力値を仕様に沿う正規形に整えます。
 * @param json - 処理対象の BMS/BMSON 中間表現。
 * @returns 処理結果（BmsJson）。
 */
function normalizeJson(json: BmsJson): BmsJson {
  const cloned = structuredClone(json);
  if (!cloned.metadata) {
    cloned.metadata = {
      bpm: 120,
      extras: {},
    };
  }
  cloned.metadata.extras = cloned.metadata.extras ?? {};
  cloned.metadata.bpm = Number.isFinite(cloned.metadata.bpm) && cloned.metadata.bpm > 0 ? cloned.metadata.bpm : 120;
  cloned.resources = cloned.resources ?? {
    wav: {},
    bmp: {},
    bpm: {},
    stop: {},
    text: {},
  };
  cloned.resources.wav = cloned.resources.wav ?? {};
  cloned.resources.bmp = cloned.resources.bmp ?? {};
  cloned.resources.bpm = cloned.resources.bpm ?? {};
  cloned.resources.stop = cloned.resources.stop ?? {};
  cloned.resources.text = cloned.resources.text ?? {};
  cloned.measures = (cloned.measures ?? []).filter(
    (measure) => Number.isFinite(measure.index) && Number.isFinite(measure.length),
  );
  cloned.events = sortEvents(cloned.events ?? []);
  return cloned;
}

/**
 * 入力値を仕様に沿う正規形に整えます。
 * @param numerator - numerator に対応する入力値。
 * @param denominator - denominator に対応する入力値。
 * @returns 処理結果（{ numerator: number; denominator: number }）。
 */
function normalizePositionFraction(numerator: number, denominator: number): { numerator: number; denominator: number } {
  const safeDenominator = Number.isFinite(denominator) && denominator > 0 ? Math.max(1, Math.floor(denominator)) : 1;
  if (!Number.isFinite(numerator)) {
    return { numerator: 0, denominator: safeDenominator };
  }
  const safeNumerator = Math.floor(numerator);
  return {
    numerator: Math.max(0, Math.min(safeDenominator - 1, safeNumerator)),
    denominator: safeDenominator,
  };
}

/**
 * 条件判定を行い、真偽値を返します。
 * @param event - 処理対象のイベント。
 * @param target - target に対応する入力値。
 * @returns 条件を満たす場合は `true`、それ以外は `false`。
 */
function isSamePosition(event: BmsEvent, target: { numerator: number; denominator: number }): boolean {
  const left = BigInt(event.position[0]) * BigInt(target.denominator);
  const right = BigInt(target.numerator) * BigInt(event.position[1]);
  if (left !== right) {
    return false;
  }
  return true;
}
