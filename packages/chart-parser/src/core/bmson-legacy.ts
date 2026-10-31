import type { BmsonDocument } from './bmson.ts';

/** Fields of a pre-1.0 (v0.21) bmson that Bemuse reads; it has no `version` and a fixed 240-pulse quarter note. */
interface LegacyBmsonDocument {
  info?: Record<string, unknown> & { initBPM?: unknown };
  lines?: unknown;
  soundChannel?: unknown;
  bpmNotes?: Array<{ y?: unknown; v?: unknown }>;
  stopNotes?: Array<{ y?: unknown; v?: unknown }>;
}

const LEGACY_RESOLUTION = 240;

/**
 * Whether a document without `version` uses the legacy field names. A missing version with only 1.0.0 fields is
 * ambiguous and stays rejected.
 */
export function isLegacyBmsonDocument(document: unknown): boolean {
  if (document === null || typeof document !== 'object' || Array.isArray(document)) return false;
  if (Object.hasOwn(document, 'version')) return false;
  const legacy = document as LegacyBmsonDocument;
  return (
    Object.hasOwn(legacy, 'soundChannel') ||
    Object.hasOwn(legacy, 'bpmNotes') ||
    Object.hasOwn(legacy, 'stopNotes') ||
    (legacy.info !== null && typeof legacy.info === 'object' && Object.hasOwn(legacy.info, 'initBPM'))
  );
}

/**
 * Rewrites a legacy v0.21 bmson as the 1.0.0 document it describes, following Bemuse's reader
 * (https://github.com/bemusic/bemuse/blob/4bf3e7d98a44841b323741cc403ecb7b41618ade/packages/bmson/src/legacy.ts):
 * `soundChannel` → `sound_channels`, `info.initBPM` → `info.init_bpm`, `bpmNotes {y, v}` → `bpm_events`, `stopNotes
 * {y, v}` → `stop_events` with `floor(v)` pulses, and a resolution of 240. Other legacy fields are not carried over.
 */
export function convertLegacyBmsonDocument(document: BmsonDocument): BmsonDocument {
  const legacy = document as LegacyBmsonDocument;
  const { initBPM, ...info } = legacy.info ?? {};
  const events = (entries: LegacyBmsonDocument['bpmNotes']) => (Array.isArray(entries) ? entries : []);
  return {
    version: '1.0.0',
    info: { ...info, ...(initBPM !== undefined ? { init_bpm: initBPM } : {}), resolution: LEGACY_RESOLUTION },
    ...(legacy.lines !== undefined ? { lines: legacy.lines } : {}),
    sound_channels: Array.isArray(legacy.soundChannel) ? legacy.soundChannel : [],
    bpm_events: events(legacy.bpmNotes).map(({ y, v }) => ({ y, bpm: v })),
    stop_events: events(legacy.stopNotes).map(({ y, v }) => ({
      y,
      duration: typeof v === 'number' ? Math.floor(v) : v,
    })),
  } as BmsonDocument;
}
