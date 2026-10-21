import { html, nothing, type CSSResultGroup, type PropertyValues, type TemplateResult } from 'lit';
import type { BeMusicDOMGameplayFrame } from '@be-music/player-skin-sdk';
import { FrameElement } from '../base.ts';
import type { BeMusicScoreData, BeMusicGaugeData, BeMusicJudgmentData } from '../models.ts';
import { screenStyles } from '../styles/screen.ts';
import { gameplayStyles } from '../styles/gameplay.ts';
import { stats } from '../templates.ts';

/** Layout composition only; the individual panels can also be mounted independently. */
export class BeMusicGameplayHUDElement extends FrameElement<BeMusicDOMGameplayFrame> {
  static override styles: CSSResultGroup = [screenStyles, gameplayStyles];
  private orientation: string | undefined;
  private detailsOpen = true;
  protected override willUpdate(_changed: PropertyValues): void {
    if (this.frame && this.orientation !== this.frame.layout.orientation) {
      this.orientation = this.frame.layout.orientation;
      this.detailsOpen = this.orientation === 'landscape';
    }
  }
  protected override render(): TemplateResult | typeof nothing {
    const f = this.frame;
    if (!f) return nothing;
    const { state: s, runtime: r, chart } = f;
    const total = r.totalNotes ?? chart?.totalNotes ?? 0;
    const judged = (r.perfect ?? 0) + (r.great ?? 0) + (r.good ?? 0) + (r.bad ?? 0) + (r.poor ?? 0);
    const score: BeMusicScoreData = {
      exScore: s.exScore,
      maximum: r.exScoreMax ?? total * 2,
      combo: s.combo,
      maxCombo: s.maxCombo,
      rank: r.rank,
      score: r.score ?? 0,
      totalNotes: total,
      judgedNotes: judged,
      missCount: (r.bad ?? 0) + (r.poor ?? 0) + f.emptyPoor,
      courseCombo: s.courseCombo,
    };
    const gauge: BeMusicGaugeData = {
      value: s.gauge,
      label: s.gaugeType,
      cleared: s.cleared,
      threshold: r.clearThreshold,
      survival: r.gaugeSurvival,
      history: s.gaugeHistory,
    };
    const judgments: BeMusicJudgmentData = {
      perfect: r.perfect ?? 0,
      great: r.great ?? 0,
      good: r.good ?? 0,
      bad: r.bad ?? 0,
      poor: r.poor ?? 0,
      emptyPoor: f.emptyPoor,
      fast: r.fast ?? 0,
      slow: r.slow ?? 0,
      earlyLate: s.earlyLate,
      lastJudge: r.lastJudge,
      lastDeltaMs: s.lastJudgeDeltaMs,
    };
    const seconds = Math.max(0, Math.min(s.totalSeconds, f.seconds));
    const title = [chart?.title ?? 'Preparing chart', chart?.subtitle].filter(Boolean).join(' ');
    const facts = [
      chart?.genre,
      r.playVariant ? `${r.playVariant} KEY` : undefined,
      chart?.playLevel !== undefined ? `Lv. ${chart.playLevel}` : undefined,
    ]
      .filter(Boolean)
      .join(' · ');
    const course = f.course
      ? `${f.course.title} · Stage ${(f.course.stageIndex ?? 0) + 1}/${f.course.stages.length}`
      : 'Single chart';
    const style = `--stage-ratio:${f.layout.stage.width / f.layout.stage.height};--hud-left:${((f.layout.playfield.right + 20) / f.layout.stage.width) * 100}%;--be-music-compact-combo-display:none`;
    return html`<section
      class="gameplay"
      data-orientation=${f.layout.orientation}
      data-bga=${r.hasBGA ? 'on' : 'off'}
      style=${style}
    >
      <aside class="hud" part="hud" aria-label="Play status">
        <div class="hud-heading" part="heading">
          <div>
            <span class="eyebrow">${f.replay ? 'Replay' : f.autoPlay ? 'Auto play' : 'Live'}</span>
            <span class="muted"
              >${f.stage === 'loading' ? `Loading ${Math.round((f.progress ?? 0) * 100)}%` : f.stage}</span
            >
          </div>
          <h2 title=${title}>${title}</h2>
          <p class="muted">${chart?.artist ?? ''}</p>
          <p class="muted">${facts}</p>
          <p class="muted">${f.course ? course : ''}</p>
        </div>
        <div class="hud-primary" part="primary">
          <be-music-score-summary
            compact
            exportparts="summary:score-summary,value:score-value"
            .data=${score}
          ></be-music-score-summary>
          <dl class="hud-live">
            <dt>Combo</dt>
            <dd>${s.combo}</dd>
            <dt>BPM</dt>
            <dd>${f.bpm === undefined ? '—' : Math.round(f.bpm)}</dd>
            <dt>Time</dt>
            <dd>${Math.floor(seconds)} / ${Math.ceil(s.totalSeconds)} s</dd>
          </dl>
          <be-music-gauge-panel compact exportparts="meter:gauge-meter" .data=${gauge}></be-music-gauge-panel>
          <progress
            max="1"
            .value=${s.totalSeconds > 0 ? seconds / s.totalSeconds : 0}
            aria-label="Chart progress"
          ></progress>
        </div>
        <div class="actions" part="actions">
          <button @click=${() => this.emit('pause-request', undefined)}>
            ${f.stage === 'paused' ? 'Resume' : 'Pause'}</button
          ><button @click=${() => this.emit('retry-request', undefined)}>Retry</button
          ><button @click=${() => this.emit('quit-request', undefined)}>Back</button><slot name="actions"></slot>
        </div>
        <details
          class="hud-details"
          .open=${this.detailsOpen}
          @toggle=${(event: Event) => {
            this.detailsOpen = (event.currentTarget as HTMLDetailsElement).open;
          }}
        >
          <summary>All play information</summary>
          <div class="hud-extra" part="details">
            <be-music-score-summary exportparts="panel:score-panel" .data=${score}></be-music-score-summary>
            <be-music-judgment-table
              exportparts="panel:judgment-panel,table:judgment-table"
              .data=${judgments}
            ></be-music-judgment-table>
            <be-music-gauge-panel
              exportparts="panel:gauge-panel,graph:gauge-graph"
              .data=${gauge}
            ></be-music-gauge-panel>
            <be-music-timing-graph
              exportparts="panel:timing-panel,graph:timing-graph"
              .data=${{ timings: s.judgeTimings }}
            ></be-music-timing-graph>
            <be-music-play-settings
              exportparts="panel:settings-panel"
              .data=${{ view: s.view, options: f.playOptions, runtime: r }}
            ></be-music-play-settings>
            <section class="hud-card">
              <h3>Chart &amp; course</h3>
              <p class="muted">${chart?.artist ?? ''} · ${facts} · ${total} notes</p>
              <p class="muted">${chart?.chartPath ?? ''}</p>
              <p class="muted">${course}</p>
              ${stats([['Time left', `${Math.ceil(Math.max(0, s.totalSeconds - seconds))} s`]])}
            </section>
            <slot></slot>
          </div>
        </details>
      </aside>
    </section>`;
  }
}
