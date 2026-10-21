import type {
  BeMusicDOMResultFrame,
  BeMusicDOMResultActions,
  BeMusicDOMDecideFrame,
  BeMusicDOMDecideActions,
  BeMusicDOMScreen,
} from '@be-music/player-skin-sdk';
import { createScreen, query, setText } from './screen.ts';

export function mountResult(
  container: HTMLElement,
  actions: BeMusicDOMResultActions,
): BeMusicDOMScreen<BeMusicDOMResultFrame> {
  const root = createScreen(
    container,
    'result',
    `<div class="center">
    <p class="eyebrow">Play result</p><h1 data-title></h1><p class="muted" data-verdict></p>
    <div class="panel"><p class="stat" data-score></p><p class="muted">EX SCORE</p>
    <dl data-stats></dl><svg viewBox="0 0 500 100" role="img" aria-label="Gauge history" style="width:100%;height:100px"><polyline fill="none" stroke="#abcaff" stroke-width="2"></polyline></svg></div>
    <div class="actions"><button class="primary" data-next>Continue</button><button data-retry>Retry</button></div></div>`,
  );
  query(root, '[data-next]').addEventListener('click', () => actions.continue());
  query(root, '[data-retry]').addEventListener('click', () => actions.retry());
  let shown: BeMusicDOMResultFrame['result'] | undefined;
  return {
    update({ result, inputReady }) {
      query<HTMLButtonElement>(root, '[data-next]').disabled = !inputReady;
      query<HTMLButtonElement>(root, '[data-retry]').disabled = !inputReady;
      if (shown === result) return;
      shown = result;
      setText(query(root, '[data-title]'), result.chart.title);
      setText(query(root, '[data-verdict]'), result.lamp ?? (result.cleared ? 'CLEARED' : 'FAILED'));
      setText(query(root, '[data-score]'), `${result.score.exScore} / ${result.score.total * 2}`);
      const stats = query(root, '[data-stats]');
      const pairs = [
        ['Max combo', result.maxCombo],
        ['Gauge', `${result.gauge.toFixed(1)}%`],
        ...(['perfect', 'great', 'good', 'bad', 'poor', 'emptyPoor'] as const).map((key) => [
          key.toUpperCase(),
          result.score[key],
        ]),
      ];
      for (const [label, value] of pairs) {
        const term = document.createElement('dt');
        term.textContent = String(label);
        const detail = document.createElement('dd');
        detail.textContent = String(value);
        stats.append(term, detail);
      }
      query(root, 'polyline').setAttribute(
        'points',
        result.gaugeHistory.map((sample) => `${sample.progress * 500},${100 - sample.value}`).join(' '),
      );
    },
    dispose() {
      root.remove();
    },
  };
}

export function mountDecide(
  container: HTMLElement,
  actions: BeMusicDOMDecideActions,
): BeMusicDOMScreen<BeMusicDOMDecideFrame> {
  const root = createScreen(
    container,
    'decide',
    `<div class="center"><p class="eyebrow">Up next</p><h1></h1><p class="muted" data-artist></p><progress max="1" value="0" aria-label="Chart loading"></progress><div class="actions"><button class="primary" data-next>Start</button><button data-back>Back</button></div></div>`,
  );
  query(root, '[data-next]').addEventListener('click', () => actions.continue());
  query(root, '[data-back]').addEventListener('click', () => actions.cancel());
  return {
    update(frame) {
      setText(query(root, 'h1'), frame.chart.title);
      setText(query(root, '[data-artist]'), frame.chart.artist ?? '');
      query<HTMLProgressElement>(root, 'progress').value = frame.progress ?? 0;
      query<HTMLButtonElement>(root, '[data-next]').disabled = !frame.inputReady;
    },
    dispose() {
      root.remove();
    },
  };
}
