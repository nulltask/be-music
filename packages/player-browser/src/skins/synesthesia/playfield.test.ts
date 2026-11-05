import { describe, expect, it } from 'vite-plus/test';
import type { Graphics } from 'pixi.js';
import { mineFilamentLit, renderSynesthesiaLanes, synesthesiaBombCrossAngle } from './playfield.ts';

describe('mineFilamentLit', () => {
  it('lights about two segments in three', () => {
    let lit = 0;
    const total = 2000;
    for (let index = 0; index < total; index += 1) if (mineFilamentLit(120, index % 8, index * 37)) lit += 1;
    expect(lit / total).toBeGreaterThan(0.55);
    expect(lit / total).toBeLessThan(0.75);
  });

  it('holds steady within one flicker tick and re-rolls across ticks', () => {
    const pattern = (nowMs: number) => Array.from({ length: 16 }, (_, segment) => mineFilamentLit(200, segment, nowMs));
    expect(pattern(1000)).toEqual(pattern(1010));
    const later = Array.from({ length: 20 }, (_, tick) => pattern(1000 + tick * 100).join());
    expect(new Set(later).size).toBeGreaterThan(1);
  });
});

describe('lane beam fill', () => {
  it.each([16, 24, 48])('fills a %i-pixel lane to its rails without a horizontal inset', (w) => {
    const rectangles: number[][] = [];
    const graphics = {
      rect(...rect: number[]) {
        rectangles.push(rect);
        return this;
      },
      fill() {
        return this;
      },
    } as unknown as Graphics;
    renderSynesthesiaLanes({
      graphics,
      lanes: [{ channel: '11', kind: 'white', x: 40, w, top: 20, bottom: 320, beam: 1 }],
      beatPhase: 0,
      nowMs: 0,
      effects: 'off',
    });
    expect(rectangles).toContainEqual([40, 70, w, 250]);
    expect(rectangles).toContainEqual([40, 294, w, 26]);
    const railIndex = rectangles.findIndex(
      (rect) => rect[0] === 40 && rect[1] === 20 && rect[2] === 1 && rect[3] === 300,
    );
    const beamIndex = rectangles.findIndex((rect) => rect[1] === 70 && rect[3] === 250);
    expect(railIndex).toBeGreaterThan(beamIndex);
  });

  it('keeps both beam layers inside a short lifted lane', () => {
    const rectangles: number[][] = [];
    const graphics = {
      rect(...rect: number[]) {
        rectangles.push(rect);
        return this;
      },
      fill() {
        return this;
      },
    } as unknown as Graphics;
    renderSynesthesiaLanes({
      graphics,
      lanes: [{ channel: '11', kind: 'white', x: 40, w: 24, top: 310, bottom: 320, beam: 1 }],
      beatPhase: 0,
      nowMs: 0,
      effects: 'off',
    });
    expect(rectangles.slice(1, 3)).toEqual([
      [40, 310, 24, 10],
      [40, 310, 24, 10],
    ]);
  });
});

describe('synesthesiaBombCrossAngle', () => {
  it('starts upright and makes a counter-clockwise quarter turn (negative in y-down screen space)', () => {
    expect(synesthesiaBombCrossAngle(0, 1)).toBeCloseTo(0);
    expect(synesthesiaBombCrossAngle(0.3, 1)).toBeCloseTo(-Math.PI / 2);
    expect(synesthesiaBombCrossAngle(0.9, 1)).toBeCloseTo(-Math.PI / 2);
  });

  it('turns fast at first and settles as the reticle locks', () => {
    const samples = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3].map((t) => synesthesiaBombCrossAngle(t, 1));
    const steps = samples.slice(1).map((angle, index) => samples[index]! - angle);
    for (const step of steps) expect(step).toBeGreaterThan(0);
    for (let index = 1; index < steps.length; index += 1) expect(steps[index]!).toBeLessThan(steps[index - 1]!);
  });

  it('holds the cross still under reduced or no effects', () => {
    expect(synesthesiaBombCrossAngle(0.15, 0.5)).toBe(0);
    expect(synesthesiaBombCrossAngle(0.15, 0)).toBe(0);
  });
});
