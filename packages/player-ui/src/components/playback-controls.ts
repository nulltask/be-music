import { css, html, svg, type CSSResultGroup, type TemplateResult } from 'lit';
import { DataElement } from '../base.ts';
import type { BeMusicPlaybackData } from '../models.ts';
import { formatPlaybackTime } from '../playback.ts';
import { baseStyles } from '../styles/base.ts';

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
 * Video-player controls for a preview: play / pause, a seek bar, the time, mute and volume, and full screen. Seeking is
 * requested once the bar is let go (`seek-request`); while it is dragged the time follows the thumb.
 */
export class BeMusicPlaybackControlsElement extends DataElement<BeMusicPlaybackData> {
  static override styles: CSSResultGroup = [
    baseStyles,
    css`
      :host {
        display: block;
        font-size: 13px;
        font-variant-numeric: tabular-nums;
      }
      .bar {
        display: grid;
        gap: 2px;
        padding: 0 8px 4px;
        background: linear-gradient(transparent, #05070bcc 40%);
      }
      .row {
        display: flex;
        align-items: center;
        gap: 4px;
      }
      button {
        display: grid;
        place-items: center;
        width: 32px;
        height: 32px;
        padding: 0;
        border: 0;
        border-radius: 50%;
        background: transparent;
      }
      button:hover {
        background: #ffffff1f;
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
        accent-color: var(--be-music-color-accent, #abcaff);
      }
      .seek {
        width: 100%;
        height: 14px;
        margin: 0;
      }
      .volume {
        width: 72px;
      }
      .time {
        margin-left: 6px;
        white-space: nowrap;
      }
      .spacer {
        flex: 1;
      }
    `,
  ];
  private scrubSeconds: number | undefined;

  protected override render(): TemplateResult {
    const data = this.data;
    const duration = Math.max(0, data?.durationSeconds ?? 0);
    const current = this.scrubSeconds ?? Math.min(duration, Math.max(0, data?.currentSeconds ?? 0));
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
        .value=${String(current)}
        ?disabled=${data?.seekable !== true || duration <= 0}
        @input=${(event: Event) => {
          this.scrubSeconds = Number((event.currentTarget as HTMLInputElement).value);
          this.requestUpdate();
        }}
        @change=${(event: Event) => {
          const seconds = Number((event.currentTarget as HTMLInputElement).value);
          this.scrubSeconds = undefined;
          this.emit('seek-request', { seconds });
        }}
      />
      <div class="row">
        <button
          part="play"
          aria-label=${playing ? 'Pause' : 'Play'}
          @click=${() => this.emit('pause-request', undefined)}
        >
          ${icon(playing ? 'pause' : 'play')}
        </button>
        <button
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
        <span class="time" part="time">${formatPlaybackTime(current)} / ${formatPlaybackTime(duration)}</span>
        <span class="spacer"></span>
        <button
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
