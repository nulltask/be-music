import { resolve } from 'node:path';

export function resolveCliPath(path: string, cwd: string = process.env.INIT_CWD ?? process.cwd()): string {
  return resolve(cwd, path);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function clampInt(value: number, min: number, max: number): number {
  const normalized = Number.isFinite(value) ? Math.floor(value) : min;
  return clamp(normalized, min, max);
}

export function clampSignedUnit(value: number): number {
  return clamp(value, -1, 1);
}

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

export function lcm(left: number, right: number): number {
  if (left === 0 || right === 0) {
    return 0;
  }
  return Math.abs((left * right) / gcd(left, right));
}
