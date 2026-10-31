import { resolveURLLoadFetchURL } from '../url-load.ts';

/** How the embed plays a chart: `'preview'` plays it in AUTO like a video, `'play'` lets the viewer play it. */
export type EmbedMode = 'preview' | 'play';

/**
 * Whether the embed waits for a tap before downloading the track: on a phone or tablet (`touchFirst`), whose data may
 * be metered, and wherever the browser asks to save data. A desktop downloads at once.
 */
export function embedWaitsToDownload(device: { touchFirst: boolean }, saveData: boolean | undefined): boolean {
  return device.touchFirst || saveData === true;
}

/** The mode the embed's AUTO checkbox picks: checked plays in AUTO (`'preview'`), cleared lets the viewer play. */
export function embedModeOfAutoPlay(autoPlay: boolean): EmbedMode {
  return autoPlay ? 'preview' : 'play';
}

/**
 * Whether a click or tap on the stage pauses the play, as it does a video. Not while the viewer plays (`'play'`): a tap
 * there is part of playing, not a request to stop, so only the controls bar and the play's own keys pause it.
 */
export function embedStageTapPauses(mode: EmbedMode): boolean {
  return mode !== 'play';
}

/** The archive an embed previews: the page's `?track=` URL, resolved against the page and fetched through the proxy. */
export interface EmbedTrack {
  /** The URL as given, resolved against the page. */
  readonly url: string;
  /** Where to fetch it from: the URL itself on this origin, the same-origin proxy otherwise. */
  readonly fetchURL: string;
  /** The archive's file name, for the collection's source label. */
  readonly fileName: string;
  /** `?mode=`: `play` lets the viewer play with the keyboard; `preview` (the default, and any other value) plays in AUTO. */
  readonly mode: EmbedMode;
  /** `?chart=`: the chart to play on its own (`findEmbedChart`); the whole track's list without one. */
  readonly chart?: string;
  /** `?course=`: an LR2 or beatoraja course file inside the archive. Takes precedence over `chart`. */
  readonly course?: string;
  /** `?courseName=`: one course in a file containing several; otherwise show their list. */
  readonly courseName?: string;
}

/**
 * Reads `?track=`, `?mode=`, `?chart=` and the course selectors from `href`; `undefined` without a track, or when it is not an http(s) URL the embed
 * can fetch.
 */
export function parseEmbedTrack(href: string): EmbedTrack | undefined {
  const params = new URL(href).searchParams;
  const raw = params.get('track');
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
  const chart = params.get('chart')?.trim();
  const course = params.get('course')?.trim();
  const courseName = params.get('courseName')?.trim();
  return {
    url: url.href,
    fetchURL,
    fileName,
    mode: params.get('mode')?.trim().toLowerCase() === 'play' ? 'play' : 'preview',
    ...(chart ? { chart } : {}),
    ...(course ? { course, ...(courseName ? { courseName } : {}) } : {}),
  };
}
