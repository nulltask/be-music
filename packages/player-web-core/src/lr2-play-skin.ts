import { resolveChartPlayVariant } from './library.ts';
import { loadLr2SkinFromFiles, type Lr2PlayVariant, type Lr2Skin } from './lr2-skin.ts';
import type { BrowserSongEntry } from './types.ts';

export const LR2_PLAY_VARIANTS = ['7', '14', '10', '5', '9'] as const satisfies readonly Lr2PlayVariant[];

export type Lr2PlaySkinMap = Partial<Record<Lr2PlayVariant, Lr2Skin>>;

export interface Lr2ThemeSkins {
  playSkins: Lr2PlaySkinMap;
  selectSkin?: Lr2Skin;
  resultSkin?: Lr2Skin;
}

const PLAY_SKIN_FALLBACKS: Record<Lr2PlayVariant, readonly Lr2PlayVariant[]> = {
  '14': ['14', '10', '7', '5', '9'],
  '10': ['10', '14', '7', '5', '9'],
  '7': ['7', '14', '5', '10', '9'],
  '5': ['5', '7', '14', '10', '9'],
  '9': ['9', '7', '14', '5', '10'],
};

export async function loadLr2ThemeSkinsFromFiles(files: Iterable<File>): Promise<Lr2ThemeSkins> {
  const sourceFiles = [...files];
  const [variantSkins, selectSkin, resultSkin] = await Promise.all([
    Promise.all(
      LR2_PLAY_VARIANTS.map((variant) => loadLr2SkinFromFiles(sourceFiles, { kind: 'play', playVariant: variant })),
    ),
    loadLr2SkinFromFiles(sourceFiles, { kind: 'select' }),
    loadLr2SkinFromFiles(sourceFiles, { kind: 'result' }),
  ]);

  const playSkins: Lr2PlaySkinMap = {};
  LR2_PLAY_VARIANTS.forEach((variant, index) => {
    const skin = variantSkins[index];
    if (skin) {
      playSkins[variant] = skin;
    }
  });
  return { playSkins, selectSkin, resultSkin };
}

export function pickLr2PlaySkin(playSkins: Lr2PlaySkinMap, song: BrowserSongEntry): Lr2Skin | undefined {
  const target = resolveChartPlayVariant(song);
  for (const variant of PLAY_SKIN_FALLBACKS[target]) {
    const candidate = playSkins[variant];
    if (candidate) {
      return candidate;
    }
  }
  return undefined;
}

export function summarizeLr2PlaySkins(playSkins: Lr2PlaySkinMap, separator = ','): string {
  return (Object.entries(playSkins) as Array<[Lr2PlayVariant, Lr2Skin]>)
    .map(([variant, value]) => `${variant}K=${value.name}`)
    .join(separator);
}
