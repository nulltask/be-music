import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import type { ExportsBenchmarkSnapshot } from './exports.types.ts';

export function resolveCliValue(value: string | undefined, optionName: string): string {
  if (!value) {
    throw new Error(`Missing value for ${optionName}`);
  }
  return value;
}

export function parsePositiveCliNumber(value: string | undefined, optionName: string): number {
  const parsed = Number.parseFloat(resolveCliValue(value, optionName));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${optionName} must be a positive number`);
  }
  return parsed;
}

export function parseNonNegativeCliNumber(value: string | undefined, optionName: string): number {
  const parsed = Number.parseFloat(resolveCliValue(value, optionName));
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${optionName} must be a non-negative number`);
  }
  return parsed;
}

export function parsePositiveCliInteger(value: string | undefined, optionName: string): number {
  const parsed = Number.parseInt(resolveCliValue(value, optionName), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${optionName} must be a positive integer`);
  }
  return parsed;
}

export function isExecutedAsScript(importMetaUrl: string, entryPath: string | undefined = process.argv[1]): boolean {
  if (!entryPath) {
    return false;
  }
  return importMetaUrl === pathToFileURL(entryPath).href;
}

export function runCliMain(importMetaUrl: string, main: () => Promise<unknown>): void {
  if (!isExecutedAsScript(importMetaUrl)) {
    return;
  }

  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}

export async function loadExportsBenchmarkSnapshot(pathValue: string): Promise<ExportsBenchmarkSnapshot> {
  const raw = await readFile(pathValue, 'utf8');
  const parsed = JSON.parse(raw) as Partial<ExportsBenchmarkSnapshot>;
  if (parsed.schemaVersion !== 1) {
    throw new Error(`Unsupported snapshot schema at ${pathValue}`);
  }
  if (!parsed.results || typeof parsed.results !== 'object') {
    throw new Error(`Invalid snapshot (results is missing): ${pathValue}`);
  }
  if (!parsed.totals || typeof parsed.totals !== 'object') {
    throw new Error(`Invalid snapshot (totals is missing): ${pathValue}`);
  }
  return parsed as ExportsBenchmarkSnapshot;
}

export async function loadExportsBenchmarkSnapshotOrUndefined(
  pathValue: string,
): Promise<ExportsBenchmarkSnapshot | undefined> {
  try {
    return await loadExportsBenchmarkSnapshot(pathValue);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('ENOENT')) {
      return undefined;
    }
    throw error;
  }
}
