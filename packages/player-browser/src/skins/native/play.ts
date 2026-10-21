import type { BeMusicDOMGameplayFrame, BeMusicDOMGameplayActions, BeMusicDOMScreen } from '@be-music/player-skin-sdk';
import { createScreen, query, setText } from './screen.ts';

export function mountGameplay(
  container: HTMLElement,
  actions: BeMusicDOMGameplayActions,
): BeMusicDOMScreen<BeMusicDOMGameplayFrame> {
  const root = createScreen(
    container,
    'gameplay',
    `
    <aside class="hud" aria-label="Play status">
      <div class="hud-heading">
        <div><span class="eyebrow" data-mode>Live</span> <span class="muted" data-stage></span></div>
        <h2 data-title></h2><p class="muted" data-artist></p><p class="muted" data-chart></p><p class="muted" data-course></p>
      </div>
      <div class="hud-primary">
        <div class="hud-score"><span class="muted">EX SCORE</span><strong class="stat" data-score>0</strong><span data-rank></span><span class="muted" data-rate></span></div>
        <dl class="hud-live"><dt>Combo</dt><dd data-combo>0</dd><dt>BPM</dt><dd data-bpm>—</dd><dt>Time</dt><dd data-time></dd></dl>
        <label class="hud-gauge"><span data-gauge>Gauge</span><meter min="0" max="100" value="0" aria-label="Gauge"></meter></label>
        <progress data-progress max="1" value="0" aria-label="Chart progress"></progress>
      </div>
      <div class="actions"><button data-pause>Pause</button><button data-retry>Retry</button><button data-quit>Back</button></div>
      <details class="hud-details"><summary>All play information</summary><div class="hud-extra">
        <section class="hud-card"><h3>Score &amp; progress</h3><dl>
          <dt>Score</dt><dd data-standard-score></dd><dt>EX max</dt><dd data-ex-max></dd>
          <dt>Notes judged</dt><dd data-notes></dd><dt>Remaining</dt><dd data-remaining></dd>
          <dt>Max combo</dt><dd data-max-combo></dd><dt>Course combo / max</dt><dd data-course-combo></dd><dt>BP</dt><dd data-bp></dd>
          <dt>Accuracy so far</dt><dd data-accuracy></dd><dt>Time left</dt><dd data-time-left></dd>
        </dl></section>
        <section class="hud-card"><h3>Judgments</h3><table class="hud-judgments"><thead><tr><th scope="col">Judge</th><th scope="col">Count</th><th scope="col">FAST</th><th scope="col">SLOW</th></tr></thead><tbody>
          ${['PERFECT', 'GREAT', 'GOOD', 'BAD', 'POOR'].map((judge) => `<tr><th scope="row">${judge}</th><td data-count="${judge}">0</td><td data-early="${judge}">0</td><td data-late="${judge}">0</td></tr>`).join('')}
        </tbody></table><dl><dt>Empty POOR</dt><dd data-empty-poor></dd><dt>FAST / SLOW</dt><dd data-fast-slow></dd><dt>Last judgment</dt><dd data-last-judge></dd><dt>Last offset</dt><dd data-offset></dd></dl></section>
        <section class="hud-card"><h3>Gauge &amp; timing</h3><dl><dt>Clear threshold</dt><dd data-threshold></dd><dt>Status</dt><dd data-clear></dd></dl>
          <svg class="hud-graph" viewBox="0 0 220 44" role="img" aria-label="Gauge history"><line data-threshold-line x1="0" x2="220" stroke="#9baac0" stroke-dasharray="3 3"></line><polyline data-gauge-line fill="none" stroke="#abcaff" stroke-width="2"></polyline></svg>
          <svg class="hud-graph" viewBox="0 0 220 44" role="img" aria-label="Recent timing offsets, early above and late below the center line"><path d="M0 22H220" stroke="#9baac0" stroke-dasharray="3 3"></path><polyline data-timing-line fill="none" stroke="#ffa8b3" stroke-width="1.5"></polyline></svg>
          <p class="muted">Timing: ±100 ms · latest 32 hits</p>
        </section>
        <section class="hud-card"><h3>Speed &amp; lanes</h3><dl>
          <dt>Hi-speed</dt><dd data-hi-speed></dd><dt>Drawn speed</dt><dd data-drawn-speed></dd><dt>HS-FIX</dt><dd data-hs-fix></dd>
          <dt>Green number</dt><dd data-green></dd><dt>Visible time</dt><dd data-visible></dd><dt>BPM range</dt><dd data-bpm-range></dd><dt>Main BPM</dt><dd data-main-bpm></dd>
        </dl><div data-covers class="muted"></div></section>
        <section class="hud-card"><h3>Chart &amp; course</h3><p class="muted" data-chart-info></p><p class="muted" data-course-info></p></section>
        <section class="hud-card"><h3>Play settings</h3><dl>
          <dt>Ruleset</dt><dd data-ruleset></dd><dt>Random 1P / 2P</dt><dd data-random></dd><dt>Gauge 1P / 2P</dt><dd data-gauges></dd>
          <dt>Auto scratch</dt><dd data-scratch></dd><dt>DP flip</dt><dd data-flip></dd><dt>BGA</dt><dd data-bga></dd>
        </dl></section>
      </div></details>
    </aside>`,
  );
  // Cache DOM references once; metadata stays in text nodes and live values never replace focused controls.
  const fields = new Map<string, HTMLElement>();
  for (const element of root.querySelectorAll<HTMLElement>('*')) {
    for (const key of Object.keys(element.dataset)) fields.set(key, element);
  }
  const text = (key: string, value: string | number) => {
    const element = fields.get(key);
    if (element) setText(element, String(value));
  };
  const counts = ['PERFECT', 'GREAT', 'GOOD', 'BAD', 'POOR'] as const;
  const judgmentCells = counts.map((judge) => ({
    judge,
    count: query(root, `[data-count="${judge}"]`),
    early: query(root, `[data-early="${judge}"]`),
    late: query(root, `[data-late="${judge}"]`),
  }));
  const meter = query<HTMLMeterElement>(root, 'meter');
  const progress = query<HTMLProgressElement>(root, '[data-progress]');
  const details = query<HTMLDetailsElement>(root, '.hud-details');
  const gaugeLine = query<SVGPolylineElement>(root, '[data-gauge-line]');
  const timingLine = query<SVGPolylineElement>(root, '[data-timing-line]');
  const thresholdLine = query<SVGLineElement>(root, '[data-threshold-line]');
  const pause = query(root, '[data-pause]');
  pause.addEventListener('click', () => actions.pause());
  query(root, '[data-retry]').addEventListener('click', () => actions.restart());
  query(root, '[data-quit]').addEventListener('click', () => actions.quit());
  let orientation: string | undefined;
  let lastUpdateMs = -Infinity;
  let previousState: string | undefined;
  let previousView: BeMusicDOMGameplayFrame['state']['view'] | undefined;
  let previousGaugeHistory: BeMusicDOMGameplayFrame['state']['gaugeHistory'] | undefined;
  let previousTimings: BeMusicDOMGameplayFrame['state']['judgeTimings'] | undefined;
  return {
    update(frame) {
      const runtime = frame.runtime;
      root.dataset.bga = runtime.hasBGA ? 'on' : 'off';
      const nowMs = runtime.nowMs ?? frame.seconds * 1000;
      const rotated = orientation !== frame.layout.orientation;
      if (
        !rotated &&
        previousState === frame.stage &&
        previousView === frame.state.view &&
        nowMs >= lastUpdateMs &&
        nowMs - lastUpdateMs < 80
      )
        return;
      lastUpdateMs = nowMs;
      previousState = frame.stage;
      previousView = frame.state.view;
      if (rotated) {
        orientation = frame.layout.orientation;
        root.dataset.orientation = orientation;
        details.open = orientation === 'landscape';
      }
      root.style.setProperty('--stage-ratio', String(frame.layout.stage.width / frame.layout.stage.height));
      root.style.setProperty(
        '--hud-left',
        `${((frame.layout.playfield.right + 20) / frame.layout.stage.width) * 100}%`,
      );
      const state = frame.state;
      const options = frame.playOptions;
      const total = runtime.totalNotes ?? frame.chart?.totalNotes ?? 0;
      const values = [runtime.perfect ?? 0, runtime.great ?? 0, runtime.good ?? 0, runtime.bad ?? 0, runtime.poor ?? 0];
      const judged = values.reduce((sum, count) => sum + count, 0);
      const gauge = Math.min(100, Math.max(0, state.gauge));
      const seconds = Math.max(0, Math.min(state.totalSeconds, frame.seconds));
      text('title', [frame.chart?.title ?? 'Preparing chart', frame.chart?.subtitle].filter(Boolean).join(' '));
      text('artist', frame.chart?.artist ?? '');
      text(
        'chart',
        [
          frame.chart?.genre,
          runtime.playVariant ? `${runtime.playVariant} KEY` : undefined,
          frame.chart?.playLevel !== undefined ? `Lv. ${frame.chart.playLevel}` : undefined,
        ]
          .filter(Boolean)
          .join(' · '),
      );
      text(
        'course',
        frame.course
          ? `${frame.course.title} · Stage ${(frame.course.stageIndex ?? 0) + 1}/${frame.course.stages.length}`
          : '',
      );
      text('mode', frame.replay ? 'Replay' : frame.autoPlay ? 'Auto play' : 'Live');
      text('stage', frame.stage === 'loading' ? `Loading ${Math.round((frame.progress ?? 0) * 100)}%` : frame.stage);
      text('score', state.exScore);
      text('rank', runtime.rank ?? '—');
      text('rate', total > 0 ? `${((state.exScore / (total * 2)) * 100).toFixed(2)}%` : '—');
      text('combo', state.combo);
      text('bpm', frame.bpm === undefined ? '—' : Math.round(frame.bpm));
      text('time', `${Math.floor(seconds)} / ${Math.ceil(state.totalSeconds)} s`);
      if (meter.value !== gauge) meter.value = gauge;
      text('gauge', `${state.gaugeType ?? 'Gauge'} · ${gauge.toFixed(1)}%`);
      const ratio = state.totalSeconds > 0 ? seconds / state.totalSeconds : 0;
      if (progress.value !== ratio) progress.value = ratio;
      text('standardScore', runtime.score ?? 0);
      text('exMax', runtime.exScoreMax ?? total * 2);
      text('notes', `${judged} / ${total}`);
      text('remaining', Math.max(0, total - judged));
      text('maxCombo', state.maxCombo);
      text('courseCombo', state.courseCombo ? `${state.courseCombo.combo} / ${state.courseCombo.maxCombo}` : '—');
      text('bp', (runtime.bad ?? 0) + (runtime.poor ?? 0) + frame.emptyPoor);
      text('accuracy', judged > 0 ? `${((state.exScore / (judged * 2)) * 100).toFixed(2)}%` : '—');
      text('timeLeft', `${Math.ceil(Math.max(0, state.totalSeconds - seconds))} s`);
      for (let index = 0; index < judgmentCells.length; index++) {
        const cells = judgmentCells[index]!;
        setText(cells.count, String(values[index]));
        setText(cells.early, String(state.earlyLate[cells.judge].early));
        setText(cells.late, String(state.earlyLate[cells.judge].late));
      }
      text('emptyPoor', frame.emptyPoor);
      text('lastJudge', runtime.lastJudge ?? '—');
      text('fastSlow', `${runtime.fast ?? 0} / ${runtime.slow ?? 0}`);
      const delta = state.lastJudgeDeltaMs;
      text('offset', delta === undefined ? '—' : `${delta > 0 ? '+' : ''}${delta.toFixed(1)} ms`);
      text(
        'threshold',
        runtime.gaugeSurvival ? 'Survival' : runtime.clearThreshold === undefined ? '—' : `${runtime.clearThreshold}%`,
      );
      text(
        'clear',
        state.cleared ? 'Clear' : runtime.gaugeSurvival ? (gauge > 0 ? 'Surviving' : 'Failed') : 'Below threshold',
      );
      text('hiSpeed', state.view.hiSpeed.player.toFixed(2));
      text('drawnSpeed', state.view.hiSpeed.drawn.toFixed(2));
      text('hsFix', state.view.hsFix ?? options.hsFix);
      text('green', runtime.greenNumber === undefined ? '—' : Math.round(runtime.greenNumber));
      text('visible', runtime.visibleMs === undefined ? '—' : `${Math.round(runtime.visibleMs)} ms`);
      text(
        'bpmRange',
        runtime.minBPM === undefined || runtime.maxBPM === undefined
          ? '—'
          : `${Math.round(runtime.minBPM)}–${Math.round(runtime.maxBPM)}`,
      );
      text('mainBpm', runtime.mainBPM === undefined ? '—' : Math.round(runtime.mainBPM));
      text(
        'covers',
        state.view.covers
          .map(
            (cover) =>
              `${cover.side} · SUD ${cover.suddenOn ? Math.round(cover.sudden * 100) : 'OFF'} · HID ${cover.hiddenOn ? Math.round(cover.hidden * 100) : 'OFF'} · LIFT ${Math.round(cover.lift * 100)}%`,
          )
          .join(' / '),
      );
      text(
        'chartInfo',
        [
          frame.chart?.artist,
          frame.chart?.genre,
          runtime.playVariant ? `${runtime.playVariant} KEY` : undefined,
          frame.chart?.playLevel !== undefined ? `Lv. ${frame.chart.playLevel}` : undefined,
          `${total} notes`,
          frame.chart?.chartPath,
        ]
          .filter(Boolean)
          .join(' · '),
      );
      text(
        'courseInfo',
        frame.course
          ? `${frame.course.title} · Stage ${(frame.course.stageIndex ?? 0) + 1}/${frame.course.stages.length}`
          : 'Single chart',
      );
      text('ruleset', runtime.rulesetLabel ?? '—');
      text('random', `${options.random1P} / ${options.random2P}`);
      text('gauges', `${options.gauge1P} / ${options.gauge2P}`);
      text('scratch', `1P ${options.autoScratch1P ? 'ON' : 'OFF'} / 2P ${options.autoScratch2P ? 'ON' : 'OFF'}`);
      text('flip', options.dpFlip ? 'ON' : 'OFF');
      text('bga', options.bga);
      setText(pause, frame.stage === 'paused' ? 'Resume' : 'Pause');
      // Bound chart work even during a long course; histories themselves stay shared and immutable.
      if (previousGaugeHistory !== state.gaugeHistory) {
        previousGaugeHistory = state.gaugeHistory;
        const history = state.gaugeHistory;
        const points: string[] = [];
        const samples = Math.min(96, history.length);
        for (let index = 0; index < samples; index++) {
          const sample = history[Math.round((index / Math.max(1, samples - 1)) * (history.length - 1))]!;
          points.push(`${sample.progress * 220},${44 - Math.max(0, Math.min(100, sample.value)) * 0.44}`);
        }
        gaugeLine.setAttribute('points', points.join(' '));
      }
      const threshold = 44 - Math.max(0, Math.min(100, runtime.clearThreshold ?? 0)) * 0.44;
      thresholdLine.setAttribute('y1', String(threshold));
      thresholdLine.setAttribute('y2', String(threshold));
      thresholdLine.style.display = runtime.gaugeSurvival || runtime.clearThreshold === undefined ? 'none' : '';
      if (previousTimings !== state.judgeTimings) {
        previousTimings = state.judgeTimings;
        timingLine.setAttribute(
          'points',
          state.judgeTimings
            .slice(-32)
            .map((hit, index) => `${(index / 31) * 220},${22 + Math.max(-100, Math.min(100, hit.deltaMs)) * 0.22}`)
            .join(' '),
        );
      }
    },
    dispose() {
      root.remove();
    },
  };
}
