import { css, html, svg, type CSSResultGroup, type TemplateResult } from 'lit';
import { DataElement } from '../base.ts';
import type { BeMusicPlaybackData } from '../models.ts';
import { formatPlaybackTime, resolvePlaybackSeconds } from '../playback.ts';
import { previewHost, previewTheme } from '../styles/preview-theme.ts';

const ICONS = {
  play: svg`<path d="M8 5v14l11-7z" />`,
  pause: svg`<path d="M7 5h4v14H7zM13 5h4v14h-4z" />`,
  volume: svg`<path d="M4 9v6h4l5 4V5L8 9zM15.5 8.5a5 5 0 0 1 0 7l-1.4-1.4a3 3 0 0 0 0-4.2z" />`,
  muted: svg`<path d="M4 9v6h4l5 4V5L8 9zM16 9.4l1.4-1.4 2 2 2-2 1.4 1.4-2 2 2 2-1.4 1.4-2-2-2 2-1.4-1.4 2-2z" />`,
  enter: svg`<path d="M5 5h5v2H7v3H5zM14 5h5v5h-2V7h-3zM5 14h2v3h3v2H5zM17 14h2v5h-5v-2h3z" />`,
  exit: svg`<path d="M8 5h2v5H5V8h3zM14 5h2v3h3v2h-5zM5 14h5v5H8v-3H5zM14 14h5v2h-3v3h-2z" />`,
};

function icon(name: keyof typeof ICONS): TemplateResult {
  return html`<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
}

/**
 * Video-player controls for a preview: play / pause, a seek bar, the time, mute and volume, and full screen. Dragging
 * the bar requests `seek-request` as the thumb moves, and again when it is let go. While it is held, the thumb stays
 * where it was dragged instead of being pulled back by the play clock.
 */
export class BeMusicPlaybackControlsElement extends DataElement<BeMusicPlaybackData> {
  static override styles: CSSResultGroup = [
    previewTheme,
    previewHost,
    css`
      :host {
        display: block;
        font-size: 13px;
        font-variant-numeric: tabular-nums;
      }
      .bar {
        display: grid;
        gap: 0;
        padding: 0 0 6px;
        background: linear-gradient(transparent, #05070be6 32%);
      }
      .row {
        display: flex;
        align-items: center;
        gap: 2px;
        padding: 0 6px;
      }
      .sound {
        display: flex;
        align-items: center;
        min-width: 0;
      }
      button {
        display: grid;
        place-items: center;
        width: 32px;
        height: 32px;
        padding: 0;
      }
      svg {
        width: 22px;
        height: 22px;
        fill: currentColor;
      }
      input[type='range'] {
        padding: 0;
        border: 0;
        background: transparent;
        accent-color: transparent;
      }
      .seek {
        width: 100%;
        height: 16px;
        margin: 0;
        appearance: none;
        cursor: pointer;
        --seek: 0%;
      }
      .seek::-webkit-slider-runnable-track {
        height: 3px;
        border-radius: 999px;
        background: linear-gradient(to right, var(--primary, #abcaff) var(--seek), #ffffff3d var(--seek));
      }
      .bar:hover .seek::-webkit-slider-runnable-track,
      .seek:focus-visible::-webkit-slider-runnable-track {
        height: 5px;
      }
      .seek::-webkit-slider-thumb {
        appearance: none;
        width: 13px;
        height: 13px;
        margin-top: -5px;
        border: 0;
        border-radius: 50%;
        background: var(--primary, #abcaff);
        opacity: 0;
      }
      .bar:hover .seek::-webkit-slider-thumb,
      .seek:active::-webkit-slider-thumb,
      .seek:focus-visible::-webkit-slider-thumb {
        opacity: 1;
      }
      .bar:hover .seek::-webkit-slider-thumb {
        margin-top: -4px;
      }
      .seek::-moz-range-track {
        height: 3px;
        border: 0;
        border-radius: 999px;
        background: #ffffff3d;
      }
      .seek::-moz-range-progress {
        height: 3px;
        border-radius: 999px;
        background: var(--primary, #abcaff);
      }
      .seek::-moz-range-thumb {
        width: 13px;
        height: 13px;
        border: 0;
        border-radius: 50%;
        background: var(--primary, #abcaff);
        opacity: 0;
      }
      .bar:hover .seek::-moz-range-thumb,
      .seek:active::-moz-range-thumb,
      .seek:focus-visible::-moz-range-thumb {
        opacity: 1;
      }
      .volume {
        width: 0;
        height: 14px;
        margin: 0;
        opacity: 0;
        pointer-events: none;
        appearance: none;
        cursor: pointer;
        transition:
          width 0.15s ease,
          opacity 0.15s ease;
      }
      .sound:hover .volume,
      .sound:focus-within .volume {
        width: 72px;
        opacity: 1;
        pointer-events: auto;
      }
      .volume::-webkit-slider-runnable-track {
        height: 3px;
        border-radius: 999px;
        background: #ffffff3d;
      }
      .volume::-webkit-slider-thumb {
        appearance: none;
        width: 12px;
        height: 12px;
        margin-top: -4.5px;
        border: 0;
        border-radius: 50%;
        background: #edf2fa;
      }
      .volume::-moz-range-track {
        height: 3px;
        border: 0;
        border-radius: 999px;
        background: #ffffff3d;
      }
      .volume::-moz-range-thumb {
        width: 12px;
        height: 12px;
        border: 0;
        border-radius: 50%;
        background: #edf2fa;
      }
      .time {
        margin-left: 6px;
        white-space: nowrap;
      }
      .spacer {
        flex: 1;
      }
      @container be-music (max-width: 22rem) {
        .volume {
          display: none;
        }
      }
    `,
  ];
  /** Set from the moment the thumb is pressed until it is let go, so a frame cannot overwrite it mid-drag. */
  private scrubbing = false;
  private scrubSeconds: number | undefined;

  protected override updated(): void {
    const input = this.renderRoot.querySelector<HTMLInputElement>('input.seek');
    if (!input) return;
    if (!this.scrubbing) {
      const next = String(this.shownSeconds());
      if (input.value !== next) input.value = next;
    }
    const duration = Math.max(0, this.data?.durationSeconds ?? 0);
    const value = Number(input.value);
    const progress = duration > 0 && Number.isFinite(value) ? Math.min(100, Math.max(0, (value / duration) * 100)) : 0;
    input.style.setProperty('--seek', `${progress}%`);
  }

  /** The second the bar and the time show: the held thumb, or the play clock. */
  private shownSeconds(): number {
    return resolvePlaybackSeconds(this.data?.currentSeconds ?? 0, this.data?.durationSeconds ?? 0, this.scrubSeconds);
  }

  private readSeconds(event: Event): number {
    return Number((event.currentTarget as HTMLInputElement).value);
  }

  /** The thumb moved. Seek there now and keep the bar on that second until the drag ends. */
  private previewSeek(event: Event): void {
    const seconds = this.readSeconds(event);
    this.scrubbing = true;
    this.scrubSeconds = seconds;
    this.emit('seek-request', { seconds });
    this.requestUpdate();
  }

  /**
   * The drag ended. A `change` always seeks, including a host that only dispatches that event. A pointer release seeks
   * only after the thumb actually moved, then the bar follows the play clock again.
   */
  private finishSeek(event: Event): void {
    const seconds = this.readSeconds(event);
    const moved = this.scrubSeconds !== undefined;
    this.scrubbing = false;
    this.scrubSeconds = undefined;
    if (event.type === 'change' || moved) this.emit('seek-request', { seconds });
    this.requestUpdate();
  }

  protected override render(): TemplateResult {
    const data = this.data;
    const duration = Math.max(0, data?.durationSeconds ?? 0);
    const current = this.shownSeconds();
    const playing = data?.playing === true;
    const muted = data?.muted === true;
    const volume = data?.volume ?? 1;
    const fullscreen = data?.fullscreen === true;
    return html`<div class="bar" part="bar">
      <input
        class="seek"
        part="seek"
        type="range"
        aria-label="Seek"
        aria-valuetext=${`${formatPlaybackTime(current)} of ${formatPlaybackTime(duration)}`}
        min="0"
        max=${duration}
        step="0.1"
        ?disabled=${data?.seekable !== true || duration <= 0}
        @pointerdown=${() => {
          this.scrubbing = true;
        }}
        @input=${(event: Event) => this.previewSeek(event)}
        @change=${(event: Event) => this.finishSeek(event)}
        @pointerup=${(event: Event) => this.finishSeek(event)}
        @pointercancel=${(event: Event) => this.finishSeek(event)}
      />
      <div class="row">
        <button
          class="btn"
          data-variant="ghost"
          data-size="icon-sm"
          part="play"
          aria-label=${playing ? 'Pause' : 'Play'}
          @click=${() => this.emit('pause-request', undefined)}
        >
          ${icon(playing ? 'pause' : 'play')}
        </button>
        <div class="sound">
          <button
            class="btn"
            data-variant="ghost"
            data-size="icon-sm"
            part="mute"
            aria-label=${muted ? 'Unmute' : 'Mute'}
            @click=${() => this.emit('volume-change', { volume, muted: !muted })}
          >
            ${icon(muted || volume === 0 ? 'muted' : 'volume')}
          </button>
          <input
            class="volume"
            part="volume"
            type="range"
            aria-label="Volume"
            min="0"
            max="1"
            step="0.01"
            .value=${String(muted ? 0 : volume)}
            @input=${(event: Event) => {
              const value = Number((event.currentTarget as HTMLInputElement).value);
              this.emit('volume-change', { volume: value, muted: value === 0 });
            }}
          />
        </div>
        <span class="time" part="time">${formatPlaybackTime(current)} / ${formatPlaybackTime(duration)}</span>
        <span class="spacer"></span>
        <button
          class="btn"
          data-variant="ghost"
          data-size="icon-sm"
          part="fullscreen"
          aria-label=${fullscreen ? 'Exit full screen' : 'Full screen'}
          @click=${() => this.emit('fullscreen-request', undefined)}
        >
          ${icon(fullscreen ? 'exit' : 'enter')}
        </button>
      </div>
    </div>`;
  }
}
