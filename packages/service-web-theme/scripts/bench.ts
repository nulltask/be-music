import { renderBuildInfo } from '../src/build-info.ts';
import { renderServiceFooter } from '../src/footer.ts';
const info = { builtAt: '2026-10-20T08:00:00Z', revision: 'a'.repeat(40) };
const buildStarted = performance.now();
for (let index = 0; index < 10000; index++) renderBuildInfo(info);
console.log(
  JSON.stringify({ name: 'renderBuildInfo', iterations: 10000, durationMs: performance.now() - buildStarted }),
);
const footerStarted = performance.now();
for (let index = 0; index < 10000; index++)
  renderServiceFooter({ current: 'dashboard', hostname: 'be-music.app', buildInfo: info, siteHTML: 'be-music' });
console.log(
  JSON.stringify({ name: 'renderServiceFooter', iterations: 10000, durationMs: performance.now() - footerStarted }),
);
