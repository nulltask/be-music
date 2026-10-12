/**
 * `#RANDOM` / `#SWITCH` evaluation for the chart fingerprint (`docs/fingerprint-spec.md`, section 3.6).
 *
 * The parser resolves control flow with one shared frame stack (`resolveControlFlow` in `@be-music/parser`): every
 * `#RANDOM n` / `#SWITCH n` line draws a value whether or not it sits in an active branch, `#IF` / `#ELSEIF` compare
 * against the innermost random frame, `#ELSE` / `#ELSEIF` / `#ENDIF` act on the innermost `#IF` frame anywhere on
 * the stack, and a line is applied when every `#IF` and `#SWITCH` frame on the stack is active. This module follows
 * exactly those rules, but for every outcome at once: it builds, per **segment** (a stretch of the capture from an
 * empty stack back to an empty stack), a reduced ordered decision diagram whose paths are the outcomes and whose leaves
 * are the lines applied for them.
 *
 * Every variable (a `#RANDOM` / `#SWITCH` line with at least two values) is split into **value classes**: one per
 * label some `#IF` / `#ELSEIF` (random) or `#CASE` (switch) line compares it with, within `1..max`, plus one class
 * `0` for all the values no line names. Values of one class behave identically.
 */
import type { BmsControlFlowCommand, BmsControlFlowEntry } from '@be-music/json';

/**
 * Evaluation budget of one segment, in steps: each line processed in one evaluation state costs one step plus the
 * number of frames on the stack. A segment that needs more is not evaluated (spec 3.7).
 */
export const CONTROL_FLOW_STEP_LIMIT = 1 << 20;

export interface ControlFlowVariable {
  /** Index among the variables of the chart, in file order. */
  index: number;
  /** Index among all `#RANDOM` / `#SWITCH` lines of the chart (including those with a single value), in file order. */
  line: number;
  /** Index of the directive in `bms.controlFlow`. */
  entry: number;
  type: 'random' | 'switch';
  max: number;
  /** Value classes: the labels in `1..max` that are tested, ascending, then `0` when some value is never tested. */
  classes: number[];
}

export type OutcomeNode =
  | { kind: 'end'; id: number }
  | { kind: 'emit'; id: number; entry: number; next: OutcomeNode }
  | { kind: 'fork'; id: number; variable: number; branches: Array<{ classes: number[]; node: OutcomeNode }> };

export interface ControlFlowSegment {
  /** First and one-past-last index in `bms.controlFlow`. */
  start: number;
  end: number;
  /** Variables drawn inside the segment, in file order. */
  variables: number[];
  /** `true` when the segment holds header or object lines (a segment of directives only has no effect). */
  hasContent: boolean;
  /** The decision diagram, or `undefined` when the segment exceeded {@link CONTROL_FLOW_STEP_LIMIT}. */
  root: OutcomeNode | undefined;
}

export interface ControlFlowAnalysis {
  variables: ControlFlowVariable[];
  segments: ControlFlowSegment[];
  /** Number of `#RANDOM` / `#SWITCH` lines (the length of a play log's `randomOutcomes`). */
  drawLines: number;
}

type FrameType = 'random' | 'switch' | 'if';

interface DynamicFrame {
  /** Index of the directive that pushed the frame. */
  id: number;
  type: FrameType;
  value: number;
  active: boolean;
  matched: boolean;
  hasElse: boolean;
  fallthrough: boolean;
  terminated: boolean;
}

/** Same parsing as the parser's `parsePositiveInteger`. */
export function parseControlFlowInteger(value: string | undefined): number | undefined {
  if (!value || value.length === 0) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  const normalized = Math.floor(parsed);
  return normalized <= 0 ? undefined : normalized;
}

function findInnermost<T extends { type: FrameType }>(stack: ReadonlyArray<T>, type: FrameType): T | undefined {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    if (stack[index]!.type === type) {
      return stack[index];
    }
  }
  return undefined;
}

function removeInnermost<T extends { type: FrameType }>(stack: T[], type: FrameType): void {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    if (stack[index]!.type === type) {
      stack.splice(index, 1);
      return;
    }
  }
}

/** Static information per directive, from a pass that tracks only the shape of the stack. */
interface DirectiveInfo {
  variable?: ControlFlowVariable;
  /** A place where states that differ only in what they emitted before can be merged. */
  mergePoint: boolean;
}

/**
 * Analyzes `bms.controlFlow`: finds the variables, their value classes and the segments, and evaluates each segment
 * into its decision diagram.
 */
export function analyzeControlFlow(
  entries: ReadonlyArray<BmsControlFlowEntry>,
  stepLimit: number = CONTROL_FLOW_STEP_LIMIT,
): ControlFlowAnalysis {
  const variables: ControlFlowVariable[] = [];
  const directives = new Map<number, DirectiveInfo>();
  /** frame id → label → last position that tests it. */
  const lastTests = new Map<number, Map<number, number>>();
  const segments: ControlFlowSegment[] = [];
  const stack: Array<{ id: number; type: FrameType }> = [];
  let drawLines = 0;
  let segmentStart = 0;
  let hasContent = false;

  const recordTest = (frameId: number | undefined, label: number | undefined, position: number): void => {
    if (frameId === undefined || label === undefined) {
      return;
    }
    let labels = lastTests.get(frameId);
    if (!labels) {
      labels = new Map();
      lastTests.set(frameId, labels);
    }
    labels.set(label, position);
  };

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    if (stack.length === 0) {
      segmentStart = index;
      hasContent = false;
    }
    if (entry.kind !== 'directive') {
      hasContent = true;
    } else {
      const info: DirectiveInfo = { mergePoint: false };
      directives.set(index, info);
      const command: BmsControlFlowCommand = entry.command;
      switch (command) {
        case 'RANDOM':
        case 'SWITCH':
        case 'SETRANDOM':
        case 'SETSWITCH': {
          const type = command === 'RANDOM' || command === 'SETRANDOM' ? 'random' : 'switch';
          if (command === 'RANDOM' || command === 'SWITCH') {
            const max = parseControlFlowInteger(entry.value) ?? 1;
            if (max >= 2) {
              const variable: ControlFlowVariable = {
                index: variables.length,
                line: drawLines,
                entry: index,
                type,
                max,
                classes: [],
              };
              variables.push(variable);
              info.variable = variable;
              info.mergePoint = true;
            }
            drawLines += 1;
          }
          stack.push({ id: index, type });
          break;
        }
        case 'IF':
        case 'ELSEIF':
          recordTest(findInnermost(stack, 'random')?.id, parseControlFlowInteger(entry.value), index);
          if (command === 'IF') {
            stack.push({ id: index, type: 'if' });
          }
          break;
        case 'CASE':
          recordTest(findInnermost(stack, 'switch')?.id, parseControlFlowInteger(entry.value), index);
          break;
        case 'ENDIF':
          removeInnermost(stack, 'if');
          info.mergePoint = true;
          break;
        case 'ENDRANDOM':
          removeInnermost(stack, 'random');
          info.mergePoint = true;
          break;
        case 'ENDSW':
          removeInnermost(stack, 'switch');
          info.mergePoint = true;
          break;
        default:
          break;
      }
    }
    if (stack.length === 0) {
      segments.push({ start: segmentStart, end: index + 1, variables: [], hasContent, root: undefined });
    }
  }
  if (stack.length > 0) {
    segments.push({ start: segmentStart, end: entries.length, variables: [], hasContent, root: undefined });
  }

  for (const variable of variables) {
    const labels = lastTests.get(variable.entry);
    const tested = [...(labels?.keys() ?? [])].filter((label) => label <= variable.max).sort((a, b) => a - b);
    variable.classes = tested.length < variable.max ? [...tested, 0] : tested;
  }

  const evaluator = new SegmentEvaluator(entries, directives, lastTests, stepLimit);
  for (const segment of segments) {
    segment.variables = variables
      .filter((variable) => variable.entry >= segment.start && variable.entry < segment.end)
      .map((variable) => variable.index);
    if (segment.hasContent) {
      segment.root = evaluator.evaluate(segment);
    }
  }
  return { variables, segments, drawLines };
}

interface Walk {
  frames: DynamicFrame[];
  position: number;
  emitted: number[];
  mergeKeys: Array<{ key: string; at: number }>;
  fork?: {
    variable: ControlFlowVariable;
    position: number;
    framesBefore: DynamicFrame[];
    next: number;
    children: OutcomeNode[];
  };
}

class SegmentEvaluator {
  readonly #entries: ReadonlyArray<BmsControlFlowEntry>;
  readonly #directives: Map<number, DirectiveInfo>;
  readonly #lastTests: Map<number, Map<number, number>>;
  readonly #stepLimit: number;
  readonly #nodes = new Map<string, OutcomeNode>();
  readonly #end: OutcomeNode = { kind: 'end', id: 0 };
  #nextId = 1;

  constructor(
    entries: ReadonlyArray<BmsControlFlowEntry>,
    directives: Map<number, DirectiveInfo>,
    lastTests: Map<number, Map<number, number>>,
    stepLimit: number,
  ) {
    this.#entries = entries;
    this.#directives = directives;
    this.#lastTests = lastTests;
    this.#stepLimit = stepLimit;
  }

  evaluate(segment: ControlFlowSegment): OutcomeNode | undefined {
    const merged = new Map<string, OutcomeNode>();
    let steps = 0;
    const stack: Walk[] = [{ frames: [], position: segment.start, emitted: [], mergeKeys: [] }];
    let result: OutcomeNode | undefined;
    const deliver = (node: OutcomeNode): void => {
      const parent = stack[stack.length - 1];
      if (parent?.fork) {
        parent.fork.children.push(node);
      } else {
        result = node;
      }
    };

    while (stack.length > 0) {
      const walk = stack[stack.length - 1]!;
      const fork = walk.fork;
      if (fork) {
        if (fork.next < fork.variable.classes.length) {
          const value = fork.variable.classes[fork.next]!;
          fork.next += 1;
          steps += fork.framesBefore.length + 1;
          if (steps > this.#stepLimit) {
            return undefined;
          }
          const frames = fork.framesBefore.map((frame) => ({ ...frame }));
          frames.push(createFrame(fork.position, fork.variable.type, value));
          stack.push({ frames, position: fork.position + 1, emitted: [], mergeKeys: [] });
          continue;
        }
        walk.fork = undefined;
        const node = this.#fork(fork.variable, fork.children);
        stack.pop();
        deliver(this.#finish(walk, node, merged));
        continue;
      }

      let base: OutcomeNode | undefined;
      while (base === undefined) {
        if (walk.position >= segment.end) {
          base = this.#end;
          break;
        }
        const entry = this.#entries[walk.position]!;
        steps += 1 + walk.frames.length;
        if (steps > this.#stepLimit) {
          return undefined;
        }
        if (entry.kind === 'directive') {
          const info = this.#directives.get(walk.position)!;
          if (info.mergePoint) {
            const key = this.#stateKey(walk.position, walk.frames);
            const known = merged.get(key);
            if (known) {
              base = known;
              break;
            }
            walk.mergeKeys.push({ key, at: walk.emitted.length });
          }
          if (info.variable) {
            walk.fork = {
              variable: info.variable,
              position: walk.position,
              framesBefore: walk.frames,
              next: 0,
              children: [],
            };
            break;
          }
          applyDirective(walk.frames, entry.command, entry.value, walk.position);
        } else if (isActive(walk.frames)) {
          walk.emitted.push(walk.position);
        }
        walk.position += 1;
      }
      if (walk.fork) {
        continue;
      }
      stack.pop();
      deliver(this.#finish(walk, base!, merged));
    }
    return result;
  }

  /** Folds a walk's emitted lines onto `base`, recording the node at each merge point it passed. */
  #finish(walk: Walk, base: OutcomeNode, merged: Map<string, OutcomeNode>): OutcomeNode {
    let node = base;
    let index = walk.emitted.length;
    for (let point = walk.mergeKeys.length - 1; point >= 0; point -= 1) {
      const { key, at } = walk.mergeKeys[point]!;
      while (index > at) {
        index -= 1;
        node = this.#emit(walk.emitted[index]!, node);
      }
      merged.set(key, node);
    }
    while (index > 0) {
      index -= 1;
      node = this.#emit(walk.emitted[index]!, node);
    }
    return node;
  }

  #emit(entry: number, next: OutcomeNode): OutcomeNode {
    const key = `E${entry}:${next.id}`;
    let node = this.#nodes.get(key);
    if (!node) {
      node = { kind: 'emit', id: this.#nextId++, entry, next };
      this.#nodes.set(key, node);
    }
    return node;
  }

  /** A fork with its classes grouped by identical child; a fork whose classes all lead to one child is that child. */
  #fork(variable: ControlFlowVariable, children: ReadonlyArray<OutcomeNode>): OutcomeNode {
    const groups = new Map<OutcomeNode, number[]>();
    variable.classes.forEach((value, index) => {
      const child = children[index]!;
      const group = groups.get(child);
      if (group) {
        group.push(value);
      } else {
        groups.set(child, [value]);
      }
    });
    if (groups.size === 1) {
      return children[0]!;
    }
    const branches = [...groups.entries()].map(([node, classes]) => ({ classes, node }));
    const key = `F${variable.index}:${branches.map((branch) => `${branch.classes.join(',')}=${branch.node.id}`).join(';')}`;
    let node = this.#nodes.get(key);
    if (!node) {
      node = { kind: 'fork', id: this.#nextId++, variable: variable.index, branches };
      this.#nodes.set(key, node);
    }
    return node;
  }

  /**
   * Abstract state at a merge point: each frame's flags, and each random / switch value only when some later line still
   * compares that frame with it (otherwise it behaves like any untested value).
   */
  #stateKey(position: number, frames: ReadonlyArray<DynamicFrame>): string {
    let key = `${position}`;
    for (const frame of frames) {
      if (frame.type === 'if') {
        key += `|i${frame.active ? 1 : 0}${frame.matched ? 1 : 0}${frame.hasElse ? 1 : 0}`;
        continue;
      }
      const last = this.#lastTests.get(frame.id)?.get(frame.value);
      const value = last !== undefined && last >= position ? String(frame.value) : 'o';
      key +=
        frame.type === 'random'
          ? `|r${value}`
          : `|s${value}${frame.active ? 1 : 0}${frame.matched ? 1 : 0}${frame.fallthrough ? 1 : 0}${frame.terminated ? 1 : 0}`;
    }
    return key;
  }
}

function createFrame(id: number, type: FrameType, value: number): DynamicFrame {
  return { id, type, value, active: false, matched: false, hasElse: false, fallthrough: false, terminated: false };
}

function isActive(frames: ReadonlyArray<DynamicFrame>): boolean {
  for (const frame of frames) {
    if (frame.type !== 'random' && !frame.active) {
      return false;
    }
  }
  return true;
}

/** The parser's `applyControlFlowCommand` for every directive but a variable draw. */
function applyDirective(
  stack: DynamicFrame[],
  command: BmsControlFlowCommand,
  rawValue: string | undefined,
  position: number,
): void {
  switch (command) {
    case 'RANDOM':
    case 'SWITCH':
      // Only single-value draws get here.
      stack.push(createFrame(position, command === 'RANDOM' ? 'random' : 'switch', 1));
      return;
    case 'SETRANDOM':
    case 'SETSWITCH':
      stack.push(
        createFrame(position, command === 'SETRANDOM' ? 'random' : 'switch', parseControlFlowInteger(rawValue) ?? 1),
      );
      return;
    case 'IF': {
      const label = parseControlFlowInteger(rawValue);
      const random = findInnermost(stack, 'random');
      const matched = label !== undefined && random !== undefined && label === random.value;
      const frame = createFrame(position, 'if', 0);
      frame.active = matched;
      frame.matched = matched;
      stack.push(frame);
      return;
    }
    case 'ELSEIF': {
      const frame = findInnermost(stack, 'if');
      if (!frame || frame.hasElse || frame.matched) {
        if (frame) {
          frame.active = false;
        }
        return;
      }
      const label = parseControlFlowInteger(rawValue);
      const random = findInnermost(stack, 'random');
      const matched = label !== undefined && random !== undefined && label === random.value;
      frame.active = matched;
      if (matched) {
        frame.matched = true;
      }
      return;
    }
    case 'ELSE': {
      const frame = findInnermost(stack, 'if');
      if (!frame || frame.hasElse) {
        if (frame) {
          frame.active = false;
        }
        return;
      }
      frame.hasElse = true;
      frame.active = !frame.matched;
      frame.matched = true;
      return;
    }
    case 'ENDIF':
      removeInnermost(stack, 'if');
      return;
    case 'ENDRANDOM':
      removeInnermost(stack, 'random');
      return;
    case 'CASE':
    case 'DEF': {
      const frame = findInnermost(stack, 'switch');
      if (!frame) {
        return;
      }
      if (frame.terminated) {
        frame.active = false;
        frame.fallthrough = false;
        return;
      }
      if (frame.fallthrough) {
        frame.active = true;
        return;
      }
      const label = parseControlFlowInteger(rawValue);
      const matched = command === 'CASE' ? label !== undefined && label === frame.value : !frame.matched;
      frame.active = matched;
      frame.fallthrough = matched;
      if (matched) {
        frame.matched = true;
      }
      return;
    }
    case 'SKIP': {
      const frame = findInnermost(stack, 'switch');
      if (frame?.active) {
        frame.terminated = true;
        frame.active = false;
        frame.fallthrough = false;
      }
      return;
    }
    case 'ENDSW':
      removeInnermost(stack, 'switch');
      return;
    default:
      return;
  }
}

/** Number of paths of a diagram (each fork branch counts once, whatever its number of classes). */
export function countOutcomePaths(root: OutcomeNode, limit: number): number {
  const counts = new Map<OutcomeNode, number>();
  const stack: Array<{ node: OutcomeNode; expanded: boolean }> = [{ node: root, expanded: false }];
  while (stack.length > 0) {
    const top = stack[stack.length - 1]!;
    const { node } = top;
    if (counts.has(node)) {
      stack.pop();
      continue;
    }
    const children = node.kind === 'emit' ? [node.next] : node.kind === 'fork' ? node.branches.map((b) => b.node) : [];
    if (!top.expanded) {
      top.expanded = true;
      for (const child of children) {
        if (!counts.has(child)) {
          stack.push({ node: child, expanded: false });
        }
      }
      continue;
    }
    let count = children.length === 0 ? 1 : 0;
    if (node.kind === 'emit') {
      count = counts.get(node.next)!;
    } else if (node.kind === 'fork') {
      for (const child of children) {
        count += counts.get(child)!;
      }
    }
    counts.set(node, Math.min(count, limit + 1));
    stack.pop();
  }
  return counts.get(root)!;
}

/** The values a set of classes of a variable stands for, as ascending, disjoint, non-adjacent `[low, high]` ranges. */
export function classValueRanges(
  variable: ControlFlowVariable,
  classes: ReadonlyArray<number>,
): Array<[number, number]> {
  const values: number[] = classes.filter((value) => value !== 0);
  const ranges: Array<[number, number]> = [];
  if (classes.includes(0)) {
    // The untested values: the gaps between the tested labels within 1..max.
    let next = 1;
    for (const label of variable.classes) {
      if (label === 0) {
        continue;
      }
      if (label > next) {
        ranges.push([next, label - 1]);
      }
      next = label + 1;
    }
    if (next <= variable.max) {
      ranges.push([next, variable.max]);
    }
  }
  for (const value of values) {
    ranges.push([value, value]);
  }
  ranges.sort((left, right) => left[0] - right[0]);
  const merged: Array<[number, number]> = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1] + 1) {
      last[1] = Math.max(last[1], range[1]);
    } else {
      merged.push([range[0], range[1]]);
    }
  }
  return merged;
}

/** The class a drawn value falls into. */
export function classOfValue(variable: ControlFlowVariable, value: number): number {
  return variable.classes.includes(value) && value !== 0 ? value : 0;
}
