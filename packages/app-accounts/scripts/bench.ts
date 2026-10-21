import { performance } from 'node:perf_hooks';
import { normalizeHandle, normalizeDisplayName, generateHandle } from '../src/profiles.ts';
import { avatarURL, generatedAvatarSVG, detectAvatarType } from '../src/avatars.ts';
import { sha256HexAsync as sha256Hex } from '@be-music/shared-utils/hash';
const cases = {
  normalizeHandle: () => normalizeHandle('DJ_Taro'),
  normalizeDisplayName: () => normalizeDisplayName('  Café 🎹  '),
  generateHandle: () => generateHandle(new Uint8Array(8)),
  avatarURL: () => avatarURL('dj_taro', null),
  generatedAvatarSVG: () => generatedAvatarSVG('benchmark-user'),
  detectAvatarType: () => detectAvatarType(new Uint8Array([0xff, 0xd8, 0xff])),
  sha256Hex: () => sha256Hex('benchmark-avatar'),
};
for (const [name, run] of Object.entries(cases)) {
  const iterations = 1000;
  const start = performance.now();
  for (let i = 0; i < iterations; i++) await run();
  console.log(JSON.stringify({ name, iterations, durationMs: performance.now() - start }));
}
