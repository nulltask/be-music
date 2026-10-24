import { readdir, readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, relative, resolve, sep } from 'node:path';

/**
 * Serves local folders to the web player for the course browser checklist (`docs/course-checklist.md`), since browser
 * automation cannot drop real files: `GET /__list?root=<name>` lists a root's files, `GET /__file?root=<name>&path=<p>`
 * returns one, both with CORS open so the player page can fetch them and dispatch a synthetic drop.
 *
 * Usage: `node scripts/course-checklist/serve.ts [--port 5299] <name>=<dir> [<name>=<dir> …]`, e.g.
 * `fixtures=/tmp/checklist/songs lr2theme=~/LR2beta3/LR2files`. Video files are left out of listings.
 */

const SKIPPED = /\.(mp4|wmv|mpg|mpeg|avi|webm|flv)$/iu;

async function listFiles(root: string, dir = root): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(root, path)));
    else if (entry.isFile() && entry.name !== '.DS_Store' && !SKIPPED.test(entry.name)) {
      out.push(relative(root, path).split(sep).join('/'));
    }
  }
  return out.sort();
}

const args = process.argv.slice(2);
let port = 5299;
const roots = new Map<string, string>();
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index]!;
  if (arg === '--port') {
    port = Number(args[(index += 1)]);
    continue;
  }
  const equals = arg.indexOf('=');
  if (equals > 0) roots.set(arg.slice(0, equals), resolve(arg.slice(equals + 1)));
}
if (roots.size === 0) {
  console.error('usage: node scripts/course-checklist/serve.ts [--port 5299] <name>=<dir> …');
  process.exit(1);
}

createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const root = roots.get(url.searchParams.get('root') ?? '');
  response.setHeader('Access-Control-Allow-Origin', '*');
  try {
    if (root !== undefined && url.pathname === '/__list') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(await listFiles(root)));
      return;
    }
    const path = url.searchParams.get('path');
    if (root !== undefined && url.pathname === '/__file' && path !== null) {
      const file = resolve(root, path);
      // Only files under the root are served.
      if (!file.startsWith(root + sep) || !(await stat(file)).isFile()) throw new Error('not found');
      response.setHeader('Content-Type', 'application/octet-stream');
      response.end(await readFile(file));
      return;
    }
    response.statusCode = 404;
    response.end();
  } catch (error) {
    response.statusCode = 404;
    response.end(String(error));
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`serving ${[...roots.keys()].join(', ')} on http://127.0.0.1:${port}`);
});
