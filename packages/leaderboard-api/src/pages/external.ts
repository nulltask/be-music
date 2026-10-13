/** A chart file hash the Leaderboard knows for a chart (`chart_alias`). */
export interface ChartAlias {
  kind: 'sha256' | 'md5';
  hash: string;
}

/** A link to the same chart elsewhere: another Internet Ranking, or a chart database. */
export interface ExternalLink {
  name: string;
  url: string;
  /** `ranking`: the chart's page on another IR, keyed by a file hash. `search`: a search for the chart by its title. */
  kind: 'ranking' | 'search';
  /** The file hash a ranking link is keyed by, so variants of one chart can be told apart. */
  hash?: string;
}

const SHA256 = /^[0-9a-f]{64}$/;

/**
 * Links to the chart elsewhere.
 *
 * - Mocha-Repository, beatoraja's IR, looks charts up by the file's SHA-256: one link per known file (one chart
 *   fingerprint can cover several files: re-saves, re-encodes). LR2IR looks charts up by MD5, which the Leaderboard
 *   does not record yet, so it gets no link. Malformed hashes are skipped.
 * - BMS Search has no lookup by hash (its chart pages use their own ids), so it gets a search for the title.
 */
export function externalLinks(chart: { title: string | null }, aliases: readonly ChartAlias[]): ExternalLink[] {
  const links: ExternalLink[] = [];
  for (const alias of aliases) {
    const hash = alias.hash.toLowerCase();
    if (alias.kind === 'sha256' && SHA256.test(hash)) {
      links.push({
        name: 'Mocha-Repository',
        url: `https://mocha-repository.info/song.php?sha256=${hash}`,
        kind: 'ranking',
        hash,
      });
    }
  }
  const title = chart.title?.trim();
  if (title !== undefined && title.length > 0) {
    links.push({
      name: 'BMS Search',
      url: `https://bmssearch.net/search?q=${encodeURIComponent(title)}`,
      kind: 'search',
    });
  }
  return links;
}
