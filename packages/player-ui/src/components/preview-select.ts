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
        height: 100%;
      }
      /* Padded inside the shadow root: a page reset such as "* { padding: 0 }" outranks :host rules. */
      .layout {
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
        gap: 10px;
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
        scrollbar-gutter: stable;
        list-style: none;
        overscroll-behavior: contain;
      }
      button {
        display: grid;
        grid-template-columns: 96px minmax(0, 1fr) auto;
        align-items: center;
        gap: 12px;
        width: 100%;
        height: auto;
        padding: 6px;
        text-align: left;
        white-space: normal;
      }
      /* A picture keeps its own shape (a 4:3 #STAGEFILE, a wide #BANNER); the blank stands in for a stage file. */
      .thumb {
        display: block;
        width: 100%;
        max-height: 96px;
        object-fit: contain;
      }
      span.thumb {
        aspect-ratio: 4 / 3;
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
      /* A long genre wraps instead of squeezing the title out. */
      .facts {
        max-width: 16em;
        text-align: right;
      }
      @container be-music (max-width: 32rem) {
        button {
          grid-template-columns: 64px minmax(0, 1fr);
          row-gap: 4px;
        }
        .thumb {
          grid-row: span 2;
        }
        .facts {
          grid-column: 2;
          max-width: none;
          text-align: left;
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
    return html`<div class="layout">
      <h2 part="heading">${this.heading ?? (courses !== undefined ? 'Choose a course' : 'Choose a chart')}</h2>
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
      </ul>
    </div>`;
  }
}
