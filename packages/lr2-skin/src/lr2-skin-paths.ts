/**
 * Which screen's `.lr2skin` to pick when a theme bundle ships multiple
 * (play, select, result, decide, etc.).
 */
export type Lr2SkinKind = 'play' | 'select' | 'result' | 'decide';

/**
 * `play_N.lr2skin` variant hint for the play-skin loader.
 */
export type Lr2PlayVariant = '5' | '7' | '9' | '10' | '14';

export function isSkinPathOfKind(path: string, kind: Lr2SkinKind): boolean {
  const lower = path.toLowerCase();
  if (kind === 'play') {
    return lower.includes('/play') || lower.includes('\\play');
  }
  if (kind === 'result') {
    const sansCourse = lower.replace(/\/courseresult\//gu, '/').replace(/\\courseresult\\/gu, '\\');
    return sansCourse.includes('/result') || sansCourse.includes('\\result');
  }
  if (kind === 'decide') {
    return lower.includes('/decide') || lower.includes('\\decide');
  }
  return lower.includes('/select') || lower.includes('\\select');
}

export function scoreSkinPath(path: string, kind: Lr2SkinKind, variant?: Lr2PlayVariant): number {
  const lower = path.toLowerCase();
  if (kind === 'select') {
    if (lower.endsWith('/select.lr2skin')) {
      return 0;
    }
    if (lower.includes('/select') && lower.endsWith('.lr2skin')) {
      return 10;
    }
    return 100;
  }
  if (kind === 'result') {
    if (lower.includes('/courseresult')) {
      return 90;
    }
    if (lower.endsWith('/result.lr2skin')) {
      return 0;
    }
    if (lower.includes('/result') && lower.endsWith('.lr2skin')) {
      return 10;
    }
    return 100;
  }
  if (kind === 'decide') {
    if (lower.endsWith('/decide.lr2skin')) {
      return 0;
    }
    if (lower.includes('/decide') && lower.endsWith('.lr2skin')) {
      return 10;
    }
    return 100;
  }
  if (variant && lower.endsWith(`/play_${variant}.lr2skin`)) {
    return -1;
  }
  if (lower.endsWith('/play_7.lr2skin')) {
    return 0;
  }
  if (lower.endsWith('/play_5.lr2skin')) {
    return 1;
  }
  if (lower.endsWith('/play_9.lr2skin')) {
    return 2;
  }
  if (lower.endsWith('/play_10.lr2skin')) {
    return 3;
  }
  if (lower.endsWith('/play_14.lr2skin')) {
    return 4;
  }
  if (lower.includes('/play_') && !lower.includes('play_half')) {
    return 30;
  }
  if (lower.includes('play_half')) {
    return 50;
  }
  return 100;
}
