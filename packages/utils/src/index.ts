import { resolve } from 'node:path';

export * from './core.ts';
export * from './log.ts';
export * from './path.ts';
export * from './pcm.ts';
export * from './workerize.ts';

export function resolveCliPath(path: string, cwd: string = process.env.INIT_CWD ?? process.cwd()): string {
  if (path.length === 0 || path === '.') {
    return cwd;
  }

  // Most CLI paths are simple relative paths without parent traversal.
  if (!path.includes('..') && !path.includes('\\')) {
    if (path.startsWith('./')) {
      const relativePath = path.slice(2);
      if (relativePath.length === 0) {
        return cwd;
      }
      return cwd.endsWith('/') ? `${cwd}${relativePath}` : `${cwd}/${relativePath}`;
    }
    const firstCode = path.charCodeAt(0);
    if (firstCode !== 0x2f && firstCode !== 0x2e) {
      return cwd.endsWith('/') ? `${cwd}${path}` : `${cwd}/${path}`;
    }
  }
  return resolve(cwd, path);
}
