import { renderBuildInfo } from '../src/build-info.ts';
const info = { builtAt: '2026-10-20T08:00:00Z', revision: 'a'.repeat(40) };
const start = performance.now();
for (let index = 0; index < 10000; index++) renderBuildInfo(info);
console.log(JSON.stringify({ name: 'renderBuildInfo', iterations: 10000, durationMs: performance.now() - start }));
