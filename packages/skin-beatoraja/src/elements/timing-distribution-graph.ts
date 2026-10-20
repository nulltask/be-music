// Strict-typed normalization for beatoraja `timingdistributiongraph[]` declarations.
//
// `timingdistributiongraph` is the result-screen counterpart to `timingvisualizer`. It plots a
// histogram of every judgement's timing offset across the entire run — one bar per millisecond
// bucket, height proportional to the count of judgements that landed at that delta. Optionally
// overlays the run's average and standard-deviation guides so the player can see whether they
// were consistently early/late and how clustered their hits were.
//
// Beatoraja's `SkinTimingDistributionGraph` (java) takes:
//   - `lineWidth` — pixel thickness of each histogram bar (also doubles as the bin width).
//   - `graphColor` / `averageColor` / `devColor` — backdrop, average-line, deviation-band colors.
//   - `PGColor` / `GRColor` / `GDColor` / `BDColor` / `PRColor` — per-judge-tier bar colors.
//   - `drawAverage` / `drawDev` — `1` = draw the overlay, `0` = skip.
//
// Authors typically write `{id = "timingdistribution"}` and rely on engine-side defaults; we
// preserve every authored field verbatim so the renderer can either honor them when supplied or
// pick its own defaults.

import { flattenBeatorajaElements, type NormalizedElement } from './base.ts';
import { numberField, pickHex, stringField } from './fields.ts';
import type { BeatorajaImageId } from './image.ts';

export interface BeatorajaTimingDistributionGraphElement {
  /** Destination id this graph targets. */
  id: BeatorajaImageId;
  /** Pixel thickness of each histogram bar (also bin width). `0` = renderer fallback. */
  lineWidth: number;
  /** Whether to draw the average-line overlay. `1` = draw, `0` = skip. */
  drawAverage: number;
  /** Whether to draw the deviation-band overlay. `1` = draw, `0` = skip. */
  drawDev: number;
  /** Colors. Empty string = renderer fallback. */
  graphColor: string;
  averageColor: string;
  devColor: string;
  pgColor: string;
  grColor: string;
  gdColor: string;
  bdColor: string;
  prColor: string;
  /** `if` codes that gate visibility (AND-merged with the destination's `op[]`). */
  ifCodes: ReadonlyArray<number>;
}

export function normalizeBeatorajaTimingDistributionGraphs(input: unknown): BeatorajaTimingDistributionGraphElement[] {
  const flattened = flattenBeatorajaElements(input);
  const out: BeatorajaTimingDistributionGraphElement[] = [];
  for (const entry of flattened) {
    const normalized = normalizeOne(entry);
    if (normalized !== undefined) out.push(normalized);
  }
  return out;
}

function normalizeOne(entry: NormalizedElement): BeatorajaTimingDistributionGraphElement | undefined {
  const f = entry.fields;
  const id = f.id;
  if (typeof id !== 'string' && typeof id !== 'number') return undefined;
  return {
    id,
    lineWidth: numberField(f, 'lineWidth', 0),
    drawAverage: numberField(f, 'drawAverage', 0),
    drawDev: numberField(f, 'drawDev', 0),
    graphColor: stringField(f, 'graphColor', ''),
    averageColor: stringField(f, 'averageColor', ''),
    devColor: stringField(f, 'devColor', ''),
    pgColor: pickHex(f, ['pgColor', 'PGColor']),
    grColor: pickHex(f, ['grColor', 'GRColor']),
    gdColor: pickHex(f, ['gdColor', 'GDColor']),
    bdColor: pickHex(f, ['bdColor', 'BDColor']),
    prColor: pickHex(f, ['prColor', 'PRColor']),
    ifCodes: entry.ifCodes,
  };
}
