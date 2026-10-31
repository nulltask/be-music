import * as lr2SkinAPI from '@be-music/skin-lr2';
import type { DefineBenchmarkCase } from '../../../scripts/bench/exports.types.ts';
import { registerLR2SkinStateExportsCases } from './state-exports-cases.ts';

const BENCH_LR2_SKIN_BYTES = new Uint8Array([
  35, 73, 78, 70, 79, 82, 77, 65, 84, 73, 79, 78, 44, 98, 101, 110, 99, 104, 10,
]);
const BENCH_LR2_INFORMATION_BYTES = new TextEncoder().encode('#INFORMATION,0,bench,author,thumb.bmp,\n');
const BENCH_LR2_SKIN_FILE = makeBenchFile('LR2files/Theme/LR2/Play/play_7.lr2skin', BENCH_LR2_SKIN_BYTES);
const BENCH_LR2_THEME_SELECT_FILE = makeBenchFile('LR2files/Theme/LR2/Select/select.lr2skin', BENCH_LR2_SKIN_BYTES);
const BENCH_SELECT_BGM_FILE = makeBenchFile('LR2files/BGM/LR2/select.wav', 'RIFF');
const BENCH_SYSTEM_SOUND_FILE = makeBenchFile('LR2files/Sound/lr2/scratch.wav', 'RIFF');
const BENCH_TGA = new Uint8Array([0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 32, 32, 10, 20, 30, 255]);
const BENCH_DDS = makeBGRA32DDS(2, 1, new Uint8Array([0x11, 0x22, 0x33, 0xff, 0x44, 0x55, 0x66, 0x80]));
const BENCH_FONT_SOURCE = ['#S 22', '#M 1', '#T 0 font.png', '#R 65 0 0 0 10 22', ''].join('\n');
const BENCH_SKIN = makeLR2Skin();
const BENCH_SONG = {
  chartPath: 'Songs/Bench/main.bms',
  chart: {
    bms: {},
    events: [{ channel: '11' }, { channel: '18' }],
  },
} satisfies lr2SkinAPI.LR2PlaySkinChart;
const BENCH_PMS_SONG = {
  chartPath: 'Songs/Bench/main.pms',
  chart: {
    bms: { player: 3 },
    events: [{ channel: '11' }, { channel: '17' }, { channel: '19' }],
  },
} satisfies lr2SkinAPI.LR2PlaySkinChart;

export function registerLR2SkinExportsCases(define: DefineBenchmarkCase): void {
  registerLR2SkinStateExportsCases(define);
  define('skin-lr2.autoDetectCanvasFromObservedCoordinates', {
    run: () => {
      lr2SkinAPI.autoDetectCanvasFromObservedCoordinates([
        [0, 0],
        [639, 479],
        [640, 480],
        [320, 240],
        [960, 720],
      ]);
    },
  });
  define('skin-lr2.decodeDDSImageData', {
    run: () => {
      lr2SkinAPI.decodeDDSImageData(BENCH_DDS);
    },
  });
  define('skin-lr2.decodeTGA', {
    run: () => {
      lr2SkinAPI.decodeTGA(BENCH_TGA);
    },
  });
  define('skin-lr2.discoverLR2Themes', {
    run: () => {
      lr2SkinAPI.discoverLR2Themes([
        BENCH_LR2_SKIN_FILE,
        BENCH_LR2_THEME_SELECT_FILE,
        makeBenchFile('LR2files/Theme/Bench/Play/play_7.lr2skin', BENCH_LR2_SKIN_BYTES),
        makeBenchFile('Songs/Bench/main.bms', '#TITLE bench'),
      ]);
    },
  });
  define('skin-lr2.extractDxaArchivesAsFlatFiles', {
    run: () => {
      let flattenedCount = 0;
      for (const _entry of lr2SkinAPI.extractDxaArchivesAsFlatFiles([
        ['Play/parts/broken.dxa', BENCH_LR2_SKIN_BYTES],
      ])) {
        flattenedCount += 1;
      }
      if (flattenedCount !== 0) {
        throw new Error('Malformed benchmark DXA unexpectedly produced files.');
      }
    },
  });
  define('skin-lr2.informationTypeToKind', {
    run: () => {
      lr2SkinAPI.informationTypeToKind(0);
      lr2SkinAPI.informationTypeToKind(5);
      lr2SkinAPI.informationTypeToKind(7);
      lr2SkinAPI.informationTypeToKind(99);
    },
  });
  define('skin-lr2.informationTypeToPlayVariant', {
    run: () => {
      lr2SkinAPI.informationTypeToPlayVariant(0);
      lr2SkinAPI.informationTypeToPlayVariant(2);
      lr2SkinAPI.informationTypeToPlayVariant(4);
      lr2SkinAPI.informationTypeToPlayVariant(7);
    },
  });
  define('skin-lr2.isLR2SpecialGraphic', {
    run: () => {
      lr2SkinAPI.isLR2SpecialGraphic('playbg');
    },
  });
  define('skin-lr2.isTGAImage', {
    run: () => {
      lr2SkinAPI.isTGAImage(BENCH_TGA);
    },
  });
  define('skin-lr2.loadLR2SkinFromFiles', {
    run: async () => {
      await lr2SkinAPI.loadLR2SkinFromFiles([BENCH_LR2_SKIN_FILE]);
    },
  });
  define('skin-lr2.loadLR2SkinFromSourceFiles', {
    run: () => {
      lr2SkinAPI.loadLR2SkinFromSourceFiles(
        new Map([['LR2files/Theme/LR2/Play/play_7.lr2skin', BENCH_LR2_SKIN_BYTES]]),
      );
    },
  });
  define('skin-lr2.loadLR2SystemSound', {
    run: async () => {
      await lr2SkinAPI.loadLR2SystemSound([BENCH_SYSTEM_SOUND_FILE], 'scratch');
    },
  });
  define('skin-lr2.loadLR2ThemeBGM', {
    run: async () => {
      await lr2SkinAPI.loadLR2ThemeBGM([BENCH_SELECT_BGM_FILE], 'select');
    },
  });
  define('skin-lr2.loadLR2ThemeSkinsFromFiles', {
    run: async () => {
      await lr2SkinAPI.loadLR2ThemeSkinsFromFiles([BENCH_LR2_SKIN_FILE]);
    },
  });
  define('skin-lr2.parseLR2Font', {
    run: () => {
      lr2SkinAPI.parseLR2Font(BENCH_FONT_SOURCE);
    },
  });
  define('skin-lr2.peekLR2SkinInformationType', {
    run: () => {
      lr2SkinAPI.peekLR2SkinInformationType(BENCH_LR2_INFORMATION_BYTES);
    },
  });
  define('skin-lr2.pickLR2PlaySkin', {
    run: () => {
      lr2SkinAPI.pickLR2PlaySkin({ '7': BENCH_SKIN }, BENCH_SONG);
      lr2SkinAPI.pickLR2PlaySkin({ '9': BENCH_SKIN }, BENCH_PMS_SONG);
      lr2SkinAPI.pickLR2PlaySkin(
        { '14': BENCH_SKIN },
        { ...BENCH_SONG, chart: { ...BENCH_SONG.chart, bms: { player: 2 } } },
        { battleMode: 'AUTO' },
      );
    },
  });
  define('skin-lr2.pickLR2PlaySkinVariant', {
    run: () => {
      lr2SkinAPI.pickLR2PlaySkinVariant({ '7': BENCH_SKIN }, BENCH_SONG);
      lr2SkinAPI.pickLR2PlaySkinVariant({ '9': BENCH_SKIN }, BENCH_PMS_SONG);
      lr2SkinAPI.pickLR2PlaySkinVariant(
        { '14': BENCH_SKIN },
        { ...BENCH_SONG, chart: { ...BENCH_SONG.chart, bms: { player: 2 } } },
        { battleMode: 'AUTO' },
      );
    },
  });
  define('skin-lr2.pickLR2SystemSoundFile', {
    run: () => {
      lr2SkinAPI.pickLR2SystemSoundFile([BENCH_SYSTEM_SOUND_FILE], 'scratch');
    },
  });
  define('skin-lr2.pickLR2ThemeBGMFile', {
    run: () => {
      lr2SkinAPI.pickLR2ThemeBGMFile([BENCH_SELECT_BGM_FILE], 'select');
    },
  });
  define('skin-lr2.readDxaArchive', {
    run: () => {
      lr2SkinAPI.readDxaArchive(BENCH_LR2_SKIN_BYTES);
    },
  });
  define('skin-lr2.resolveLR2AssetBytes', {
    run: () => {
      lr2SkinAPI.resolveLR2AssetBytes(BENCH_SKIN, 'parts.tga');
    },
  });
  define('skin-lr2.stringToLR2CharCodes', {
    run: () => {
      lr2SkinAPI.stringToLR2CharCodes('ABCあいう');
    },
  });
  define('skin-lr2.summarizeLR2PlaySkins', {
    run: () => {
      lr2SkinAPI.summarizeLR2PlaySkins({ '7': BENCH_SKIN });
    },
  });
  define('skin-lr2.unicodeToLR2CharCode', {
    run: () => {
      lr2SkinAPI.unicodeToLR2CharCode('あ');
    },
  });
}

function makeBenchFile(path: string, body: string | Uint8Array<ArrayBuffer>): File {
  const name = path.split('/').at(-1) ?? path;
  const file = new File([body], name);
  Object.defineProperty(file, 'webkitRelativePath', {
    configurable: true,
    enumerable: true,
    value: path,
  });
  return file;
}

function makeBGRA32DDS(width: number, height: number, pixels: Uint8Array): Uint8Array {
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

function makeLR2Skin(): lr2SkinAPI.LR2Skin {
  return {
    name: 'bench',
    scratchFlip: { flipResult: false, flipSide: false, disableFlip: false, reloadBanner: false },
    files: new Map([['parts.tga', BENCH_TGA]]),
  } as unknown as lr2SkinAPI.LR2Skin;
}
