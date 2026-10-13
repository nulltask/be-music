/** A chart file hash the Leaderboard knows for a chart (`chart_alias`). */
export interface ChartAlias {
  kind: 'sha256' | 'md5';
  hash: string;
}

/** A link to the same chart elsewhere: another Internet Ranking, or a chart database. */
export interface ExternalLink {
  name: string;
  url: string;
  /** `chart`: the chart's own page, keyed by a file hash. `search`: a search for the chart by its title. */
  kind: 'chart' | 'search';
  /** The file hash the link is keyed by, so variants of one chart can be told apart. */
  hash?: string;
  /** For an MD5-keyed link, the SHA-256 of the same file when the plays tell which file that MD5 belongs to. */
  file?: string;
}

const SHA256 = /^[0-9a-f]{64}$/;
const MD5 = /^[0-9a-f]{32}$/;

/** Sites keyed by the chart file's SHA-256, with the formats BMS Search itself links them with. */
const BY_SHA256: ReadonlyArray<{ name: string; url: (sha256: string) => string }> = [
  { name: 'Mocha-Repository', url: (sha256) => `https://mocha-repository.info/song.php?sha256=${sha256}` },
  { name: 'MinIR', url: (sha256) => `https://www.gaftalk.com/minir/#/viewer/song/${sha256}/0` },
  { name: 'BMS Search', url: (sha256) => `https://bmssearch.net/patterns/${sha256}` },
];

/** Sites keyed by the chart file's MD5. */
const BY_MD5: ReadonlyArray<{ name: string; url: (md5: string) => string }> = [
  // A read-only archive of LR2IR's rankings. The original (dream-pro.info) has closed, so the archive is the only link.
  { name: 'LR2IR Archive', url: (md5) => `https://lr2ir.com/charts/${md5}` },
];

/**
 * Links to the chart on other sites, one set per known file (one chart fingerprint can cover several files: re-saves,
 * re-encodes). Mocha-Repository, MinIR and BMS Search look a chart up by the file's SHA-256, the LR2IR archive
 * (lr2ir.com) by its MD5. Malformed hashes are skipped. When no hash is known at all, BMS
 * Search still gets a search for the title. `files` pairs each MD5 with the SHA-256 of the same file (from the plays),
 * so a file's links can be shown together.
 */
export function externalLinks(
  chart: { title: string | null },
  aliases: readonly ChartAlias[],
  files: ReadonlyArray<{ sha256: string; md5: string | null }> = [],
): ExternalLink[] {
  const sha256OfMd5 = new Map(
    files.flatMap((file) => (file.md5 === null ? [] : [[file.md5.toLowerCase(), file.sha256.toLowerCase()] as const])),
  );
  const links: ExternalLink[] = [];
  for (const alias of aliases) {
    const hash = alias.hash.toLowerCase();
    const sites =
      alias.kind === 'sha256' && SHA256.test(hash) ? BY_SHA256 : alias.kind === 'md5' && MD5.test(hash) ? BY_MD5 : [];
    for (const site of sites) {
      const file = alias.kind === 'md5' ? sha256OfMd5.get(hash) : undefined;
      links.push({
        name: site.name,
        url: site.url(hash),
        kind: 'chart',
        hash,
        ...(file !== undefined ? { file } : {}),
      });
    }
  }
  const title = chart.title?.trim();
  if (links.length === 0 && title !== undefined && title.length > 0) {
    links.push({
      name: 'BMS Search',
      url: `https://bmssearch.net/search?q=${encodeURIComponent(title)}`,
      kind: 'search',
    });
  }
  return links;
}
