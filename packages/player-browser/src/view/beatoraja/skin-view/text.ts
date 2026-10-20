import { BitmapText, Text, type Container } from 'pixi.js';
import type {
  BeatorajaDestinationGroup,
  BeatorajaLuaRuntimeContext,
  BeatorajaSkinFontId,
  BeatorajaTextElement,
} from '@be-music/skin-beatoraja';
import type { destinationToSpriteProps } from '../../../skin/beatoraja/render.ts';
import { BEATORAJA_VIEW_DIAGNOSTICS } from './common.ts';
import type { BeatorajaSkinLuaContext } from './lua-context.ts';
import type { BeatorajaPlaySkinViewOptions } from './options.ts';

export interface TextEntry {
  kind: 'text';
  group: BeatorajaDestinationGroup;
  element: BeatorajaTextElement;
  /**
   * Either a Pixi `Text` (CSS-fonts pipe) or a `BitmapText` (BMFont pipe). Both extend
   * `AbstractText` and share `text` / position / `style.*` accessors, so the per-frame update path
   * is identical. The pick is made once at build-time from `resolveFontKind` — no runtime
   * branching during the `update` hot path.
   */
  text: Text | BitmapText;
}

/** Builds and updates the `text[]` entries of a {@link BeatorajaPlaySkinView}. */
export class BeatorajaTextRenderer {
  private readonly container: Container;
  private readonly resolveTextContent: (refOp: number) => string | undefined;
  private readonly resolveFontFamily: (fontId: BeatorajaSkinFontId) => string | undefined;
  private readonly resolveFontKind: (fontId: BeatorajaSkinFontId) => 'css' | 'bitmap' | undefined;
  private readonly resolveStringProperty: BeatorajaSkinLuaContext['resolveStringProperty'];

  constructor(
    container: Container,
    options: BeatorajaPlaySkinViewOptions,
    resolveStringProperty: BeatorajaSkinLuaContext['resolveStringProperty'],
  ) {
    this.container = container;
    this.resolveTextContent = options.resolveTextContent ?? (() => undefined);
    this.resolveFontFamily = options.resolveFontFamily ?? (() => undefined);
    this.resolveFontKind = options.resolveFontKind ?? (() => undefined);
    this.resolveStringProperty = resolveStringProperty;
  }

  buildTextEntry(group: BeatorajaDestinationGroup, element: BeatorajaTextElement): TextEntry {
    // Pick the skin-author's font (TTF or BMFont) when one was loaded for this `font` slot; fall
    // back to the platform sans-serif chain otherwise. For CSS fonts the stack fallback
    // (`sans-serif` after the skin family) covers two cases at once: (1) the skin family hasn't
    // finished registering yet, and (2) a glyph not present in the skin font (Japanese full-width,
    // emoji, etc.) gets borrowed from the system font without showing tofu. BMFonts don't get a
    // sans-serif fallback baked into the family — Pixi's BitmapText cache lookup is exact, so
    // appending `, sans-serif` would just miss the cache.
    const skinFamily = this.resolveFontFamily(element.fontId);
    const fontKind = this.resolveFontKind(element.fontId) ?? 'css';
    const fontFamily =
      skinFamily === undefined ? 'sans-serif' : fontKind === 'bitmap' ? skinFamily : `'${skinFamily}', sans-serif`;
    // Mirror beatoraja's `SkinTextFont.draw()`:
    //
    //     font.getData().setScale(region.height / parameter.size);
    //
    // The font is loaded ONCE at `text[].size` glyph height (= `parameter.size`), then
    // scaled at draw time so the rendered glyph height matches the destination rect's
    // current `h`. Final on-screen text height = `dst.h` regardless of the authored
    // `size` — that's why default beatoraja's `genre` / `artist` (dst.h=20) render
    // visibly smaller than `title` (dst.h=24) even though all three set `size: 24`.
    //
    // We rasterize Pixi's `Text` / `BitmapText` at the AUTHORED `text[].size` (so the
    // glyph bitmap is sharp at the author's intended baseline), then apply a per-frame
    // `text.scale.y = props.height / fontSize` in `updateTextEntry` to mirror upstream's
    // `setScale`. This handles two cases the previous "fontSize = dst[0].h" approach
    // got wrong:
    //   1. Animated text (h changes over time): we used to lock fontSize at the t=0
    //      keyframe and never updated, so a 540→24 zoom-down would render at 540 forever.
    //      Now scale tracks the current keyframe's h.
    //   2. Layout-variant gated dst[]: when the t=0 frame's `if[]` resolves to a huge
    //      catch-all variant (because the matching layout op isn't in activeOps), we'd
    //      lock fontSize at that giant value. Now the visible size is governed by the
    //      runtime keyframe's h, which is bounded sensibly by the resolver fallback.
    //
    // Falls back to `dst[0].h` only when `text[].size` is omitted (some Lua skins author
    // size on the destination rather than the element); final guard at 24 for skins
    // authoring neither.
    //
    // **Sign normalization** — AngelCode BMFont's authoring convention is "POSITIVE = points,
    // NEGATIVE = pixels", and the sign is also baked into the .fnt's `info size=N` line. Skins
    // pair the two: when the .fnt declares `size=-120` (the GroundbreakinG `Title.fnt` does
    // exactly this), the skin authors `text.size = -118` to match. Upstream
    // `SkinTextBitmap.draw` line 59 computes `scale = this.size / source.getOriginalSize()`,
    // and the matched signs cancel to a positive scale (`-118 / -120 = +0.983`); the rendered
    // glyph height ends up `|text.size|` px. We mirror this by taking `Math.abs(element.size)`
    // — Pixi's `style.fontSize` doesn't have well-defined semantics for negative values
    // (BMFont layout would compute a NEGATIVE scale and render the text 180° flipped), so we
    // can't pass the sign through. Pairing this with the `Math.abs(parsed.fontSize)` we apply
    // when registering the BitmapFont (see `skin/beatoraja/fonts.ts`) reproduces upstream's
    // "rendered height = |text.size|" identity exactly.
    const firstFrame = group.dst[0];
    const rectH = firstFrame !== undefined && firstFrame.h > 0 ? firstFrame.h : 0;
    const absElementSize = Math.abs(element.size);
    const requestedSize = absElementSize > 0 ? absElementSize : rectH > 0 ? rectH : 24;
    // Pick `BitmapText` for BMFonts and `Text` for everything else. Both share the same constructor
    // surface (`text`, `style.fontFamily`, `style.fontSize`, `style.align`, `alpha`, anchors), so
    // downstream update code doesn't branch — see `updateTextEntry`.
    const TextCtor: typeof Text | typeof BitmapText =
      fontKind === 'bitmap' && skinFamily !== undefined ? BitmapText : Text;
    // Outline / drop-shadow styling (audit 2.10). Beatoraja's text element carries
    // `outlineColor`/`outlineWidth` and `shadowColor`/`shadowOffset{X,Y}`/`shadowSmoothness`;
    // the alpha byte of the color string is `00` when the feature is disabled, so we gate
    // application on `alpha > 0` (matching beatoraja's "outline color disabled" sentinel).
    // ModernChic Decide's title / genre / artist / stage labels (textproperty.lua:62-71)
    // rely on this — without the styling the text reads as flat white-on-bg with no outline,
    // which loses the difficulty-tinted ring the skin uses to communicate the chart's
    // difficulty level.
    const stroke =
      element.outlineColor.alpha > 0 && element.outlineWidth > 0
        ? { color: element.outlineColor.rgb, alpha: element.outlineColor.alpha, width: element.outlineWidth }
        : undefined;
    // Pixi expresses drop shadow as `{ distance, angle }` polar coordinates. Beatoraja
    // authors offsets in `(x, y)` cartesian — convert via hypot / atan2.
    const dropShadow =
      element.shadowColor.alpha > 0 && (element.shadowOffsetX !== 0 || element.shadowOffsetY !== 0)
        ? {
            color: element.shadowColor.rgb,
            alpha: element.shadowColor.alpha,
            distance: Math.hypot(element.shadowOffsetX, element.shadowOffsetY),
            angle: Math.atan2(element.shadowOffsetY, element.shadowOffsetX),
            blur: element.shadowSmoothness,
          }
        : undefined;
    const text = new TextCtor({
      text: '',
      style: {
        fontFamily,
        fontSize: requestedSize,
        fill: 0xffffff,
        align: element.align,
        // Pixi types treat `wordWrap` and `wordWrapWidth` as a pair; we leave the width
        // unset so it falls back to the dst rect bounds the entry sets per-frame in
        // `updateTextEntry` (via `style.wordWrapWidth`).
        wordWrap: element.wrapping,
        ...(stroke !== undefined ? { stroke } : {}),
        ...(dropShadow !== undefined ? { dropShadow } : {}),
      },
      alpha: 0,
    });
    // Anchor controls the (x, y) origin point. Beatoraja's reference theme positions text by the
    // dst rect's TOP-LEFT (or top-center / top-right with `align`); the y-anchor stays 0 so the
    // text's top edge sits at `props.y`.
    if (element.align === 'center') text.anchor.set(0.5, 0);
    else if (element.align === 'right') text.anchor.set(1, 0);
    this.container.addChild(text);
    // eslint-disable-next-line no-console
    console.log(
      '[beatoraja-view] text entry built',
      JSON.stringify({
        id: element.id,
        ref: element.ref,
        fontId: element.fontId,
        size: requestedSize,
        align: element.align,
        family: fontFamily,
        kind: fontKind,
        firstRect: firstFrame ? { x: firstFrame.x, y: firstFrame.y, w: firstFrame.w, h: firstFrame.h } : undefined,
      }),
    );
    return { kind: 'text', group, element, text };
  }

  updateTextEntry(
    entry: TextEntry,
    props: ReturnType<typeof destinationToSpriteProps>,
    luaContext: BeatorajaLuaRuntimeContext,
  ): void {
    const text = entry.text;
    text.visible = props.visible;
    if (!props.visible) return;

    // Skip the assignment when the string hasn't changed — assigning the same string still triggers
    // a Pixi glyph relayout, which is expensive (canvas rasterization).
    //
    // Resolution priority:
    //   1. `constantText` — Lua-baked literal (GdbG result's `Avg N ms` strings, etc.) wins
    //      unconditionally. Beatoraja's reference renderer treats this as a static label
    //      regardless of `ref` / `valueProperty`.
    //   2. `valueProperty` — Lua function-as-string-property (uncommon).
    //   3. `ref` — runtime-resolved op code (titles / artists / etc.).
    //   4. Empty fallback for `ref = 0` placeholder rows.
    const next =
      entry.element.constantText !== undefined
        ? entry.element.constantText
        : entry.element.valueProperty !== undefined
          ? this.resolveStringProperty(entry.element.valueProperty, luaContext)
          : entry.element.ref !== 0
            ? (this.resolveTextContent(entry.element.ref) ?? '')
            : '';
    if (text.text !== next) {
      text.text = next;
      if (BEATORAJA_VIEW_DIAGNOSTICS) {
        // eslint-disable-next-line no-console
        console.log(
          '[beatoraja-view] text content',
          JSON.stringify({ id: entry.element.id, ref: entry.element.ref, text: next }),
        );
      }
    }

    // The destination's `x` is the ANCHOR POINT, not the bounding-box left edge. Upstream
    // `SkinTextFont.java:107` interprets `region.x` per align:
    //
    //     final float x = (getAlign() == 2 ? region.x - region.width
    //                    : getAlign() == 1 ? region.x - region.width / 2
    //                    : region.x);
    //     sprite.draw(font, layout, x + offsetX, ...);   // layout halign = ALIGN[getAlign()]
    //
    // After libGDX's `GlyphLayout` applies the layout's `halign` within `[x, x + region.width]`:
    //   - align=0 LEFT:   text's LEFT edge at `region.x` (no shift).
    //   - align=1 CENTER: text's CENTER at `region.x` (shifted by -region.width/2 then centered).
    //   - align=2 RIGHT:  text's RIGHT edge at `region.x` (shifted by -region.width then right-anchored).
    //
    // In Pixi we get the same effect by setting `text.x = props.x` regardless of align, with
    // the Pixi `text.anchor.x = 0 / 0.5 / 1` set at build time per the same align value. The
    // anchor's local-space pivot lands at `text.x` in parent coords, so the LEFT / CENTER /
    // RIGHT of the text span sits at `region.x` exactly as upstream — no per-frame offset.
    //
    // Audit A-4 (2024-12): the previous TS impl added `+ props.width / 2` (center) and
    // `+ props.width` (right) to text.x, treating the dst rect as a bounding box rather than
    // an anchor point. That landed `align=2 RIGHT` text `region.width` to the RIGHT of where
    // upstream paints it.
    //
    // Width / height aren't forced onto the Text node: beatoraja's `text[]` semantics is
    // "render glyphs at `size` px with auto-width" — clamping to the dst rect would scale
    // the type, which is what beatoraja explicitly avoids.
    text.x = props.x;
    text.y = props.y;
    text.alpha = props.alpha;
    text.tint = props.tint;
    text.angle = props.angle;
    text.blendMode = props.blendMode;
    // Word-wrap width — Pixi's text style treats `wordWrap` and `wordWrapWidth` as a pair, so
    // when authors set `wrapping = true` we need a width or Pixi falls back to its 100px
    // default. Mirror the destination's current width so wrapping happens at the dst rect
    // boundary (matches beatoraja's libGDX `BitmapFontCache.addText(..., maxWidth, ...)` where
    // `maxWidth = region.width`). Skip when wrapping is off — wordWrapWidth is harmless then,
    // but keeping it untouched avoids gratuitous Pixi style invalidation on non-wrap text.
    if (entry.element.wrapping && props.width > 0 && text.style.wordWrapWidth !== props.width) {
      text.style.wordWrapWidth = props.width;
    }
    // Per-frame scale — diverges between TTF (CSS-fonts) and bitmap (.fnt) text per upstream:
    //
    //  - **TTF / FreeType** (`SkinTextFont.java:103`):
    //        font.getData().setScale(region.height / parameter.size);
    //    The font is rasterized at `text[].size` and the per-frame scale tracks the current
    //    keyframe's `region.height`. Animated-h dst rects scale the glyphs proportionally.
    //
    //  - **Bitmap font / .fnt** (`SkinTextBitmap.java:59`):
    //        float scale = this.size / source.getOriginalSize();
    //        font.getData().setScale(scale);
    //    The scale is a CONSTANT derived from the authored `text[].size` and the .fnt's
    //    natural size. `region.height` is IGNORED for sizing — the displayed glyph height
    //    equals `text[].size` regardless of the dst rect's height.
    //
    //    Pixi's BitmapText resolves the bitmap's natural size automatically and renders at
    //    `style.fontSize` (= `text[].size`, set at build time). With `scale = 1` the rendered
    //    height equals `text[].size` — matching upstream's effective output.
    //
    // `overflow = 1` (= shrink-to-fit, `SkinTextFont.java:124-130` & `SkinTextBitmap.java:94-100`):
    // when the rendered text is wider than the destination box at the height-derived scale,
    // x-shrink proportionally so it stays inside. Applies to both TTF and bitmap. Other
    // `overflow` modes (`0` = no handling, `2` = clip — uncommon) leave xScale at the
    // height-derived value (no horizontal shrink applied).
    //
    // `Math.abs` mirrors the build-time `absElementSize` derivation in `buildTextEntry` — the
    // BMFont sign convention treats `text.size`'s sign as a pixel-vs-point unit hint, not a
    // signed magnitude, and upstream's `scale = this.size / originalSize` cancels the matched
    // negatives. We strip the sign on both sides (.fnt fontSize and skin text.size) so the
    // resulting Pixi scale is positive and the rendered glyph height equals `|text.size|`.
    const referenceSize = Math.abs(entry.element.size) > 0 ? Math.abs(entry.element.size) : 24;
    const isBitmap = text instanceof BitmapText;
    const baseScale = isBitmap ? 1 : props.height > 0 ? props.height / referenceSize : 1;
    let scaleX = baseScale;
    const scaleY = baseScale;
    if (entry.element.overflow === 1 && props.width > 0) {
      // text.width is the natural width at the current scale (Pixi reports post-scale
      // dimensions). Recover the unscaled width by dividing by the current scale, then check
      // if the would-be drawn width at `baseScale` exceeds the box — shrink x if so.
      const unscaledWidth = text.width / Math.max(text.scale.x, 0.0001);
      const drawnWidth = unscaledWidth * baseScale;
      if (drawnWidth > props.width && drawnWidth > 0) {
        scaleX = baseScale * (props.width / drawnWidth);
      }
    }
    text.scale.set(scaleX, scaleY);
  }
}
