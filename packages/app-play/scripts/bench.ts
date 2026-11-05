import { localized } from '../src/ui/localized.ts';
import { playerServiceHeaderTemplate } from '../src/player-header.ts';

const started = performance.now();
for (let index = 0; index < 10000; index++)
  playerServiceHeaderTemplate({ locale: 'en', hostname: 'localhost', requestURL: '/', settingsOpen: index % 2 === 0 });
console.log(
  JSON.stringify({ name: 'playerServiceHeaderTemplate', iterations: 10000, durationMs: performance.now() - started }),
);

const localizationStarted = performance.now();
for (let index = 0; index < 10000; index++) localized('dropTitle');
console.log(
  JSON.stringify({ name: 'localized', iterations: 10000, durationMs: performance.now() - localizationStarted }),
);

const { readStartAccountState, startAccountPlaceholder } = await import('../src/account.ts');
const storage = { getItem: () => 'anonymous' };
for (const [name, run] of [
  ['readStartAccountState', () => readStartAccountState(storage)],
  ['startAccountPlaceholder', () => startAccountPlaceholder('anonymous')],
] as const) {
  const accountStarted = performance.now();
  for (let index = 0; index < 10000; index++) run();
  console.log(JSON.stringify({ name, iterations: 10000, durationMs: performance.now() - accountStarted }));
}
