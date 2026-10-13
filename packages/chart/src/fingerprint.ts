/**
 * Be-Music Fingerprint (`bmfp0`) — identifies a chart by what the player plays and sees in the lanes rather than by its
 * bytes. The normative definition is `docs/fingerprint-spec.md`; this module is its public API and the modules
 * `fingerprint-*.ts` its reference implementation.
 */
import type { BeMusicJson } from '@be-music/json';
import { bucketEvents, computeChartItems, flattenItems, resolveLaneModeExtension } from './fingerprint-items.ts';
import { sha256Hex } from './sha256.ts';
import {
  type BeMusicFingerprintDocument,
  type BeMusicFingerprintOptions,
  type BeMusicPlayFingerprintDocument,
  FINGERPRINT_VERSION,
  assemblePlayDocument,
  canonicalizeJsonValue,
} from './fingerprint-document.ts';
import { buildChartModel } from './fingerprint-chart-model.ts';

export type {
  FingerprintJudge,
  FingerprintLength,
  FingerprintMine,
  FingerprintNote,
  FingerprintTime,
  FingerprintTimelineEvent,
  FingerprintTimelineType,
  FingerprintTotal,
} from './fingerprint-items.ts';
export type {
  BeMusicChartFingerprintDocument,
  BeMusicFingerprintDocument,
  BeMusicFingerprintOptions,
  BeMusicPlayFingerprintDocument,
  FingerprintBranch,
  FingerprintControlFlowNode,
  FingerprintDeltaLists,
  FingerprintHeaderChange,
  FingerprintLaneModeInputs,
  FingerprintMeasures,
  FingerprintOpaqueNode,
  FingerprintRandomNode,
} from './fingerprint-document.ts';
export { FINGERPRINT_FACTOR_OUTCOME_LIMIT } from './fingerprint-document.ts';

// ---------------------------------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Builds the canonical document of the **play fingerprint**: the chart exactly as given, i.e. after
 * `resolveBmsControlFlow` chose every `#RANDOM` / `#SWITCH` branch. `json.bms.controlFlow` is ignored.
 */
export function createPlayFingerprintDocument(
  json: BeMusicJson,
  options: BeMusicFingerprintOptions,
): BeMusicPlayFingerprintDocument {
  const items = flattenItems(computeChartItems(json, bucketEvents(json.events)));
  return assemblePlayDocument(items, resolveLaneModeExtension(options.chartPath));
}

/**
 * Builds the canonical document of the **chart fingerprint** from the parser's unresolved output (`parseBms` /
 * `parseChart`), whose `events` hold only the content outside control flow and whose `bms.controlFlow` holds the rest.
 * A chart whose every outcome plays the same (in particular one without control flow) gets its play document.
 */
export function createChartFingerprintDocument(
  json: BeMusicJson,
  options: BeMusicFingerprintOptions,
): BeMusicFingerprintDocument {
  return buildChartModel(json, resolveLaneModeExtension(options.chartPath)).document;
}

/**
 * Serializes a fingerprint document with the JSON Canonicalization Scheme (RFC 8785): object keys sorted by UTF-16
 * code units, no whitespace, ECMAScript string escaping. The fingerprint is the SHA-256 of this text's UTF-8 bytes.
 */
export function canonicalizeFingerprintDocument(document: BeMusicFingerprintDocument): string {
  return canonicalizeJsonValue(document);
}

/** `bmfp0:<sha256>` of the chart fingerprint document. Synchronous and dependency-free, in Node and browsers alike. */
export function computeChartFingerprint(json: BeMusicJson, options: BeMusicFingerprintOptions): string {
  return hashFingerprintDocument(createChartFingerprintDocument(json, options));
}

/** `bmfp0:<sha256>` of the play fingerprint document. Synchronous and dependency-free, in Node and browsers alike. */
export function computePlayFingerprint(json: BeMusicJson, options: BeMusicFingerprintOptions): string {
  return hashFingerprintDocument(createPlayFingerprintDocument(json, options));
}

function hashFingerprintDocument(document: BeMusicFingerprintDocument): string {
  return `${FINGERPRINT_VERSION}:${sha256Hex(canonicalizeFingerprintDocument(document))}`;
}
