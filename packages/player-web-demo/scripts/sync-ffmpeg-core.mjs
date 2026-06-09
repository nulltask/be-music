// Syncs the ffmpeg.wasm core to the R2 bucket that backs `/ffmpeg-core/*` (served by worker/index.ts), but only when
// the freshly built bytes differ from what's already there. The ~31 MB wasm only changes when the pinned `@ffmpeg/core`
// version does, so re-uploading it on every deploy would be pure waste — and in Workers Builds CI it would also hit R2
// on every push, where the auto-generated token may not even have R2 write access.
//
// Identity is tracked with a tiny `ffmpeg-core.manifest` object in the same bucket that records each core file's md5.
// R2's ETag is the md5 for single-part uploads, but Wrangler has no cheap HEAD — fetching the few-byte manifest lets us
// decide without downloading the 31 MB wasm. Pass `--force` to upload unconditionally (used by `cf:r2:push`).
//
// Run from the package root (the npm scripts do); `dist/ffmpeg-core/` must already be built.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BUCKET = 'be-music-ffmpeg-core';
const MANIFEST_KEY = 'ffmpeg-core.manifest';
const CORE_DIR = fileURLToPath(new URL('../dist/ffmpeg-core/', import.meta.url));
const FILES = [
  { name: 'ffmpeg-core.wasm', contentType: 'application/wasm' },
  { name: 'ffmpeg-core.js', contentType: 'text/javascript' },
];

const force = process.argv.includes('--force');
const tmpDir = mkdtempSync(join(tmpdir(), 'ffmpeg-core-'));

function wrangler(args, options = {}) {
  return execFileSync('pnpm', ['exec', 'wrangler', ...args], { encoding: 'utf8', ...options });
}

function md5(path) {
  return createHash('md5').update(readFileSync(path)).digest('hex');
}

const localManifest = Object.fromEntries(FILES.map((file) => [file.name, md5(join(CORE_DIR, file.name))]));

function readRemoteManifest() {
  const out = join(tmpDir, 'remote.manifest');
  try {
    // A missing object exits non-zero; we treat any read failure as "needs upload" — safe because the worst case is one
    // redundant upload, never a stale skip.
    wrangler(['r2', 'object', 'get', `${BUCKET}/${MANIFEST_KEY}`, '--file', out, '--remote'], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return JSON.parse(readFileSync(out, 'utf8'));
  } catch {
    return null;
  }
}

function put(key, file, contentType) {
  wrangler(['r2', 'object', 'put', `${BUCKET}/${key}`, '--file', file, '--content-type', contentType, '--remote'], {
    stdio: 'inherit',
  });
}

try {
  if (!force) {
    const remote = readRemoteManifest();
    if (remote && FILES.every((file) => remote[file.name] === localManifest[file.name])) {
      // eslint-disable-next-line no-console
      console.log('[ffmpeg-core] R2 already matches the built core — skipping upload.');
      process.exit(0);
    }
  }

  for (const file of FILES) {
    // eslint-disable-next-line no-console
    console.log(`[ffmpeg-core] uploading ${file.name} -> r2://${BUCKET}`);
    put(file.name, join(CORE_DIR, file.name), file.contentType);
  }

  const manifestFile = join(tmpDir, MANIFEST_KEY);
  writeFileSync(manifestFile, JSON.stringify(localManifest));
  put(MANIFEST_KEY, manifestFile, 'application/json');

  // eslint-disable-next-line no-console
  console.log('[ffmpeg-core] R2 sync complete.');
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}
