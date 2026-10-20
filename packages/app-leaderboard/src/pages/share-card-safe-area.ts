/**
 * The safe area of the 1200 x 630 share cards (og:image / twitter:image): where a card's important content (titles,
 * scores, player names, the site's name) stays visible in link previews. Social networks draw over and crop the
 * picture; the numbers below and their sources are in docs/leaderboard.md section 11. Kept free of DOM and Worker
 * types, so the client's card drawing and the server's tests share it.
 */

export const SHARE_CARD_WIDTH = 1200;
export const SHARE_CARD_HEIGHT = 630;

/** An axis-aligned box on the card, in card pixels. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * How far content stays from every edge. X shows summary_large_image pictures at 2:1, which crops 15 px from the top
 * and the bottom of a 1200 x 630 card; the rest is breathing room.
 */
export const SAFE_EDGE = 24;

/**
 * The square at each corner that content stays out of. Previews round their corners: X by about 16 px on a card shown
 * about 500 px wide (some 40 px of the card), Bluesky by 12 px, Mastodon by 8 px, Discord by 4 px.
 */
export const SAFE_CORNER = 48;

/**
 * Where X lays the link's domain over the picture: a pill 12 px in from the bottom-left corner and 20 px high on a card
 * shown about 300 px wide on phones, that is the bottom fifth of the card; its width follows the domain, and half the
 * card covers a domain of some 20 characters.
 */
export const X_DOMAIN_LABEL_ZONE: Box = {
  x: 0,
  y: SHARE_CARD_HEIGHT - 126,
  width: SHARE_CARD_WIDTH / 2,
  height: 126,
};

function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** The corners' squares (SAFE_CORNER), top left, top right, bottom left, bottom right. */
export const SAFE_CORNER_ZONES: readonly Box[] = [
  { x: 0, y: 0, width: SAFE_CORNER, height: SAFE_CORNER },
  { x: SHARE_CARD_WIDTH - SAFE_CORNER, y: 0, width: SAFE_CORNER, height: SAFE_CORNER },
  { x: 0, y: SHARE_CARD_HEIGHT - SAFE_CORNER, width: SAFE_CORNER, height: SAFE_CORNER },
  {
    x: SHARE_CARD_WIDTH - SAFE_CORNER,
    y: SHARE_CARD_HEIGHT - SAFE_CORNER,
    width: SAFE_CORNER,
    height: SAFE_CORNER,
  },
];

/**
 * Why `box` is outside the safe area, or null when it is inside: within SAFE_EDGE of every edge, out of the corners'
 * squares and out of X's domain label.
 */
export function safeAreaViolation(box: Box): string | null {
  if (box.width < 0 || box.height < 0) return 'negative size';
  if (box.x < SAFE_EDGE || box.y < SAFE_EDGE) return 'too close to the top or left edge';
  if (box.x + box.width > SHARE_CARD_WIDTH - SAFE_EDGE || box.y + box.height > SHARE_CARD_HEIGHT - SAFE_EDGE) {
    return 'too close to the bottom or right edge';
  }
  if (SAFE_CORNER_ZONES.some((corner) => intersects(box, corner))) return 'in a rounded corner';
  if (intersects(box, X_DOMAIN_LABEL_ZONE)) return "under X's domain label";
  return null;
}
