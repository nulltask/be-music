import type { PlayEnvironment } from '@be-music/app-play/app-title';

const PREVIEW_PLAY_HOST = 'play.preview.be-music.app';

/** The deployment a Worker serves, from its public origin (`PUBLIC_ORIGIN`, cloudflare.config.ts). */
export function playEnvironmentOfOrigin(origin: string): Exclude<PlayEnvironment, 'development'> {
  return new URL(origin).hostname.toLowerCase() === PREVIEW_PLAY_HOST ? 'preview' : 'production';
}
