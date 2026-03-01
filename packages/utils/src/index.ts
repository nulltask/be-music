import { resolve } from 'node:path';

/**
 * 依存する値を解決し、確定値を返します。
 * @param path - 対象ファイルまたはディレクトリのパス。
 * @param cwd - 相対パスを解決する基準ディレクトリ。
 * @returns 変換後または整形後の文字列。
 */
export function resolveCliPath(path: string, cwd: string = process.env.INIT_CWD ?? process.cwd()): string {
  return resolve(cwd, path);
}

/**
 * 数値を指定範囲内に制限します。
 * @param value - 処理対象の値。
 * @param min - 数値制限に使う境界値。
 * @param max - 数値制限に使う境界値。
 * @returns 計算結果の数値。
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * 数値を指定範囲内に制限します。
 * @param value - 処理対象の値。
 * @param min - 数値制限に使う境界値。
 * @param max - 数値制限に使う境界値。
 * @returns 計算結果の数値。
 */
export function clampInt(value: number, min: number, max: number): number {
  const normalized = Number.isFinite(value) ? Math.floor(value) : min;
  return clamp(normalized, min, max);
}

/**
 * 数値を指定範囲内に制限します。
 * @param value - 処理対象の値。
 * @returns 計算結果の数値。
 */
export function clampSignedUnit(value: number): number {
  return clamp(value, -1, 1);
}

/**
 * 2つの整数の最大公約数を計算します。
 * @param left - 比較・演算対象の値。
 * @param right - 比較・演算対象の値。
 * @returns 計算結果の数値。
 */
export function gcd(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a;
}

/**
 * 2つの整数の最小公倍数を計算します。
 * @param left - 比較・演算対象の値。
 * @param right - 比較・演算対象の値。
 * @returns 計算結果の数値。
 */
export function lcm(left: number, right: number): number {
  if (left === 0 || right === 0) {
    return 0;
  }
  return Math.abs((left * right) / gcd(left, right));
}
