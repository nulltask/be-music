import { html, nothing, type TemplateResult } from 'lit';
import {
  formatScoreDiff,
  resolveCabinetLayout,
  resolveDifficultyName,
  resolveScorePace,
  resolveStageLabel,
  type BeMusicDOMGameplayFrame,
  type BeMusicRect,
  type ScorePace,
} from '@be-music/player-skin-sdk';
import type { BeMusicGameplayPanels } from '../gameplay-data.ts';

type BeMusicSecondPlayerPanels = Pick<BeMusicGameplayPanels, 'score' | 'gauge' | 'judgments'>;

/** DJ level lines on the score graph, as fractions of the maximum EX score. */
const RANK_LINES = [
  ['AAA', 8 / 9],
  ['AA', 7 / 9],
  ['A', 6 / 9],
] as const;

/** What the cabinet arrangement draws from, besides the frame. */
export interface GameplayCabinetInput {
  readonly frame: BeMusicDOMGameplayFrame;
  readonly panels: BeMusicGameplayPanels;
  readonly second: BeMusicSecondPlayerPanels | undefined;
  /** The Pause / Retry / Back buttons and the play-information toggle, placed in the stage band. */
  readonly actions: TemplateResult;
  /** The play information, shown over the BGA while open. */
  readonly details: TemplateResult | typeof nothing;
}

/**
 * The landscape gameplay HUD in the cabinet layout of `@be-music/player-skin-sdk` (`resolveCabinetLayout`): each panel
 * placed on its rect of the stage, in percentages, so it follows the letterboxed stage like the playfield does.
 */
export function renderGameplayCabinet({
  frame: f,
  panels,
  second,
  actions,
  details,
}: GameplayCabinetInput): TemplateResult {
  const { stage } = f.layout;
  const cabinet = resolveCabinetLayout(f.layout);
  const place = (rect: BeMusicRect): string =>
    `left:${(rect.x / stage.width) * 100}%;top:${(rect.y / stage.height) * 100}%;width:${(rect.w / stage.width) * 100}%;height:${(rect.h / stage.height) * 100}%`;
  const r = f.runtime;
  const pace = resolveScorePace(r);
  const { keys, gauge } = cabinet;
  const gaugeBox = {
    x: gauge.x,
    y: cabinet.gaugeLabelY - 8,
    w: gauge.w,
    h: gauge.y + gauge.h - cabinet.gaugeLabelY + 8,
  };
  const split = second ? gaugeBox.x + (gaugeBox.w + 12) / 2 : gaugeBox.x + gaugeBox.w;
  const hiSpeed = (r.hiSpeed ?? 0).toFixed(r.floatingHiSpeed ? 2 : 1);
  const difficulty = resolveDifficultyName(f.chart);
  const level = f.chart?.playLevel;
  const counts = [
    ['PG', panels.judgments.perfect],
    ['GR', panels.judgments.great],
    ['GD', panels.judgments.good],
    ['BD', panels.judgments.bad],
    ['PR', panels.judgments.poor],
    ['CB', panels.judgments.bad + panels.judgments.poor],
  ] as const;
  const tempo = r.tempo ?? 1;
  const mode = html`<span class="eyebrow"
    >${f.replay ? 'Replay' : f.autoPlay ? 'Auto play' : f.stage === 'loading' ? 'Loading' : 'Live'}</span
  >`;
  return html`<section
    class="gameplay cabinet"
    data-orientation="landscape"
    ?data-double-play=${cabinet.doublePlay}
    style=${`--stage-ratio:${stage.width / stage.height};--stage-height:${stage.height};--playfield-center:${(f.layout.playfield.centerX / stage.width) * 100}%`}
  >
    <div class="cab play-frame" part="play" style=${place(cabinet.play)}></div>
    ${
      cabinet.progress
        ? html`<div class="cab chart-progress" part="progress" style=${place(cabinet.progress)} aria-hidden="true">
            <div class="progress-fill" style=${`height:${Math.max(0, Math.min(1, r.progressRatio ?? 0)) * 100}%`}></div>
          </div>`
        : nothing
    }
    <div class="cab keys" part="keys" style=${place(keys)} aria-hidden="true">
      ${f.layout.lanes.map(
        (lane) =>
          html`<span
            class="key"
            data-kind=${lane.kind}
            style=${`left:${((lane.x - keys.x) / keys.w) * 100}%;width:${(lane.w / keys.w) * 100}%`}
          ></span>`,
      )}
    </div>
    ${
      !r.hasBGA && cabinet.bga.w > 0
        ? html`<div class="cab panel sound-only" style=${place(cabinet.bga)}>
            <span class="eyebrow">Sound only</span>
          </div>`
        : nothing
    }
    <be-music-gauge-panel
      class="cab"
      compact
      exportparts="meter:gauge-meter"
      style=${place(second ? { ...gaugeBox, w: split - 6 - gaugeBox.x } : gaugeBox)}
      .data=${panels.gauge}
    ></be-music-gauge-panel>
    ${
      second
        ? html`<be-music-gauge-panel
            class="cab"
            compact
            exportparts="meter:gauge-meter"
            style=${place({ ...gaugeBox, x: split, w: gaugeBox.x + gaugeBox.w - split })}
            .data=${second.gauge}
          ></be-music-gauge-panel>`
        : nothing
    }
    ${
      cabinet.center
        ? html`<div class="cab panel center" part="center" style=${place(cabinet.center)} aria-label="Gauge">
            <strong>${Math.floor(Math.max(0, Math.min(100, panels.gauge.value)))}</strong>
          </div>`
        : nothing
    }
    <div class="cab panel figure" part="score" style=${place(cabinet.score)}>
      <span class="eyebrow">Score</span><strong>${r.score ?? 0}</strong>
    </div>
    <div class="cab panel figure" part="hi-speed" style=${place(cabinet.hiSpeed)}>
      <span class="eyebrow">${r.floatingHiSpeed ? 'FHS' : 'Hi-speed'}</span><strong>${hiSpeed}</strong>
    </div>
    ${cabinet.graph ? renderGraph(cabinet.graph, pace, r.random1P, place) : nothing}
    <div class="cab panel stage-band" part="stage" style=${place(cabinet.stage)}>
      ${mode}
      <strong>${resolveStageLabel(f.course)}</strong>
      ${cabinet.controls ? nothing : actions}
    </div>
    ${
      cabinet.controls
        ? html`<div class="cab panel stage-band controls" part="controls" style=${place(cabinet.controls)}>
            ${actions}
          </div>`
        : nothing
    }
    <div class="cab panel players" part="players" style=${place(cabinet.players)}>
      <div class="plate">
        <span class="eyebrow">${r.playerName ?? 'Player 1P'}</span>
        ${difficulty ? html`<span class="difficulty" part="difficulty">${difficulty}</span>` : nothing}
        <strong>Lv.${level ?? '-'}</strong>
      </div>
      <div class="chart-title">
        <h2 title=${panels.title}>${panels.title}</h2>
        <p class="muted">${f.chart?.artist ?? ''}</p>
      </div>
      ${
        second
          ? html`<div class="plate" part="second-player" aria-label="2P">
              <span class="eyebrow">Player 2P</span><strong>EX ${second.score.exScore}</strong>
            </div>`
          : nothing
      }
    </div>
    <div class="cab panel judge" part="judge" style=${place(cabinet.judge)}>
      <dl class="counts">
        ${counts.map(
          ([label, value]) =>
            html`<dt>${label}</dt>
              <dd>${value}</dd>`,
        )}
      </dl>
      <dl class="fast-slow">
        <dt class="fast">FAST</dt>
        <dd>${panels.judgments.fast}</dd>
        <dt class="slow">SLOW</dt>
        <dd>${panels.judgments.slow}</dd>
      </dl>
      ${renderTiming(r.lastJudgeDeltaMs, r.judgeWindows?.note.great.lateMs ?? 40)}
    </div>
    <div class="cab panel bpm" part="bpm" style=${place(cabinet.bpm)}>
      <strong>${Math.round(f.bpm ?? r.bpm ?? 0)}</strong>
      <div class="bpm-range">
        <span><span class="eyebrow">MIN</span>${Math.round(r.minBPM ?? f.bpm ?? 0)}</span>
        <span class="eyebrow">BPM</span>
        <span><span class="eyebrow">MAX</span>${Math.round(r.maxBPM ?? f.bpm ?? 0)}</span>
      </div>
    </div>
    <div class="cab panel tempo" part="tempo" style=${place(cabinet.tempo)}>
      <span class="eyebrow">Tempo</span><strong>${tempo === 1 ? 'OFF' : `x${tempo.toFixed(2)}`}</strong>
    </div>
    ${
      details === nothing
        ? nothing
        : html`<div
            class="cab cabinet-details"
            style=${place({ x: cabinet.players.x, y: cabinet.bga.y, w: cabinet.players.w, h: cabinet.bga.h })}
          >
            ${details}
          </div>`
    }
    ${f.stage === 'paused' ? html`<p class="paused" part="paused" role="status">Paused</p>` : nothing}
  </section>`;
}

/** YOU and the pacemaker over three bars (the player, the best record, the pacemaker), with the gaps under them. */
function renderGraph(
  graph: NonNullable<ReturnType<typeof resolveCabinetLayout>['graph']>,
  pace: ScorePace,
  random: string | undefined,
  place: (rect: BeMusicRect) => string,
): TemplateResult {
  const height = (score: number) => `${pace.max > 0 ? Math.min(1, score / pace.max) * 100 : 0}%`;
  const bar = (kind: string, full: number | undefined, now: number) =>
    html`<div class="bar" data-kind=${kind}>
      ${full === undefined ? nothing : html`<span class="bar-full" style=${`height:${height(full)}`}></span>`}
      <span class="bar-now" style=${`height:${height(now)}`}></span>
    </div>`;
  const diff = (value: number | undefined) => (value === undefined ? '----' : formatScoreDiff(value));
  return html`<div class="cab panel graph-header" part="graph-header" style=${place(graph.header)}>
      <dl>
        <dt>YOU</dt>
        <dd>${pace.exScore}</dd>
        <dt>PACEMAKER</dt>
        <dd>${pace.target.exScore}</dd>
      </dl>
    </div>
    <div class="cab panel graph" part="graph" style=${place(graph.bars)} role="img" aria-label="Score graph">
      <span class="eyebrow">Max score</span>
      <div class="plot">
        ${RANK_LINES.map(
          ([label, share]) => html`<span class="rank-line" style=${`bottom:${share * 100}%`}>${label}</span>`,
        )}
        <div class="bars">
          ${bar('you', undefined, pace.exScore)}
          ${pace.best ? bar('best', pace.best.exScore, pace.best.pace) : html`<div class="bar"></div>`}
          ${bar('target', pace.target.exScore, pace.target.pace)}
        </div>
      </div>
      <dl class="diffs">
        <dt>TARGET</dt>
        <dd>${diff(pace.target.diff)}</dd>
        <dt>MY BEST</dt>
        <dd>${diff(pace.best?.diff)}</dd>
      </dl>
    </div>
    <div class="cab panel graph-footer" part="graph-footer" style=${place(graph.footer)}>
      <div class="option-row"><span class="eyebrow">Option</span><strong>${random ?? 'OFF'}</strong></div>
      <span class="pacemaker">PACEMAKER ${pace.target.label}</span>
    </div>`;
}

/** Where the last timed press landed between EARLY (bottom) and LATE (top), on the GREAT window's scale. */
function renderTiming(delta: number | undefined, scaleMs: number): TemplateResult {
  const t = delta === undefined ? undefined : Math.max(-1, Math.min(1, delta / Math.max(1, scaleMs)));
  return html`<div class="timing" aria-label="Last timing">
    <span class="eyebrow">LATE</span>
    <div class="timing-track">
      ${
        t === undefined
          ? nothing
          : html`<span
              class="timing-mark"
              data-side=${delta! > 0 ? 'late' : delta! < 0 ? 'early' : 'just'}
              style=${`bottom:${50 + t * 50}%`}
            ></span>`
      }
    </div>
    <span class="eyebrow">EARLY</span>
  </div>`;
}
