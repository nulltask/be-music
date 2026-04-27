import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const repositoryDir = resolve(import.meta.dirname, '../..');

// Vite alias は string で starts-with マッチするので、長いサブパスを先に並べる必要がある。
// `@be-music/audio-renderer` (root, Node 依存) と `@be-music/utils` (root, Node 依存) は意図的に
// alias しない: ブラウザ向けには pure な subpath (`/triggers`, `/core`) のみ使わせる。
const workspaceAliases = [
  {
    find: '@be-music/audio-renderer/triggers',
    replacement: resolve(repositoryDir, 'packages/audio-renderer/src/core/triggers.ts'),
  },
  { find: '@be-music/utils/core', replacement: resolve(repositoryDir, 'packages/utils/src/core.ts') },
  { find: '@be-music/chart', replacement: resolve(repositoryDir, 'packages/chart/src/index.ts') },
  { find: '@be-music/json', replacement: resolve(repositoryDir, 'packages/json/src/index.ts') },
  { find: '@be-music/parser', replacement: resolve(repositoryDir, 'packages/parser/src/index.ts') },
  { find: '@be-music/player-web-core', replacement: resolve(repositoryDir, 'packages/player-web-core/src/index.ts') },
];

export default defineConfig({
  resolve: {
    alias: workspaceAliases,
  },
  optimizeDeps: {
    exclude: workspaceAliases.map((entry) => entry.find),
  },
  server: {
    fs: {
      allow: [repositoryDir],
    },
  },
});
