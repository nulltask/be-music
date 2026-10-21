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
      <div class="hud-heading"><span class="eyebrow" data-mode>Live</span><h2 data-title></h2><span class="muted" data-stage></span></div>
      <div class="hud-score"><span class="muted">EX SCORE</span><strong class="stat" data-score>0</strong></div>
      <dl><dt>Combo</dt><dd data-combo>0</dd><dt>BPM</dt><dd data-bpm>—</dd><dt>Time</dt><dd data-time>0 / 0</dd></dl>
      <label class="hud-gauge"><span data-gauge>Gauge</span><meter min="0" max="100" value="0" aria-label="Gauge"></meter></label>
      <div class="actions"><button data-pause>Pause</button><button data-retry>Retry</button><button data-quit>Back</button></div>
    </aside>`,
  );
  const score = query(root, '[data-score]');
  const combo = query(root, '[data-combo]');
  const bpm = query(root, '[data-bpm]');
  const time = query(root, '[data-time]');
  const meter = query<HTMLMeterElement>(root, 'meter');
  query(root, '[data-pause]').addEventListener('click', () => actions.pause());
  query(root, '[data-retry]').addEventListener('click', () => actions.restart());
  query(root, '[data-quit]').addEventListener('click', () => actions.quit());
  return {
    update(frame) {
      root.dataset.orientation = frame.layout.orientation;
      root.style.setProperty('--stage-ratio', String(frame.layout.stage.width / frame.layout.stage.height));
      setText(query(root, '[data-title]'), frame.chart?.title ?? 'Preparing chart');
      setText(query(root, '[data-mode]'), frame.replay ? 'Replay' : frame.autoPlay ? 'Auto play' : 'Live');
      setText(
        query(root, '[data-stage]'),
        frame.stage === 'loading' ? `Loading ${Math.round((frame.progress ?? 0) * 100)}%` : frame.stage,
      );
      setText(score, String(frame.state.exScore));
      setText(combo, String(frame.state.combo));
      setText(bpm, frame.bpm === undefined ? '—' : String(Math.round(frame.bpm)));
      setText(time, `${Math.max(0, Math.floor(frame.seconds))} / ${Math.ceil(frame.state.totalSeconds)} s`);
      const gauge = Math.min(100, Math.max(0, frame.state.gauge));
      if (meter.value !== gauge) meter.value = gauge;
      setText(query(root, '[data-gauge]'), `${frame.state.gaugeType ?? 'Gauge'} · ${gauge.toFixed(1)}%`);
      setText(query(root, '[data-pause]'), frame.stage === 'paused' ? 'Resume' : 'Pause');
    },
    dispose() {
      root.remove();
    },
  };
}
