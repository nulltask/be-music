// Element normalization helpers for beatoraja skins.
//
// JSON skins inline conditional groups via:
//   { "if":[920], "values":[ ...elements... ] }
// or per-element overrides:
//   { "if":[920], "value": { time:0, x:56, y:140, ... } }
// Lua skins typically expand these at evaluation time, but they also occasionally emit `if`/`values` literally so
// the renderer has to handle them in either source format. The helpers here flatten that conditional structure into
// a flat list of elements, attaching the originating `if` op-codes onto each element so the renderer can gate
// visibility at runtime.

export type RawElement = Readonly<Record<string, unknown>>;

export interface NormalizedElement {
  /** Underlying element fields after merging any per-element `value` override. */
  fields: Readonly<Record<string, unknown>>;
  /**
   * `op` codes that must all be satisfied for the element to be visible. Multiple negated codes are passed through
   * as negative integers, mirroring beatoraja's convention. Empty array means "always visible".
   */
  ifCodes: ReadonlyArray<number>;
}

/**
 * Flatten a possibly-nested array of raw elements (`image[]`, `destination[]`, etc.) into a flat list of normalized
 * entries. `if`/`values` blocks are expanded; nested `if` are AND-merged.
 *
 * Unknown shapes (anything that isn't a record / array of records) are dropped — the caller already failed to find a
 * useful element there, and silently skipping keeps the renderer from crashing on author typos.
 */
export function flattenBeatorajaElements(input: unknown): NormalizedElement[] {
  const out: NormalizedElement[] = [];
  flattenInto(input, [], out);
  return out;
}

function flattenInto(input: unknown, parentIfCodes: ReadonlyArray<number>, out: NormalizedElement[]): void {
  if (input === null || input === undefined) return;
  if (Array.isArray(input)) {
    for (const child of input) flattenInto(child, parentIfCodes, out);
    return;
  }
  if (typeof input !== 'object') return;
  const obj = input as Readonly<Record<string, unknown>>;

  // Conditional group: { if: number[], values?: [...elements...], value?: { ...fields } }
  if (Array.isArray(obj.if)) {
    const ifCodes = mergeIfCodes(parentIfCodes, obj.if as ReadonlyArray<unknown>);
    if (Array.isArray(obj.values)) {
      flattenInto(obj.values, ifCodes, out);
      return;
    }
    if (obj.value !== undefined && typeof obj.value === 'object' && obj.value !== null) {
      out.push({ fields: obj.value as Readonly<Record<string, unknown>>, ifCodes });
      return;
    }
    // Bare `if` with no `value(s)` is a no-op.
    return;
  }

  out.push({ fields: obj, ifCodes: parentIfCodes });
}

function mergeIfCodes(parent: ReadonlyArray<number>, next: ReadonlyArray<unknown>): ReadonlyArray<number> {
  const merged = parent.slice();
  for (const v of next) {
    if (typeof v === 'number' && Number.isFinite(v)) {
      merged.push(v);
    }
  }
  return merged;
}

/**
 * Evaluate `ifCodes` against an active op-code set. Negative codes mean negation (the op must NOT be active). All
 * codes must be satisfied for the element to be visible.
 */
export function isElementVisible(ifCodes: ReadonlyArray<number>, activeOps: ReadonlySet<number>): boolean {
  for (const code of ifCodes) {
    if (code === 0) continue;
    if (code > 0) {
      if (!activeOps.has(code)) return false;
    } else if (activeOps.has(-code)) {
      return false;
    }
  }
  return true;
}

/**
 * Build the "active op" set from a {@link BeatorajaSkinConfig}'s `option` map. Each picked option contributes its
 * `op` integer; the rendering side adds runtime ops (timer state, judge state, etc.) on top of this base.
 */
export function buildBaseOpSet(option: Readonly<Record<string, number>> | undefined): Set<number> {
  const set = new Set<number>();
  if (option === undefined) return set;
  for (const value of Object.values(option)) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      set.add(value);
    }
  }
  return set;
}
