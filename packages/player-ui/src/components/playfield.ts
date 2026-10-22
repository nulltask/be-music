import { css, html, nothing, type CSSResultGroup, type TemplateResult } from 'lit';
import type { BeMusicGameplayFrame, BeMusicRect } from '@be-music/player-skin-sdk';
import { FrameElement } from '../base.ts';
import { resolvePlayfieldParts } from '../playfield/parts.ts';

/**
 * Places each playfield component on its part of the stage, letterboxed into the element like the gameplay HUD.
 * Layout composition only: the caller hands it a frame per animation frame, and the components draw nothing else.
 */
export class BeMusicPlayfieldElement extends FrameElement<BeMusicGameplayFrame> {
  static override styles: CSSResultGroup = css`
    :host {
      display: block;
      position: absolute;
      inset: 0;
      container-type: size;
      pointer-events: none;
      background: var(--be-music-letterbox-background, #05070b);
    }
    .stage {
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      width: min(100cqw, calc(100cqh * var(--stage-ratio, 1)));
      height: min(100cqh, calc(100cqw / var(--stage-ratio, 1)));
      background: var(--be-music-color-background, #10151f);
    }
    .stage > * {
      position: absolute;
    }
  `;

  protected override render(): TemplateResult | typeof nothing {
    const frame = this.frame;
    if (!frame) return nothing;
    const parts = resolvePlayfieldParts(frame);
    const { width, height } = parts.stage;
    const place = (rect: BeMusicRect): string =>
      `left:${(rect.x / width) * 100}%;top:${(rect.y / height) * 100}%;width:${(rect.w / width) * 100}%;height:${(rect.h / height) * 100}%`;
    return html`<div class="stage" part="stage" style=${`--stage-ratio:${width / height}`}>
      <be-music-bga
        part="bga"
        style=${place(parts.bga.rect)}
        .rect=${parts.bga.rect}
        .data=${parts.bga.data}
      ></be-music-bga>
      <be-music-lanes
        part="lanes"
        style=${place(parts.lanes.rect)}
        .rect=${parts.lanes.rect}
        .data=${parts.lanes.data}
      ></be-music-lanes>
      <be-music-notes
        part="notes"
        style=${place(parts.notes.rect)}
        .rect=${parts.notes.rect}
        .data=${parts.notes.data}
      ></be-music-notes>
      <be-music-lane-covers
        part="lane-covers"
        style=${place(parts.laneCovers.rect)}
        .rect=${parts.laneCovers.rect}
        .data=${parts.laneCovers.data}
      ></be-music-lane-covers>
      <be-music-judge-line
        part="judge-line"
        style=${place(parts.judgeLine.rect)}
        .rect=${parts.judgeLine.rect}
        .data=${parts.judgeLine.data}
      ></be-music-judge-line>
      <be-music-bombs
        part="bombs"
        style=${place(parts.bombs.rect)}
        .rect=${parts.bombs.rect}
        .data=${parts.bombs.data}
      ></be-music-bombs>
      <be-music-judgment-display
        part="judgment-display"
        style=${place(parts.judgmentDisplay.rect)}
        .rect=${parts.judgmentDisplay.rect}
        .data=${parts.judgmentDisplay.data}
      ></be-music-judgment-display>
    </div>`;
  }
}
