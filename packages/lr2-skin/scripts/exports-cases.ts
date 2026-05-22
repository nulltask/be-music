import * as lr2SkinApi from '@be-music/lr2-skin';
import type { DefineBenchmarkCase } from '../../../scripts/bench/exports.types.ts';

const BENCH_LR2_SKIN_BYTES = new Uint8Array([
  35, 73, 78, 70, 79, 82, 77, 65, 84, 73, 79, 78, 44, 98, 101, 110, 99, 104, 10,
]);
const BENCH_LR2_INFORMATION_BYTES = new TextEncoder().encode('#INFORMATION,0,bench,author,thumb.bmp,\n');
const BENCH_LR2_SKIN_FILE = makeBenchFile('LR2files/Theme/LR2/Play/play_7.lr2skin', BENCH_LR2_SKIN_BYTES);
const BENCH_LR2_THEME_SELECT_FILE = makeBenchFile('LR2files/Theme/LR2/Select/select.lr2skin', BENCH_LR2_SKIN_BYTES);
const BENCH_SELECT_BGM_FILE = makeBenchFile('LR2files/Bgm/LR2/select.wav', 'RIFF');
const BENCH_SYSTEM_SOUND_FILE = makeBenchFile('LR2files/Sound/lr2/scratch.wav', 'RIFF');
const BENCH_TGA = new Uint8Array([0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 32, 32, 10, 20, 30, 255]);
const BENCH_DDS = makeBgra32Dds(2, 1, new Uint8Array([0x11, 0x22, 0x33, 0xff, 0x44, 0x55, 0x66, 0x80]));
const BENCH_FONT_SOURCE = ['#S 22', '#M 1', '#T 0 font.png', '#R 65 0 0 0 10 22', ''].join('\n');
const BENCH_SKIN = makeLr2Skin();
const BENCH_SONG = {
  chartPath: 'Songs/Bench/main.bms',
  chart: {
    bms: {},
    events: [{ channel: '11' }, { channel: '18' }],
  },
} satisfies lr2SkinApi.Lr2PlaySkinSong;
const BENCH_PMS_SONG = {
  chartPath: 'Songs/Bench/main.pms',
  chart: {
    bms: { player: 3 },
    events: [{ channel: '11' }, { channel: '17' }, { channel: '19' }],
  },
} satisfies lr2SkinApi.Lr2PlaySkinSong;

export function registerLr2SkinExportsCases(define: DefineBenchmarkCase): void {
  define('lr2-skin.autoDetectCanvasFromObservedCoordinates', {
    run: () => {
      lr2SkinApi.autoDetectCanvasFromObservedCoordinates([
        [0, 0],
        [639, 479],
        [640, 480],
        [320, 240],
        [960, 720],
      ]);
    },
  });
  define('lr2-skin.decodeDdsImageData', {
    run: () => {
      lr2SkinApi.decodeDdsImageData(BENCH_DDS);
    },
  });
  define('lr2-skin.decodeTga', {
    run: () => {
      lr2SkinApi.decodeTga(BENCH_TGA);
    },
  });
  define('lr2-skin.discoverLr2Themes', {
    run: () => {
      lr2SkinApi.discoverLr2Themes([
        BENCH_LR2_SKIN_FILE,
        BENCH_LR2_THEME_SELECT_FILE,
        makeBenchFile('LR2files/Theme/Bench/Play/play_7.lr2skin', BENCH_LR2_SKIN_BYTES),
        makeBenchFile('Songs/Bench/main.bms', '#TITLE bench'),
      ]);
    },
  });
  define('lr2-skin.extractDxaArchivesAsFlatFiles', {
    run: () => {
      let flattenedCount = 0;
      for (const _entry of lr2SkinApi.extractDxaArchivesAsFlatFiles([
        ['Play/parts/broken.dxa', BENCH_LR2_SKIN_BYTES],
      ])) {
        flattenedCount += 1;
      }
      if (flattenedCount !== 0) {
        throw new Error('Malformed benchmark DXA unexpectedly produced files.');
      }
    },
  });
  define('lr2-skin.informationTypeToKind', {
    run: () => {
      lr2SkinApi.informationTypeToKind(0);
      lr2SkinApi.informationTypeToKind(5);
      lr2SkinApi.informationTypeToKind(7);
      lr2SkinApi.informationTypeToKind(99);
    },
  });
  define('lr2-skin.informationTypeToPlayVariant', {
    run: () => {
      lr2SkinApi.informationTypeToPlayVariant(0);
      lr2SkinApi.informationTypeToPlayVariant(2);
      lr2SkinApi.informationTypeToPlayVariant(4);
      lr2SkinApi.informationTypeToPlayVariant(7);
    },
  });
  define('lr2-skin.isLr2SpecialGraphic', {
    run: () => {
      lr2SkinApi.isLr2SpecialGraphic('playbg');
    },
  });
  define('lr2-skin.isTgaImage', {
    run: () => {
      lr2SkinApi.isTgaImage(BENCH_TGA);
    },
  });
  define('lr2-skin.loadLr2SkinFromFiles', {
    run: async () => {
      await lr2SkinApi.loadLr2SkinFromFiles([BENCH_LR2_SKIN_FILE]);
    },
  });
  define('lr2-skin.loadLr2SkinFromSourceFiles', {
    run: () => {
      lr2SkinApi.loadLr2SkinFromSourceFiles(
        new Map([['LR2files/Theme/LR2/Play/play_7.lr2skin', BENCH_LR2_SKIN_BYTES]]),
      );
    },
  });
  define('lr2-skin.loadLr2SystemSound', {
    run: async () => {
      await lr2SkinApi.loadLr2SystemSound([BENCH_SYSTEM_SOUND_FILE], 'scratch');
    },
  });
  define('lr2-skin.loadLr2ThemeBgm', {
    run: async () => {
      await lr2SkinApi.loadLr2ThemeBgm([BENCH_SELECT_BGM_FILE], 'select');
    },
  });
  define('lr2-skin.loadLr2ThemeSkinsFromFiles', {
    run: async () => {
      await lr2SkinApi.loadLr2ThemeSkinsFromFiles([BENCH_LR2_SKIN_FILE]);
    },
  });
  define('lr2-skin.parseLr2Font', {
    run: () => {
      lr2SkinApi.parseLr2Font(BENCH_FONT_SOURCE);
    },
  });
  define('lr2-skin.peekLr2SkinInformationType', {
    run: () => {
      lr2SkinApi.peekLr2SkinInformationType(BENCH_LR2_INFORMATION_BYTES);
    },
  });
  define('lr2-skin.pickLr2PlaySkin', {
    run: () => {
      lr2SkinApi.pickLr2PlaySkin({ '7': BENCH_SKIN }, BENCH_SONG);
      lr2SkinApi.pickLr2PlaySkin({ '9': BENCH_SKIN }, BENCH_PMS_SONG);
    },
  });
  define('lr2-skin.pickLr2SystemSoundFile', {
    run: () => {
      lr2SkinApi.pickLr2SystemSoundFile([BENCH_SYSTEM_SOUND_FILE], 'scratch');
    },
  });
  define('lr2-skin.pickLr2ThemeBgmFile', {
    run: () => {
      lr2SkinApi.pickLr2ThemeBgmFile([BENCH_SELECT_BGM_FILE], 'select');
    },
  });
  define('lr2-skin.readDxaArchive', {
    run: () => {
      lr2SkinApi.readDxaArchive(BENCH_LR2_SKIN_BYTES);
    },
  });
  define('lr2-skin.resolveLr2AssetBytes', {
    run: () => {
      lr2SkinApi.resolveLr2AssetBytes(BENCH_SKIN, 'parts.tga');
    },
  });
  define('lr2-skin.stringToLr2CharCodes', {
    run: () => {
      lr2SkinApi.stringToLr2CharCodes('ABCあいう');
    },
  });
  define('lr2-skin.summarizeLr2PlaySkins', {
    run: () => {
      lr2SkinApi.summarizeLr2PlaySkins({ '7': BENCH_SKIN });
    },
  });
  define('lr2-skin.unicodeToLr2CharCode', {
    run: () => {
      lr2SkinApi.unicodeToLr2CharCode('あ');
    },
  });
}

function makeBenchFile(path: string, body: string | Uint8Array): File {
  const name = path.split('/').at(-1) ?? path;
  const file = new File([body], name);
  Object.defineProperty(file, 'webkitRelativePath', {
    configurable: true,
    enumerable: true,
    value: path,
  });
  return file;
}

function makeBgra32Dds(width: number, height: number, pixels: Uint8Array): Uint8Array {
  const header = new Uint8Array(128);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x20534444, true);
  view.setUint32(4, 124, true);
  view.setUint32(8, 0x000a1007, true);
  view.setUint32(12, height, true);
  view.setUint32(16, width, true);
  view.setUint32(76, 32, true);
  view.setUint32(80, 0x41, true);
  view.setUint32(88, 32, true);
  view.setUint32(92, 0x00ff0000, true);
  view.setUint32(96, 0x0000ff00, true);
  view.setUint32(100, 0x000000ff, true);
  view.setUint32(104, 0xff000000, true);
  const out = new Uint8Array(header.byteLength + pixels.byteLength);
  out.set(header, 0);
  out.set(pixels, header.byteLength);
  return out;
}

function makeLr2Skin(): lr2SkinApi.Lr2Skin {
  return {
    name: 'bench',
    scratchFlip: { flipResult: false, flipSide: false, disableFlip: false, reloadBanner: false },
    files: new Map([['parts.tga', BENCH_TGA]]),
  } as lr2SkinApi.Lr2Skin;
}
