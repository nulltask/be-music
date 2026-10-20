import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vite-plus/test';
import {
  SAFE_CORNER,
  SAFE_EDGE,
  safeAreaViolation,
  SHARE_CARD_HEIGHT,
  SHARE_CARD_WIDTH,
  X_DOMAIN_LABEL_ZONE,
} from './share-card-safe-area.ts';

describe('share card safe area', () => {
  test('a box in the middle of the card is safe', () => {
    expect(safeAreaViolation({ x: 100, y: 100, width: 800, height: 300 })).toBeNull();
  });

  test('a box against an edge is not, because 2:1 previews crop the top and the bottom', () => {
    expect(safeAreaViolation({ x: 100, y: 10, width: 200, height: 40 })).toMatch(/edge/);
    expect(safeAreaViolation({ x: 600, y: 590, width: 200, height: 30 })).toMatch(/edge/);
    expect(safeAreaViolation({ x: SAFE_EDGE, y: SAFE_EDGE + SAFE_CORNER, width: 10, height: 10 })).toBeNull();
  });

  test('a box in a rounded corner is not', () => {
    expect(safeAreaViolation({ x: SAFE_EDGE, y: SAFE_EDGE, width: 40, height: 40 })).toBe('in a rounded corner');
    expect(safeAreaViolation({ x: 1140, y: 30, width: 30, height: 20 })).toBe('in a rounded corner');
  });

  test("a box under X's domain label in the bottom left is not, and the bottom right is fine", () => {
    expect(safeAreaViolation({ x: 72, y: 546, width: 300, height: 56 })).toBe("under X's domain label");
    expect(safeAreaViolation({ x: 700, y: 546, width: 300, height: 56 })).toBeNull();
    expect(X_DOMAIN_LABEL_ZONE.y + X_DOMAIN_LABEL_ZONE.height).toBe(SHARE_CARD_HEIGHT);
    expect(X_DOMAIN_LABEL_ZONE.width).toBe(SHARE_CARD_WIDTH / 2);
  });

  test("the default card's text (icons/og.svg) starts inside the safe area and ends above X's domain label", () => {
    const svg = readFileSync(join(import.meta.dirname, 'icons/og.svg'), 'utf8');
    expect(svg).toContain(`viewBox="0 0 ${SHARE_CARD_WIDTH} ${SHARE_CARD_HEIGHT}"`);
    const texts = [...svg.matchAll(/<text x="(\d+)" y="(\d+)" font-size="(\d+)"/g)].map((match) => ({
      x: Number(match[1]),
      baseline: Number(match[2]),
      size: Number(match[3]),
    }));
    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts) {
      // The em box above the baseline and a quarter em of descenders below, one em wide at least.
      const box = { x: text.x, y: text.baseline - text.size, width: text.size, height: text.size * 1.25 };
      expect(safeAreaViolation(box)).toBeNull();
    }
  });
});
