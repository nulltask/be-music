// The track's size, shown on the Load button before the embed downloads it on a phone or tablet.

/**
 * The bytes a response's headers say the body holds, or `undefined` when they do not say, or count it compressed in
 * transit (`Content-Encoding`), which is not what the download will deliver.
 */
export function readDownloadSize(headers: Headers): number | undefined {
  if ((headers.get('content-encoding') ?? 'identity') !== 'identity') return undefined;
  const length = Number(headers.get('content-length'));
  return Number.isFinite(length) && length > 0 ? length : undefined;
}

/**
 * The Load button's caption: the file name, and its size when known, in MB as the download progress counts them (KB
 * under 1 MB, where a tenth of a MB would round to nothing).
 */
export function describeDownload(fileName: string, bytes: number | undefined): string {
  if (bytes === undefined) return fileName;
  const size =
    bytes < 1_000_000 ? `${Math.max(1, Math.round(bytes / 1000))} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${fileName} · ${size}`;
}
