/** Opaque JSON annotations: data only, never executable format semantics. */
export type JSONValue = null | boolean | number | string | JSONValue[] | { [key: string]: JSONValue };
export type JSONFields = { [key: string]: JSONValue };
export type BmsonFieldScope = keyof typeof BMSON_FIELDS;

const BMSON_FIELDS = {
  root: [
    'version',
    'info',
    'lines',
    'resolution',
    'bpm_events',
    'stop_events',
    'scroll_events',
    'sound_channels',
    'key_channels',
    'mine_channels',
    'bga',
  ],
  info: [
    'title',
    'subtitle',
    'artist',
    'genre',
    'subartists',
    'chart_name',
    'level',
    'init_bpm',
    'resolution',
    'mode_hint',
    'judge_rank',
    'total',
    'ln_type',
    'back_image',
    'eyecatch_image',
    'title_image',
    'banner_image',
    'preview_music',
  ],
  channel: ['name', 'notes'],
  note: ['x', 'y', 'l', 'c', 't', 'up'],
  keyNote: ['x', 'y'],
  mineNote: ['x', 'y', 'damage'],
  line: ['y'],
  bpm: ['y', 'bpm'],
  stop: ['y', 'duration'],
  scroll: ['y', 'rate'],
  bga: ['bga_header', 'bga_events', 'layer_events', 'poor_events', 'bga_sequence'],
  bgaHeader: ['id', 'name'],
  bgaEvent: ['y', 'id', 'id_set', 'idSet', 'condition', 'interval'],
  bgaSequence: ['id', 'sequence'],
  bgaFrame: ['time', 'id'],
} as const;
const INVALID = Symbol('invalid-json');

/** Deep copy a nonempty JSON object; reject non-JSON values and cycles without retaining aliases. */
export function cloneJSONFields(input: unknown): JSONFields | undefined {
  if (!isRecord(input) || Object.keys(input).length === 0) return undefined;
  const copy = cloneValue(input, new Set<object>());
  return copy === INVALID ? undefined : (copy as JSONFields);
}

/** Retain only fields without supported semantics at this external bmson node; known fields can never be overridden. */
export function collectBmsonExtraFields(input: unknown, scope: BmsonFieldScope): JSONFields | undefined {
  if (!isRecord(input)) return undefined;
  const known: readonly string[] = BMSON_FIELDS[scope];
  return cloneJSONFields(Object.fromEntries(Object.entries(input).filter(([key]) => !known.includes(key))));
}

function isRecord(input: unknown): input is Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const prototype = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}

/** Deeper opaque values are invalid, so a hostile document cannot exhaust the stack of the recursive copy. */
const MAX_JSON_DEPTH = 256;

function cloneValue(input: unknown, ancestors: Set<object>): JSONValue | typeof INVALID {
  if (input === null || typeof input === 'boolean' || typeof input === 'string') return input;
  if (typeof input === 'number') return Number.isFinite(input) ? input : INVALID;
  if (typeof input !== 'object' || (!Array.isArray(input) && !isRecord(input)) || ancestors.has(input)) return INVALID;
  if (ancestors.size >= MAX_JSON_DEPTH) return INVALID;
  ancestors.add(input);
  let result: JSONValue;
  if (Array.isArray(input)) {
    const values: JSONValue[] = [];
    for (const item of input) {
      const value = cloneValue(item, ancestors);
      if (value === INVALID) return INVALID;
      values.push(value);
    }
    result = values;
  } else {
    const entries: Array<[string, JSONValue]> = [];
    for (const [key, item] of Object.entries(input)) {
      const value = cloneValue(item, ancestors);
      if (value === INVALID) return INVALID;
      entries.push([key, value]);
    }
    result = Object.fromEntries(entries);
  }
  ancestors.delete(input);
  return result;
}
