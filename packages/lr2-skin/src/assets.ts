import { basename, dirname, normalizePath } from '@be-music/utils/core';
import { asLoadedBytes, findCaseInsensitivePath, lookupBytesCaseInsensitive } from './file-lookup.ts';
import type { Lr2SkinFileEntry } from './file-lookup.ts';
import type { Lr2Skin } from './skin.ts';

export function resolveLr2IncludePath(
  sourceFiles: ReadonlyMap<string, Lr2SkinFileEntry>,
  baseDirectory: string,
  rawPath: string,
): string | undefined {
  const normalized = normalizeLr2Path(rawPath);
  const fileName = basename(normalized).toLowerCase();
  const parentDir = dirname(normalized);
  const parentName = basename(parentDir).toLowerCase();
  const grandParent = basename(dirname(parentDir)).toLowerCase();
  const candidates = [
    normalizePath(`${baseDirectory}/${normalized}`),
    normalized,
    normalizePath(`${baseDirectory}/${basename(normalized)}`),
  ];
  // Case-insensitive exact-match: real LR2 themes reference paths like `LR2files\Theme\LR2\Result\result_normal.csv`
  // while the dropped directory layout might be `LR2files/theme/lr2/Result/...`. `findCaseInsensitivePath` returns the
  // original key (so the recursive `readLr2Path(sourceFiles.get(returnedKey))` lookup hits a real entry), or undefined
  // to fall through to the partial-path walks below.
  for (const candidate of candidates) {
    const matched = findCaseInsensitivePath(sourceFiles, candidate);
    if (matched) {
      return matched;
    }
  }
  if (grandParent && parentName) {
    const withGrandparent = [...sourceFiles.keys()].find((path) =>
      path.toLowerCase().endsWith(`/${grandParent}/${parentName}/${fileName}`),
    );
    if (withGrandparent) {
      return withGrandparent;
    }
  }
  if (parentName) {
    const withParent = [...sourceFiles.keys()].find((path) =>
      path.toLowerCase().endsWith(`/${parentName}/${fileName}`),
    );
    if (withParent) {
      return withParent;
    }
  }
  return [...sourceFiles.keys()].find(
    (path) => path.toLowerCase().endsWith(`/${fileName}`) || path.toLowerCase() === fileName,
  );
}

export function resolveLr2AssetBytes(skin: Lr2Skin, rawPath: string): Uint8Array | undefined {
  const normalized = normalizeLr2Path(rawPath);
  const candidates = [normalized, basename(normalized)];
  // Skin assets (TGA / PNG / BMP / DXA / .lr2font) are non-audio and stored eagerly in the skin's files map, so the
  // `asLoadedBytes` narrowing here is just a type guard. Case-insensitive exact-match: skin elements that reference
  // `LR2files\Theme\LR2\Result\parts.tga` should resolve when the dropped tree spells the file `Parts.TGA`. Falls
  // through to the wildcard / parent-suffix walks below for genuinely partial-path references (e.g. `*.bmp`
  // `#CUSTOMFILE` patterns).
  for (const candidate of candidates) {
    const bytes = asLoadedBytes(lookupBytesCaseInsensitive(skin.files, candidate));
    if (bytes) {
      return bytes;
    }
  }
  const fileNamePattern = wildcardToRegExp(basename(normalized));
  const parentDir = dirname(normalized);
  const parentName = basename(parentDir).toLowerCase();
  const grandParent = basename(dirname(parentDir)).toLowerCase();
  if (grandParent && parentName) {
    const matchWithGrand = [...skin.files.keys()].find((path) => {
      const lower = path.toLowerCase();
      const segments = lower.split('/');
      const baseNameLower = segments.at(-1) ?? '';
      const parentLower = segments.at(-2) ?? '';
      const grandLower = segments.at(-3) ?? '';
      return grandLower === grandParent && parentLower === parentName && fileNamePattern.test(baseNameLower);
    });
    if (matchWithGrand) {
      return asLoadedBytes(skin.files.get(matchWithGrand));
    }
  }
  if (parentName) {
    const matchWithParent = [...skin.files.keys()].find((path) => {
      const lower = path.toLowerCase();
      return basename(dirname(lower)) === parentName && fileNamePattern.test(basename(path));
    });
    if (matchWithParent) {
      return asLoadedBytes(skin.files.get(matchWithParent));
    }
  }
  const match = [...skin.files.keys()].find((path) => fileNamePattern.test(basename(path)));
  return match ? asLoadedBytes(skin.files.get(match)) : undefined;
}

export function normalizeLr2Path(path: string): string {
  return normalizePath(path.replace(/^\.\\?/u, ''));
}

export function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/gu, '\\$&').replaceAll('*', '.*');
  return new RegExp(`^${escaped}$`, 'iu');
}
