import { css, html, type CSSResultGroup, type PropertyDeclarations, type TemplateResult } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import type { LibraryChart, LibraryCourse } from '@be-music/player-skin-sdk';
import { BeMusicElement } from '../base.ts';
import { structureStyles } from '../styles/structure.ts';

type PreviewRow = Pick<LibraryChart, 'id' | 'title' | 'subtitle' | 'artist' | 'genre' | 'playLevel'> & {
  disabled: boolean;
};

/** The charts or courses of a previewed track; picking one requests it (`activate-request`, by index). */
export class BeMusicPreviewSelectElement extends BeMusicElement {
  static override properties: PropertyDeclarations = {
    charts: { attribute: false },
    courses: { attribute: false },
    heading: {},
    /** Object URLs of each chart's `#STAGEFILE`, or its `#BANNER` when it has no stage file. Keyed by chart id. */
    images: { attribute: false },
  };
  static override styles: CSSResultGroup = [
    structureStyles,
    css`
      :host {
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
        gap: 10px;
        box-sizing: border-box;
        height: 100%;
        padding: 16px;
      }
      ul {
        display: grid;
        align-content: start;
        gap: 6px;
        margin: 0;
        padding: 0;
        overflow: auto;
        list-style: none;
        overscroll-behavior: contain;
      }
      button {
        display: grid;
        grid-template-columns: 128px minmax(0, 1fr) auto;
        align-items: center;
        gap: 12px;
        width: 100%;
        padding: 6px;
        text-align: left;
      }
      .thumb {
        display: block;
        width: 100%;
        aspect-ratio: 16 / 9;
        object-fit: contain;
      }
      .title,
      .artist {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .artist,
      .facts {
        font-size: 0.85em;
      }
      @container be-music (max-width: 22rem) {
        button {
          grid-template-columns: auto minmax(0, 1fr);
        }
        .play {
          grid-row: span 2;
        }
        .facts {
          grid-column: 2;
        }
      }
    `,
  ];
  /** When set, list fixed courses instead of charts. Missing stages disable the row. */
  declare courses: readonly LibraryCourse[] | undefined;
  declare charts: readonly LibraryChart[] | undefined;
  declare heading: string | undefined;
  declare images: ReadonlyMap<string, string> | undefined;

  protected override render(): TemplateResult {
    const courses = this.courses;
    const rows: PreviewRow[] =
      courses !== undefined
        ? courses.map((course) => ({
            id: course.id,
            title: course.definition.name,
            artist: course.stages.map((stage) => stage.title).join(' → '),
            genre: `${course.definition.kind.toUpperCase()} · ${course.stages.length} stages${course.playable ? '' : ' · Missing charts'}`,
            disabled: !course.playable,
            subtitle: undefined,
            playLevel: undefined,
          }))
        : (this.charts ?? []).map((chart) => ({ ...chart, disabled: false }));
    return html`<h2 part="heading">
        ${this.heading ?? (courses !== undefined ? 'Choose a course' : 'Choose a chart')}
      </h2>
      <ul part="list" aria-label=${courses !== undefined ? 'Courses' : 'Charts'}>
        ${repeat(
          rows,
          (chart) => chart.id,
          (chart, index) => {
            const artwork = this.images?.get(chart.id);
            return html`<li>
              <button
                class="btn"
                data-variant="outline"
                data-size="lg"
                part="row"
                ?disabled=${chart.disabled}
                @click=${() => this.emit('activate-request', { index })}
              >
                ${
                  artwork
                    ? html`<img class="thumb" part="artwork" alt="" src=${artwork} />`
                    : html`<span class="thumb" part="artwork"></span>`
                }
                <span
                  ><span class="title">${[chart.title, chart.subtitle].filter(Boolean).join(' ')}</span
                  ><span class="artist">${chart.artist ?? ''}</span></span
                >
                <span class="facts"
                  >${[chart.genre, chart.playLevel !== undefined ? `Lv. ${chart.playLevel}` : undefined]
                    .filter(Boolean)
                    .join(' · ')}</span
                >
              </button>
            </li>`;
          },
        )}
      </ul>`;
  }
}
