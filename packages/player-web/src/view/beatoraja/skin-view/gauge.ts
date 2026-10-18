import { Sprite, type Container, type Texture } from 'pixi.js';
import {
  centerToAnchor,
  computeBeatorajaGaugeAnimation,
  pickBeatorajaGaugeNode,
  type BeatorajaDestinationGroup,
  type BeatorajaGaugeElement,
  type BeatorajaImageElement,
  type BeatorajaImageId,
} from '@be-music/beatoraja-skin';
import {
  createCroppedBeatorajaTexture,
  type BeatorajaRenderContext,
  type destinationToSpriteProps,
} from '../../../skin/beatoraja/render.ts';
import type { BeatorajaTextureCache } from '../../../skin/beatoraja/textures.ts';
import { applyTextureFilterMode, BEATORAJA_VIEW_DIAGNOSTICS } from './common.ts';
import type { BeatorajaPlaySkinViewOptions } from './options.ts';

/**
 * Diagnostic state for a gauge entry — emits one structured log per "interesting transition"
 * (first state seen, mode flip, value/border drop to zero, all-cells-hidden frame). Lets
 * post-mortem investigations see why a gauge appears blank without spamming the console
 * on every frame.
 *
 * Added during the ModernChic black-gauge investigation (audit follow-up): when the user
 * reports a black gauge, the most useful info is whether the state resolver fed us a sane
 * (value, border, max, mode) tuple or whether every cell `pickBeatorajaGaugeNode` returned
 * `undefined` (= no node texture → cell hides, leaving the pure-black canvas underneath).
 */
interface GaugeDiagState {
  /** Logged at least once after the entry resolves — tells us the build outcome. */
  initialDeclLogged: boolean;
  /** Last (mode, value-bucket, border-bucket) snapshot — log when this changes. */
  lastSnapshotKey: string;
  /** Frames in a row where every cell hid (= visual black). Logged on the first run. */
  allHiddenLogged: boolean;
}

export interface GaugeEntry {
  kind: 'gauge';
  group: BeatorajaDestinationGroup;
  element: BeatorajaGaugeElement;
  /**
   * Per-cell sprite pool — sized to `element.parts` at build time. Each cell paints one of the
   * `nodes[]` images, swapped per frame as the gauge value crosses thresholds. The cells share
   * the destination's keyframe-driven (x, y, w, h) — total width is divided by `parts` for the
   * per-cell width.
   */
  cells: Sprite[];
  /**
   * FLICKERING-mode overlay sprite painted on top of the topmost lit cell (the one whose
   * `i === notes` boundary marks the live gauge edge). Beatoraja's `SkinGauge.draw` blits two
   * sprites for that cell: the base lit node, then a second highlight node ON TOP of it that
   * pulses with the gauge animation. Only the FLICKERING animation type uses this — the
   * others rely on per-cell texture swaps via `pickBeatorajaGaugeNode` alone.
   *
   * Allocated once at build time (added LAST to the container so it z-orders above every base
   * cell). Hidden when the picker doesn't return a `flickerOverlayId` for any cell.
   */
  overlay: Sprite;
  /**
   * Pre-resolved `(nodeId → cropped Texture)` map. Only nodes referenced by `nodes[]` are
   * present; the renderer queries by id during the per-cell texture swap.
   */
  nodeTextures: ReadonlyMap<BeatorajaImageId, Texture>;
  /** Per-frame diagnostic-log gating. See {@link GaugeDiagState} for the rationale. */
  diag: GaugeDiagState;
}

/** Builds and updates the `gauge` entry of a {@link BeatorajaPlaySkinView}. */
export class BeatorajaGaugeRenderer {
  private readonly container: Container;
  private readonly resolveGaugePercent: () => number | undefined;

  constructor(container: Container, options: BeatorajaPlaySkinViewOptions) {
    this.container = container;
    this.resolveGaugePercent = options.resolveGaugePercent ?? (() => undefined);
  }

  /**
   * Build a gauge entry — `parts` cell sprites pre-cropped from the `nodes[]` images. The cell
   * sprites share the destination's keyframe-driven (x, y, w, h); per-cell width is the total
   * width divided by `parts`. Each frame, every cell's texture is swapped to the matching
   * lit / off node based on the live gauge percent (`pickBeatorajaGaugeNode`).
   */
  buildGaugeEntry(
    group: BeatorajaDestinationGroup,
    element: BeatorajaGaugeElement,
    imageById: ReadonlyMap<BeatorajaImageId, BeatorajaImageElement>,
    textures: BeatorajaTextureCache,
  ): GaugeEntry | undefined {
    const nodeTextures = new Map<BeatorajaImageId, Texture>();
    for (const nodeId of element.nodes) {
      if (nodeTextures.has(nodeId)) continue;
      const image = imageById.get(nodeId);
      if (image === undefined) continue;
      const baseTexture = textures.get(image.src);
      if (baseTexture === undefined) continue;
      const cropped = createCroppedBeatorajaTexture(baseTexture, {
        x: image.x,
        y: image.y,
        w: image.w,
        h: image.h,
      });
      if (cropped !== undefined) nodeTextures.set(nodeId, cropped);
    }
    if (nodeTextures.size === 0) return undefined;
    const cells: Sprite[] = [];
    // Pick a default initial texture so the first render pass has something — `nodeTextures`
    // values() is order-of-insertion, so this always exists when `size > 0`.
    const firstTexture = nodeTextures.values().next().value;
    for (let i = 0; i < element.parts; i += 1) {
      const sprite = new Sprite({ texture: firstTexture, alpha: 0 });
      this.container.addChild(sprite);
      cells.push(sprite);
    }
    // FLICKERING overlay sprite. Mounted AFTER the base cells so its draw order is on top of
    // them — beatoraja's `SkinGauge.draw` paints the second blit overtop the first. Hidden by
    // default; `updateGaugeEntry` flips it visible and positions it on the topmost lit cell
    // when the picker returns a `flickerOverlayId` (FLICKERING animation type only).
    const overlay = new Sprite({ texture: firstTexture, alpha: 0 });
    overlay.visible = false;
    this.container.addChild(overlay);
    // Filter mode applies to every node texture used by this gauge, but they likely share a
    // single source (the gauge atlas). Apply to the first one and trust that pattern.
    const firstNode = nodeTextures.values().next().value;
    if (firstNode !== undefined) applyTextureFilterMode(firstNode, group.filter);
    // Build-time diagnostic — emit one structured line covering the resolved declaration so
    // post-mortem investigation of black-gauge / wrong-nodes reports can be cross-referenced
    // against the skin's authored gauge declaration. Resolved-vs-missing node breakdown lets
    // us spot when an authored node id failed to resolve into a texture (= the gauge's
    // painter has no glyph for that cell, so it hides).
    const resolvedNodes = Array.from(nodeTextures.keys()).map(String);
    const missingNodes: string[] = [];
    for (const nodeId of element.nodes) {
      if (!nodeTextures.has(nodeId)) missingNodes.push(String(nodeId));
    }
    // eslint-disable-next-line no-console
    console.log(
      '[beatoraja-view] gauge entry built',
      JSON.stringify({
        groupId: String(group.id),
        parts: element.parts,
        animationType: element.type,
        animationRange: element.range,
        cycle: element.cycle,
        nodeIds: element.nodes.slice(0, 24).map(String),
        nodeCount: element.nodes.length,
        resolvedNodes: resolvedNodes.slice(0, 24),
        missingNodeCount: missingNodes.length,
        missingNodes: missingNodes.slice(0, 12),
      }),
    );
    return {
      kind: 'gauge',
      group,
      element,
      cells,
      overlay,
      nodeTextures,
      diag: { initialDeclLogged: false, lastSnapshotKey: '', allHiddenLogged: false },
    };
  }

  /**
   * Update a gauge entry. Lays out `element.parts` cells horizontally inside the destination
   * rect, picking each cell's node texture from `pickBeatorajaGaugeNode` based on the live gauge
   * percent. Cells whose threshold is below the gauge value paint the lit-state node; those
   * above paint the off-state node. The dst rect's center anchor still applies (whole bar
   * pivots together).
   */
  updateGaugeEntry(
    entry: GaugeEntry,
    props: ReturnType<typeof destinationToSpriteProps>,
    context: BeatorajaRenderContext,
  ): void {
    const visible = props.visible;
    if (!visible) {
      for (const cell of entry.cells) cell.visible = false;
      entry.overlay.visible = false;
      return;
    }
    // Pull the full gauge state for the spec-correct picker (audit 1.4). Falls back to a
    // synthesized state derived from the legacy percent resolver when the host hasn't wired
    // `resolveGaugeState` (= the test path or pre-frame state). `mode` defaults to NORMAL
    // (= 2) which produces beatoraja's groove-gauge slab.
    const fullState = context.resolveGaugeState?.();
    const state =
      fullState ??
      (() => {
        const pct = this.resolveGaugePercent() ?? 0;
        return { value: pct, max: 100, border: 80, mode: 2 };
      })();
    // Compute animation phase once per frame — the picker reads it for non-FLICKERING types.
    const animation = computeBeatorajaGaugeAnimation(entry.element, context.nowMs);
    const cellWidth = props.width / Math.max(1, entry.element.parts);
    const center = centerToAnchor(entry.group.center);
    // Track the topmost lit cell's overlay request — only one cell receives `flickerOverlayId`
    // per frame (the picker emits it for `i == notes` only). Defer the overlay paint until
    // after the cell loop so it lands on the resolved cell coordinates.
    let overlayCellIndex = -1;
    let overlayNodeId: BeatorajaImageId | undefined;
    // Per-frame diagnostic counters. Drives the "all cells hid → visual black" log so we can
    // correlate a black gauge frame with the picker's pick decisions (= which nodeId was asked
    // for, vs which the texture map actually has). Only emitted on the FIRST occurrence per
    // entry (gated by `entry.diag.allHiddenLogged`) to avoid console flooding.
    let visibleCellCount = 0;
    let pickerEmptyCount = 0;
    let textureMissingCount = 0;
    let lastMissingNodeId: BeatorajaImageId | undefined;
    for (let i = 0; i < entry.cells.length; i += 1) {
      const cell = entry.cells[i]!;
      const pick = pickBeatorajaGaugeNode(entry.element, i, state, animation);
      if (pick === undefined) {
        cell.visible = false;
        pickerEmptyCount += 1;
        continue;
      }
      const texture = entry.nodeTextures.get(pick.nodeId);
      if (texture === undefined) {
        cell.visible = false;
        textureMissingCount += 1;
        lastMissingNodeId = pick.nodeId;
        continue;
      }
      cell.visible = true;
      visibleCellCount += 1;
      cell.texture = texture;
      cell.anchor.set(center.x, center.y);
      cell.x = props.x + i * cellWidth + center.x * cellWidth;
      cell.y = props.y + center.y * props.height;
      cell.width = cellWidth;
      cell.height = props.height;
      cell.alpha = props.alpha;
      cell.tint = props.tint;
      cell.angle = props.angle;
      cell.blendMode = props.blendMode;
      if (pick.flickerOverlayId !== undefined) {
        overlayCellIndex = i;
        overlayNodeId = pick.flickerOverlayId;
      }
    }
    // FLICKERING overlay paint — beatoraja's `SkinGauge.draw` blits the highlight node ON TOP
    // of the topmost lit cell as a second sprite. Mirror that here: position on the resolved
    // cell, share the cell's tint/alpha/blend so the overlay reads as a true compositing pass
    // rather than a separately-styled element.
    if (overlayCellIndex < 0 || overlayNodeId === undefined) {
      entry.overlay.visible = false;
    } else {
      const overlayTexture = entry.nodeTextures.get(overlayNodeId);
      if (overlayTexture === undefined) {
        entry.overlay.visible = false;
      } else {
        entry.overlay.visible = true;
        entry.overlay.texture = overlayTexture;
        entry.overlay.anchor.set(center.x, center.y);
        entry.overlay.x = props.x + overlayCellIndex * cellWidth + center.x * cellWidth;
        entry.overlay.y = props.y + center.y * props.height;
        entry.overlay.width = cellWidth;
        entry.overlay.height = props.height;
        entry.overlay.alpha = props.alpha;
        entry.overlay.tint = props.tint;
        entry.overlay.angle = props.angle;
        entry.overlay.blendMode = props.blendMode;
      }
    }
    if (BEATORAJA_VIEW_DIAGNOSTICS) {
      // ─── Diagnostic logging (opt-in via local constant) ───────────────────────────────────
      // First-frame snapshot — emit once per entry covering the resolved (value, max, border,
      // mode) tuple plus the picker's pick / hide breakdown. Gives an answer to "is the gauge
      // black because the state resolver fed us NaN/0, or because the picker resolved nodes the
      // texture map doesn't have?".
      if (!entry.diag.initialDeclLogged) {
        entry.diag.initialDeclLogged = true;
        // eslint-disable-next-line no-console
        console.log(
          '[beatoraja-view] gauge first paint',
          JSON.stringify({
            groupId: String(entry.group.id),
            state: {
              value: state.value,
              max: state.max,
              border: state.border,
              mode: state.mode,
            },
            parts: entry.element.parts,
            visibleCellCount,
            pickerEmptyCount,
            textureMissingCount,
            lastMissingNodeId: lastMissingNodeId !== undefined ? String(lastMissingNodeId) : undefined,
          }),
        );
      }
      // Subsequent transition snapshots — emit when the (mode, value-bucket, border-bucket) key
      // changes. Buckets are coarse (Math.round) so ordinary frame-by-frame value drift doesn't
      // spam the log; only meaningful state shifts (e.g. mode swap on Result, value crashing
      // through 0, border flip) hit. visibleCellCount tracks alongside so we can see whether the
      // visual paint actually followed the state change.
      const bucketKey = `${state.mode}|${Math.round(state.value)}|${Math.round(state.border)}`;
      if (bucketKey !== entry.diag.lastSnapshotKey) {
        entry.diag.lastSnapshotKey = bucketKey;
        // eslint-disable-next-line no-console
        console.log(
          '[beatoraja-view] gauge state shift',
          JSON.stringify({
            groupId: String(entry.group.id),
            state: {
              value: state.value,
              max: state.max,
              border: state.border,
              mode: state.mode,
            },
            visibleCellCount,
            pickerEmptyCount,
            textureMissingCount,
          }),
        );
      }
      // All-hidden warning — fires the first frame the gauge resolves with zero visible cells.
      // The most common cause is texture-missing for every node id (visually a black gauge),
      // which we surface here so the bug report can map straight to the missing image[]
      // declaration rather than chasing the visible symptom.
      if (visibleCellCount === 0 && !entry.diag.allHiddenLogged && entry.element.parts > 0) {
        entry.diag.allHiddenLogged = true;
        // eslint-disable-next-line no-console
        console.warn(
          '[beatoraja-view] gauge all-cells-hidden',
          JSON.stringify({
            groupId: String(entry.group.id),
            parts: entry.element.parts,
            pickerEmptyCount,
            textureMissingCount,
            lastMissingNodeId: lastMissingNodeId !== undefined ? String(lastMissingNodeId) : undefined,
            state: { value: state.value, max: state.max, border: state.border, mode: state.mode },
          }),
        );
      }
    }
  }
}
