/**
 * Composition of play documents from a chart model or a chart document: the play document of one outcome. Not part of
 * the package API; the differential tests use it to check the chart model against the parser.
 */
import type { BeMusicJSON } from '@be-music/json';
import type { RandomDraws } from './control-flow.ts';
import type { Rational } from './fingerprint-rational.ts';
import { classOfDraws } from './fingerprint-control-flow.ts';
import {
  parseJudge,
  parseMine,
  parseNote,
  parseRational,
  parseTimeline,
  parseTotal,
  resolveLaneModeExtension,
  type FlatItems,
} from './fingerprint-items.ts';
import {
  type BeMusicFingerprintDocument,
  type BeMusicFingerprintOptions,
  type BeMusicPlayFingerprintDocument,
  type FingerprintRandomNode,
  assemblePlayDocument,
} from './fingerprint-document.ts';
import { type ItemDelta, applyDelta, parseDelta } from './fingerprint-delta.ts';
import { buildChartModel } from './fingerprint-chart-model.ts';

// ---------------------------------------------------------------------------------------------------------------------
// Composition (used by tests and by verifiers): the play document of one outcome
// ---------------------------------------------------------------------------------------------------------------------

/**
 * A function from an outcome (the chart's `RandomDraws`, as a play log records them) to its play document, composed
 * from the chart model rather than by resolving the chart. The function throws for an outcome of an opaque factor. Not
 * part of the package API; used to check the model against the parser.
 */
export function createOutcomeComposer(
  json: BeMusicJSON,
  options: BeMusicFingerprintOptions,
): (draws: RandomDraws) => BeMusicPlayFingerprintDocument {
  const model = buildChartModel(json, resolveLaneModeExtension(options.chartPath));
  return (draws) => {
    if (!model.topFlat || !model.analysis) {
      return model.document as BeMusicPlayFingerprintDocument;
    }
    const analysis = model.analysis;
    const items: FlatItems = { ...model.topFlat };
    for (const factor of model.factors) {
      if (!factor.tree) {
        throw new Error('fingerprint: an opaque factor has no per-outcome content');
      }
      let tree = factor.tree;
      while (tree.kind === 'node') {
        const variable = analysis.variables[tree.variable]!;
        const valueClass = classOfDraws(variable, draws);
        tree = tree.branches.find((branch) => branch.classes.includes(valueClass))!.tree;
      }
      applyDelta(items, tree.delta);
    }
    return assemblePlayDocument(items, model.extension);
  };
}

/**
 * Every outcome a chart document stands for, with its probability, composed from the document alone: one entry per
 * combination of branch paths of its `random` nodes. Not part of the package API; used to check documents in tests.
 */
export function expandChartFingerprintDocument(
  document: BeMusicFingerprintDocument,
): Array<{ probability: Rational; document: BeMusicPlayFingerprintDocument }> {
  if (!('random' in document)) {
    return [{ probability: { n: 1n, d: 1n }, document }];
  }
  const top: FlatItems = {
    notes: document.notes.map(parseNote),
    mines: document.mines.map(parseMine),
    timeline: document.timeline.map(parseTimeline),
    lengths: new Map(document.measures.lengths.map(([measure, length]) => [Number(measure), parseRational(length)])),
    header: {
      bpm: parseRational(document.bpm),
      baseBPM: document.baseBPM === null ? null : parseRational(document.baseBPM),
      judge: parseJudge(document.judge),
      total: parseTotal(document.total),
      player3: document.lanes.player3,
      modeHint: document.lanes.modeHint ?? null,
      barLines: true,
    },
  };
  let combos: Array<{ probability: Rational; deltas: ItemDelta[] }> = [{ probability: { n: 1n, d: 1n }, deltas: [] }];
  for (const node of document.random) {
    if ('opaque' in node) {
      throw new Error('fingerprint: an opaque node has no per-outcome content');
    }
    const leaves = expandNode(node);
    const next: typeof combos = [];
    for (const combo of combos) {
      for (const leaf of leaves) {
        next.push({
          probability: { n: combo.probability.n * leaf.probability.n, d: combo.probability.d * leaf.probability.d },
          deltas: [...combo.deltas, leaf.delta],
        });
      }
    }
    combos = next;
  }
  return combos.map((combo) => {
    const items: FlatItems = { ...top };
    for (const delta of combo.deltas) {
      applyDelta(items, delta);
    }
    return { probability: combo.probability, document: assemblePlayDocument(items, document.lanes.extension) };
  });
}

function expandNode(node: FingerprintRandomNode): Array<{ probability: Rational; delta: ItemDelta }> {
  const max = BigInt(node.random);
  const result: Array<{ probability: Rational; delta: ItemDelta }> = [];
  for (const branch of node.branches) {
    let count = 0n;
    for (const range of branch.values) {
      const dash = range.indexOf('-');
      count += dash < 0 ? 1n : BigInt(range.slice(dash + 1)) - BigInt(range.slice(0, dash)) + 1n;
    }
    const children = branch.next
      ? expandNode(branch.next)
      : [{ probability: { n: 1n, d: 1n }, delta: parseDelta(branch) }];
    for (const child of children) {
      result.push({
        probability: { n: count * child.probability.n, d: max * child.probability.d },
        delta: child.delta,
      });
    }
  }
  return result;
}
