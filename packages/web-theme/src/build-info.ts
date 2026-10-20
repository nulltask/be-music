export interface BuildInfo {
  builtAt: string;
  revision: string;
}

/** Stable, escaped build metadata; absent metadata stays absent in local fixtures. */
export function renderBuildInfo(info?: BuildInfo): string {
  if (!info) return '';
  const escape = (value: string) =>
    value.replace(
      /[&<>"']/g,
      (value) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[value]!,
    );
  const date = new Date(info.builtAt);
  const valid = Number.isFinite(date.getTime());
  const timestamp = valid ? date.toISOString() : '';
  const label = valid ? timestamp.slice(0, 19).replace('T', ' ') + ' UTC' : 'unknown';
  const revision = info.revision || 'unknown';
  const time = valid ? `<time datetime="${timestamp}">${label}</time>` : label;
  return `<span class="build-info">Built ${time} · Revision <code title="${escape(revision)}">${escape(revision.slice(0, 8))}</code></span>`;
}
