import { resolveURLLoadFetchURL } from '../url-load.ts';

/** The archive an embed previews: the page's `?track=` URL, resolved against the page and fetched through the proxy. */
export interface EmbedTrack {
  /** The URL as given, resolved against the page. */
  readonly url: string;
  /** Where to fetch it from: the URL itself on this origin, the same-origin proxy otherwise. */
  readonly fetchURL: string;
  /** The archive's file name, for the collection's source label. */
  readonly fileName: string;
}

/** Reads `?track=` from `href`; `undefined` without one, or when it is not an http(s) URL the embed can fetch. */
export function parseEmbedTrack(href: string): EmbedTrack | undefined {
  const raw = new URL(href).searchParams.get('track');
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw, href);
  } catch {
    return undefined;
  }
  let fetchURL: string;
  try {
    fetchURL = resolveURLLoadFetchURL(url.href, href);
  } catch {
    return undefined;
  }
  const last = url.pathname.split('/').filter(Boolean).pop();
  let fileName = 'track.zip';
  if (last) {
    try {
      fileName = decodeURIComponent(last);
    } catch {
      fileName = last;
    }
  }
  if (!/\.zip$/iu.test(fileName)) fileName = `${fileName}.zip`;
  return { url: url.href, fetchURL, fileName };
}
