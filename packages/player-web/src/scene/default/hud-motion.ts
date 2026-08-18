import { valuePunch } from './motion.ts';

/**
 * Tracks when HUD values change so combo / score / judge can punch independently.
 * Lives on the default gameplay wrapper — not a public API.
 */
export class DefaultHudMotion {
  private judgeKey = '';
  private judgeAt = 0;
  private combo = Number.NaN;
  private comboAt = 0;
  private score = Number.NaN;
  private scoreAt = 0;

  public reset(): void {
    this.judgeKey = '';
    this.judgeAt = 0;
    this.combo = Number.NaN;
    this.comboAt = 0;
    this.score = Number.NaN;
    this.scoreAt = 0;
  }

  public sample(input: { judge?: string; combo?: number; score?: number; nowMs: number }): {
    judgeElapsed: number;
    comboPunch: number;
    scorePunch: number;
  } {
    const now = input.nowMs;
    const judgeKey = input.judge ?? '';
    if (judgeKey !== this.judgeKey) {
      this.judgeKey = judgeKey;
      this.judgeAt = now;
    }
    const combo = input.combo ?? 0;
    if (combo !== this.combo) {
      this.combo = combo;
      this.comboAt = now;
    }
    const score = input.score ?? 0;
    if (score !== this.score) {
      this.score = score;
      this.scoreAt = now;
    }
    return {
      judgeElapsed: judgeKey === '' ? 10_000 : Math.max(0, now - this.judgeAt),
      comboPunch: valuePunch(now - this.comboAt),
      scorePunch: valuePunch(now - this.scoreAt),
    };
  }
}

export class DefaultSelectMotion {
  cursorY = Number.NaN;
  private lastNow = 0;

  public enter(): void {
    this.cursorY = Number.NaN;
    this.lastNow = 0;
  }

  public step(targetY: number, now: number, follow: (current: number, target: number, dtMs: number) => number): number {
    if (!Number.isFinite(this.cursorY)) {
      this.cursorY = targetY;
      this.lastNow = now;
      return this.cursorY;
    }
    const dt = Math.min(48, Math.max(0, now - this.lastNow));
    this.lastNow = now;
    this.cursorY = follow(this.cursorY, targetY, dt);
    return this.cursorY;
  }
}
