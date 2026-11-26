/**
 * Where a page goes next: a path on this host (`/account`, `/`), never another origin or a protocol-relative URL.
 * Anything else goes to `/account`. The page script uses it too, so it imports nothing server-only.
 */
export function nextPath(next: string | null | undefined): string {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) {
    return '/account';
  }
  return next;
}
