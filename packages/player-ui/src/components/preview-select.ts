import { css, html, type CSSResultGroup, type PropertyDeclarations, type TemplateResult } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import type { LibraryChart, LibraryCourse } from '@be-music/player-skin-sdk';
import { BeMusicElement } from '../base.ts';
import { structureStyles } from '../styles/structure.ts';
import { renderAutoPlayCheck } from './auto-play-check.ts';

type PreviewRow = Pick<LibraryChart, 'id' | 'title' | 'subtitle' | 'artist' | 'genre' | 'playLevel'> & {
  disabled: boolean;
};

/**
 * The charts or courses of a previewed track; picking one requests it (`activate-request`, by index). With `autoPlay`
 * set, the header has an AUTO checkbox, whose change requests `auto-play-change`.
 */
export class BeMusicPreviewSelectElement extends BeMusicElement {
  static override properties: PropertyDeclarations = {
    charts: { attribute: false },
    courses: { attribute: false },
    heading: {},
    /** Object URLs of each chart's `#STAGEFILE`, or its `#BANNER` when it has no stage file. Keyed by chart id. */
    images: { attribute: false },
    /** AUTO plays the pick by itself; off, the viewer plays it. No checkbox while unset. */
    autoPlay: { attribute: false },
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
      header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        min-width: 0;
        /* Ends where the rows do, short of the list's scrollbar gutter. */
        padding-right: 12px;
      }
      h2 {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .auto-play {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 0.9em;
        white-space: nowrap;
        cursor: pointer;
      }
      ul {
        display: grid;
        align-content: start;
        gap: 6px;
        margin: 0;
        /* Room for an overlay scrollbar, which takes no gutter of its own, so it does not cover the level. */
        padding: 0 12px 0 0;
        overflow: auto;
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
  declare autoPlay: boolean | undefined;

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
      <header part="header">
        <h2 part="heading">${this.heading ?? (courses !== undefined ? 'Choose a course' : 'Choose a chart')}</h2>
        ${renderAutoPlayCheck(this.autoPlay, (autoPlay) => this.emit('auto-play-change', { autoPlay }))}
      </header>
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
