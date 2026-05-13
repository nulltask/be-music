import { describe, expect, it } from 'vitest';
import {
  autoDetectCanvasFromObservedCoordinates,
  isLr2SpecialGraphic,
  loadLr2SkinFromSourceFiles,
  LR2_SPECIAL_GRAPHIC,
  resolveLr2AssetBytes,
} from './skin.ts';

const lines = (...rows: string[]): Uint8Array => new TextEncoder().encode(rows.join('\n'));

const imageCsv = (name: string, grIndex = 0): Uint8Array =>
  lines(
    `#IMAGE,${name}.png`,
    `#SRC_IMAGE,0,${grIndex},0,0,100,100,1,1,0,0`,
    '#DST_IMAGE,0,0,0,0,100,100,0,255,255,255,255',
  );

const imagePathsOf = (skin: ReturnType<typeof loadLr2SkinFromSourceFiles>): string[] =>
  skin?.images.map((image) => image.source.imagePath) ?? [];

describe('LR2 special graphics', () => {
  it('exposes renderer-independent sentinel paths', () => {
    expect(isLr2SpecialGraphic(LR2_SPECIAL_GRAPHIC.STAGEFILE)).toBe(true);
    expect(isLr2SpecialGraphic('stagefile.png')).toBe(false);
  });
});

describe('loadLr2SkinFromSourceFiles', () => {
  it('reads a single CSV without conditionals', () => {
    const files = new Map<string, Uint8Array>([['skin/main.csv', imageCsv('a')]]);
    expect(imagePathsOf(loadLr2SkinFromSourceFiles(files))).toEqual(['a.png']);
  });

  it('captures CUSTOMOPTION declarations and registers default ops', () => {
    const files = new Map<string, Uint8Array>([
      [
        'skin/main.lr2skin',
        lines(
          '#CUSTOMOPTION,PLAYSIDE,900,LEFT,RIGHT',
          '#CUSTOMOPTION,LANESIZE,910,NORMAL,WIDE,WIDE+',
          '#ENDOFHEADER',
          '#IF,900',
          '#INCLUDE,left.csv',
          '#ENDIF',
          '#IF,910',
          '#INCLUDE,normal.csv',
          '#ENDIF',
        ),
      ],
      ['skin/left.csv', imageCsv('left', 0)],
      ['skin/normal.csv', imageCsv('normal', 1)],
    ]);
    const skin = loadLr2SkinFromSourceFiles(files);
    expect(skin?.customOptions).toEqual([
      { name: 'PLAYSIDE', defaultOp: 900, numChoices: 2 },
      { name: 'LANESIZE', defaultOp: 910, numChoices: 3 },
    ]);
    expect(imagePathsOf(skin)).toEqual(['left.png', 'normal.png']);
  });

  it('expands #INCLUDE wildcards through #CUSTOMFILE substitution (LITONE4-style palette switch)', () => {
    // LITONE4's `Select/select.lr2skin` declares a customFile + a wildcard include against the same pattern:
    //
    //   #CUSTOMFILE,palette,csv/*.csv,blue,
    //   #INCLUDE,csv/*.csv,
    //
    // The customFile picks `blue` as the default value, which expands `csv/*.csv` to `csv/blue.csv`. The include
    // directive must consult the same customFile lookup so the wildcard resolves to `csv/blue.csv` rather than
    // hitting the resolver as a literal `*.csv` (which finds nothing). Without this the LITONE4 select skin's body
    // CSV is never loaded — `images` ends up empty and `barLayout.slots` stays 0, so the scene falls back to the
    // default-family chrome.
    const files = new Map<string, Uint8Array>([
      ['theme/select.lr2skin', lines('#CUSTOMFILE,palette,csv/*.csv,blue,', '#ENDOFHEADER', '#INCLUDE,csv/*.csv,')],
      ['theme/csv/blue.csv', imageCsv('blue-body')],
      ['theme/csv/pink.csv', imageCsv('pink-body')],
    ]);
    const skin = loadLr2SkinFromSourceFiles(files);
    expect(imagePathsOf(skin)).toEqual(['blue-body.png']);
  });

  it('falls back to the regular include resolver when no #CUSTOMFILE matches the include pattern', () => {
    // Sanity check that the customFile pre-check doesn't break the non-wildcard include path. Plain
    // `#INCLUDE,sibling.csv` (no wildcard, no customFile) must still resolve via `resolveLr2IncludePath`.
    const files = new Map<string, Uint8Array>([
      ['theme/main.lr2skin', lines('#ENDOFHEADER', '#INCLUDE,sibling.csv,')],
      ['theme/sibling.csv', imageCsv('sibling')],
    ]);
    expect(imagePathsOf(loadLr2SkinFromSourceFiles(files))).toEqual(['sibling.png']);
  });

  it('skips IF blocks whose ops are not all true', () => {
    const files = new Map<string, Uint8Array>([
      [
        'skin/main.lr2skin',
        lines(
          '#CUSTOMOPTION,PLAYSIDE,900,LEFT,RIGHT',
          '#CUSTOMOPTION,LANESIZE,910,NORMAL,WIDE',
          '#ENDOFHEADER',
          '#IF,900,910',
          '#INCLUDE,a.csv',
          '#ENDIF',
          '#IF,900,911',
          '#INCLUDE,b.csv',
          '#ENDIF',
          '#IF,901,910',
          '#INCLUDE,c.csv',
          '#ENDIF',
        ),
      ],
      ['skin/a.csv', imageCsv('a')],
      ['skin/b.csv', imageCsv('b')],
      ['skin/c.csv', imageCsv('c')],
    ]);
    expect(imagePathsOf(loadLr2SkinFromSourceFiles(files))).toEqual(['a.png']);
  });

  it('takes only the first matching ELSEIF branch', () => {
    const files = new Map<string, Uint8Array>([
      [
        'skin/main.lr2skin',
        lines(
          '#CUSTOMOPTION,LANESIZE,910,NORMAL,WIDE,WIDE+',
          '#ENDOFHEADER',
          '#IF,911',
          '#INCLUDE,big.csv',
          '#ELSEIF,910',
          '#INCLUDE,normal.csv',
          '#ELSE',
          '#INCLUDE,fallback.csv',
          '#ENDIF',
        ),
      ],
      ['skin/big.csv', imageCsv('big')],
      ['skin/normal.csv', imageCsv('normal')],
      ['skin/fallback.csv', imageCsv('fallback')],
    ]);
    expect(imagePathsOf(loadLr2SkinFromSourceFiles(files))).toEqual(['normal.png']);
  });

  it('takes ELSE when all preceding branches fail', () => {
    const files = new Map<string, Uint8Array>([
      [
        'skin/main.lr2skin',
        lines(
          '#CUSTOMOPTION,LANESIZE,912,NORMAL,WIDE,WIDE+',
          '#ENDOFHEADER',
          '#IF,910',
          '#INCLUDE,a.csv',
          '#ELSEIF,911',
          '#INCLUDE,b.csv',
          '#ELSE',
          '#INCLUDE,c.csv',
          '#ENDIF',
        ),
      ],
      ['skin/a.csv', imageCsv('a')],
      ['skin/b.csv', imageCsv('b')],
      ['skin/c.csv', imageCsv('c')],
    ]);
    expect(imagePathsOf(loadLr2SkinFromSourceFiles(files))).toEqual(['c.png']);
  });

  it('treats negative ops as negation', () => {
    const files = new Map<string, Uint8Array>([
      [
        'skin/main.lr2skin',
        lines(
          '#CUSTOMOPTION,PLAYSIDE,900,LEFT,RIGHT',
          '#ENDOFHEADER',
          '#IF,-901',
          '#INCLUDE,not-right.csv',
          '#ENDIF',
          '#IF,-900',
          '#INCLUDE,not-left.csv',
          '#ENDIF',
        ),
      ],
      ['skin/not-right.csv', imageCsv('nr')],
      ['skin/not-left.csv', imageCsv('nl')],
    ]);
    expect(imagePathsOf(loadLr2SkinFromSourceFiles(files))).toEqual(['nr.png']);
  });

  it('evaluates nested IFs against the parent active state', () => {
    const files = new Map<string, Uint8Array>([
      [
        'skin/main.lr2skin',
        lines(
          '#CUSTOMOPTION,PLAYSIDE,900,LEFT,RIGHT',
          '#CUSTOMOPTION,LANESIZE,910,NORMAL,WIDE',
          '#ENDOFHEADER',
          '#IF,900',
          '#IF,910',
          '#INCLUDE,left-normal.csv',
          '#ELSE',
          '#INCLUDE,left-wide.csv',
          '#ENDIF',
          '#ELSE',
          '#INCLUDE,right.csv',
          '#ENDIF',
        ),
      ],
      ['skin/left-normal.csv', imageCsv('ln')],
      ['skin/left-wide.csv', imageCsv('lw')],
      ['skin/right.csv', imageCsv('r')],
    ]);
    expect(imagePathsOf(loadLr2SkinFromSourceFiles(files))).toEqual(['ln.png']);
  });

  it('maps NOWJUDGE_1P indices per the LR2 spec (1=POOR, 2=BAD, 3=GOOD, 4=GREAT, 5=PERFECT)', () => {
    const files = new Map<string, Uint8Array>([
      [
        'skin/main.csv',
        lines(
          '#IMAGE,judge.png',
          '#SRC_NOWJUDGE_1P,1,0,0,0,200,30,2,1,120,0',
          '#DST_NOWJUDGE_1P,1,0,10,100,100,30,0,255,255,255,255',
          '#SRC_NOWJUDGE_1P,2,0,0,30,200,30,2,1,120,0',
          '#DST_NOWJUDGE_1P,2,0,10,140,100,30,0,255,255,255,255',
          '#SRC_NOWJUDGE_1P,3,0,0,60,200,30,2,1,120,0',
          '#DST_NOWJUDGE_1P,3,0,10,180,100,30,0,255,255,255,255',
          '#SRC_NOWJUDGE_1P,4,0,0,90,200,30,2,1,120,0',
          '#DST_NOWJUDGE_1P,4,0,10,220,100,30,0,255,255,255,255',
          '#SRC_NOWJUDGE_1P,5,0,0,120,200,30,2,1,120,0',
          '#DST_NOWJUDGE_1P,5,0,10,260,100,30,0,255,255,255,255',
        ),
      ],
    ]);
    const skin = loadLr2SkinFromSourceFiles(files);
    // The judge SRC keeps the FULL multi-cell rectangle (w=200, divx=2) so the renderer can pick the active animation
    // cell at runtime; cell width equals w/divx = 100 px.
    expect(skin?.judges.poor?.[0]?.source).toMatchObject({
      imagePath: 'judge.png',
      x: 0,
      y: 0,
      w: 200,
      h: 30,
      divx: 2,
      divy: 1,
    });
    expect(skin?.judges.bad?.[0]?.source).toMatchObject({ x: 0, y: 30, w: 200, h: 30, divx: 2, divy: 1 });
    expect(skin?.judges.good?.[0]?.source).toMatchObject({ x: 0, y: 60, w: 200, h: 30, divx: 2, divy: 1 });
    expect(skin?.judges.great?.[0]?.source).toMatchObject({ x: 0, y: 90, w: 200, h: 30, divx: 2, divy: 1 });
    expect(skin?.judges.perfect?.[0]?.source).toMatchObject({ x: 0, y: 120, w: 200, h: 30, divx: 2, divy: 1 });
    expect(skin?.judges.perfect?.[0]?.destination).toMatchObject({ x: 10, y: 260, w: 100, h: 30, alpha: 1 });
  });

  it('captures the full DST_NOWJUDGE_1P keyframe chain (incl. fade-out) per id', () => {
    const files = new Map<string, Uint8Array>([
      [
        'skin/main.csv',
        lines(
          '#IMAGE,judge.png',
          '#SRC_NOWJUDGE_1P,5,0,0,0,200,30,2,1,120,0',
          '#DST_NOWJUDGE_1P,5,0,10,100,100,30,0,255,255,255,255,1,0,0,0,-1,46',
          '#DST_NOWJUDGE_1P,5,1000,10,100,100,30,0,255,255,255,255',
          '#DST_NOWJUDGE_1P,5,1300,10,100,100,30,0,0,255,255,255',
        ),
      ],
    ]);
    const skin = loadLr2SkinFromSourceFiles(files);
    expect(skin?.judges.perfect).toHaveLength(1);
    // The destination is the FINAL keyframe (used for visibility checks); for the LR2 judge fade chain that's the
    // 0-alpha terminal frame.
    expect(skin?.judges.perfect?.[0]?.destination.alpha).toBe(0);
    // Full keyframe chain is captured for the renderer to interpolate.
    expect(skin?.judges.perfect?.[0]?.keyframes).toHaveLength(3);
    expect(skin?.judges.perfect?.[0]?.keyframes[0]?.alpha).toBe(1);
    expect(skin?.judges.perfect?.[0]?.keyframes[2]?.alpha).toBe(0);
  });

  it('treats NOWJUDGE_1P id 0 (early POOR) and id 1 (POOR) as the same `poor` kind', () => {
    const files = new Map<string, Uint8Array>([
      [
        'skin/main.csv',
        lines(
          '#IMAGE,judge.png',
          '#SRC_NOWJUDGE_1P,0,0,0,0,200,30,2,1,120,0',
          '#DST_NOWJUDGE_1P,0,0,10,100,100,30,0,255,255,255,255',
          '#SRC_NOWJUDGE_1P,1,0,0,30,200,30,2,1,120,0',
          '#DST_NOWJUDGE_1P,1,0,10,200,100,30,0,255,255,255,255',
        ),
      ],
    ]);
    const skin = loadLr2SkinFromSourceFiles(files);
    // The regular POOR (id=1) overwrites the early POOR (id=0) so the surviving entry is the second one.
    expect(skin?.judges.poor?.[0]?.source).toMatchObject({ y: 30 });
    expect(skin?.judges.poor?.[0]?.destination).toMatchObject({ y: 200 });
  });

  it('parses NOWCOMBO_1P with judgement-specific kinds and align values', () => {
    const files = new Map<string, Uint8Array>([
      [
        'skin/main.csv',
        lines(
          '#IMAGE,combo.png',
          // align=1 => 'left' (matching the LR2 reference video — combo digits sit immediately to the right of the
          // judgement plate; we follow NUMBER's 0=right/1=left/2=center mapping).
          '#SRC_NOWCOMBO_1P,3,0,0,0,110,12,11,1,0,0,0,1,4',
          '#DST_NOWCOMBO_1P,3,0,200,180,10,12,0,255,255,255,255',
          '#SRC_NOWCOMBO_1P,4,0,0,12,110,12,11,1,0,0,0,1,4',
          '#DST_NOWCOMBO_1P,4,0,200,180,10,12,0,255,255,255,255',
          '#SRC_NOWCOMBO_1P,5,0,0,24,110,12,11,1,0,0,0,1,4',
          '#DST_NOWCOMBO_1P,5,0,200,180,10,12,0,255,255,255,255',
        ),
      ],
    ]);
    const skin = loadLr2SkinFromSourceFiles(files);
    expect(skin?.nowCombos).toHaveLength(3);
    expect(skin?.nowCombos.map((entry) => entry.kind)).toEqual(['good', 'great', 'perfect']);
    expect(skin?.nowCombos[0]?.source.alignment).toBe('left');
    expect(skin?.nowCombos[0]?.source.padding).toBe(4);
  });

  it('parses NUMBER source/destination with num/alignment/padding', () => {
    const files = new Map<string, Uint8Array>([
      [
        'skin/main.csv',
        lines(
          '#IMAGE,font.png',
          '#SRC_NUMBER,0,0,0,0,176,12,11,1,0,0,100,0,6',
          '#DST_NUMBER,0,0,52,413,16,12,0,255,255,255,255,1,0,0,0',
        ),
      ],
    ]);
    const skin = loadLr2SkinFromSourceFiles(files);
    expect(skin?.numbers).toHaveLength(1);
    expect(skin?.numbers[0]?.source).toEqual({
      imagePath: 'font.png',
      x: 0,
      y: 0,
      w: 176,
      h: 12,
      divx: 11,
      divy: 1,
      cycle: 0,
      timer: 0,
      num: 100,
      alignment: 'right',
      padding: 6,
    });
    expect(skin?.numbers[0]?.destination).toMatchObject({ x: 52, y: 413, w: 16, h: 12, alpha: 1 });
  });

  it('takes the last DST_NUMBER as the final keyframe (alpha 0 → 255 fade-in)', () => {
    const files = new Map<string, Uint8Array>([
      [
        'skin/main.csv',
        lines(
          '#IMAGE,font.png',
          '#SRC_NUMBER,0,0,0,0,176,12,11,1,0,0,100,0,6',
          '#DST_NUMBER,0,1000,52,413,16,12,0,0,255,255,255,1,0,0,0,1200,0',
          '#DST_NUMBER,0,1200,52,413,16,12,0,255,255,255,255,1,0,0,0',
        ),
      ],
    ]);
    const skin = loadLr2SkinFromSourceFiles(files);
    expect(skin?.numbers).toHaveLength(1);
    expect(skin?.numbers[0]?.destination.alpha).toBe(1);
  });

  it('groups DST_NUMBER per preceding SRC_NUMBER (no cross-leakage between elements)', () => {
    const files = new Map<string, Uint8Array>([
      [
        'skin/main.csv',
        lines(
          '#IMAGE,font.png',
          '#SRC_NUMBER,0,0,0,0,88,5,11,1,0,0,100,0,6',
          '#DST_NUMBER,0,0,10,10,8,5,0,255,255,255,255',
          '#SRC_NUMBER,0,0,0,30,88,5,11,1,0,0,160,0,3',
          '#DST_NUMBER,0,0,10,40,8,5,0,255,255,255,255',
          '#DST_NUMBER,0,1000,10,40,8,5,0,255,255,255,255',
        ),
      ],
    ]);
    const skin = loadLr2SkinFromSourceFiles(files);
    expect(skin?.numbers).toHaveLength(2);
    expect(skin?.numbers[0]?.source.num).toBe(100);
    expect(skin?.numbers[1]?.source.num).toBe(160);
    expect(skin?.numbers[1]?.destination).toMatchObject({ x: 10, y: 40, w: 8, h: 5, alpha: 1 });
  });

  it('parses alignment values: 0=right, 1=left, 2=center', () => {
    const files = new Map<string, Uint8Array>([
      [
        'skin/main.csv',
        lines(
          '#IMAGE,font.png',
          '#SRC_NUMBER,0,0,0,0,88,5,11,1,0,0,100,0,4',
          '#DST_NUMBER,0,0,0,0,8,5,0,255,255,255,255',
          '#SRC_NUMBER,0,0,0,0,88,5,11,1,0,0,101,1,4',
          '#DST_NUMBER,0,0,0,0,8,5,0,255,255,255,255',
          '#SRC_NUMBER,0,0,0,0,88,5,11,1,0,0,102,2,4',
          '#DST_NUMBER,0,0,0,0,8,5,0,255,255,255,255',
        ),
      ],
    ]);
    const skin = loadLr2SkinFromSourceFiles(files);
    expect(skin?.numbers.map((number) => number.source.alignment)).toEqual(['right', 'left', 'center']);
  });

  it('drops NUMBER entries that have no DST_NUMBER attached', () => {
    const files = new Map<string, Uint8Array>([
      [
        'skin/main.csv',
        lines(
          '#IMAGE,font.png',
          '#SRC_NUMBER,0,0,0,0,88,5,11,1,0,0,100,0,4',
          '#SRC_NUMBER,0,0,0,30,88,5,11,1,0,0,160,0,3',
          '#DST_NUMBER,0,0,10,40,8,5,0,255,255,255,255',
        ),
      ],
    ]);
    const skin = loadLr2SkinFromSourceFiles(files);
    expect(skin?.numbers).toHaveLength(1);
    expect(skin?.numbers[0]?.source.num).toBe(160);
  });

  it('resolves CUSTOMFILE patterns by expanding * with the default name', () => {
    const tga = new Uint8Array(1);
    const files = new Map<string, Uint8Array>([
      [
        'skin/main.lr2skin',
        lines(
          '#CUSTOMFILE,BOMB,.\\LR2files\\Theme\\LR2\\Play\\bomb\\*.tga,LR2 default,',
          '#CUSTOMFILE,FRAME,.\\LR2files\\Theme\\LR2\\Play\\frame\\*.tga,LR2 default,',
          '#ENDOFHEADER',
        ),
      ],
      ['skin/Play/bomb/LR2 default.tga', tga],
      ['skin/Play/frame/LR2 default.tga', tga],
    ]);
    const skin = loadLr2SkinFromSourceFiles(files);
    expect(skin?.customFiles).toEqual([
      { name: 'BOMB', path: 'skin/Play/bomb/LR2 default.tga' },
      { name: 'FRAME', path: 'skin/Play/frame/LR2 default.tga' },
    ]);
  });

  it('drops CUSTOMFILE when no matching file is present', () => {
    const files = new Map<string, Uint8Array>([
      [
        'skin/main.lr2skin',
        lines('#CUSTOMFILE,BOMB,.\\LR2files\\Theme\\LR2\\Play\\bomb\\*.tga,Missing,', '#ENDOFHEADER'),
      ],
    ]);
    const skin = loadLr2SkinFromSourceFiles(files);
    expect(skin?.customFiles).toEqual([]);
  });

  it('expands #IMAGE wildcard paths via the matching #CUSTOMFILE default', () => {
    const tga = new Uint8Array([0]);
    const files = new Map<string, Uint8Array>([
      [
        'skin/main.lr2skin',
        lines(
          '#CUSTOMFILE,BOMB,.\\LR2files\\Theme\\LR2\\Play\\bomb\\*.tga,LR2 default,',
          '#CUSTOMFILE,FRAME,.\\LR2files\\Theme\\LR2\\Play\\frame\\*.tga,LR2 default,',
          '#ENDOFHEADER',
          '#INCLUDE,body.csv',
        ),
      ],
      [
        'skin/body.csv',
        lines(
          '#IMAGE,.\\LR2files\\Theme\\LR2\\Play\\bomb\\*.tga',
          '#IMAGE,.\\LR2files\\Theme\\LR2\\Play\\frame\\*.tga',
          '#SRC_IMAGE,0,0,0,0,100,100,1,1,0,0',
          '#DST_IMAGE,0,0,0,0,100,100,0,255,255,255,255',
          '#SRC_IMAGE,0,1,0,0,100,100,1,1,0,0',
          '#DST_IMAGE,0,0,0,0,100,100,0,255,255,255,255',
        ),
      ],
      ['skin/Play/bomb/LR2 default.tga', tga],
      ['skin/Play/frame/LR2 default.tga', tga],
    ]);
    const skin = loadLr2SkinFromSourceFiles(files);
    expect(skin?.images.map((image) => image.source.imagePath)).toEqual([
      'skin/Play/bomb/LR2 default.tga',
      'skin/Play/frame/LR2 default.tga',
    ]);
  });

  it('confines wildcard asset resolution to the same parent directory', () => {
    const tga = new Uint8Array([0]);
    const files = new Map<string, Uint8Array>([
      [
        'skin/main.csv',
        lines(
          '#IMAGE,.\\LR2files\\Theme\\LR2\\Play\\close\\*.tga',
          '#SRC_IMAGE,0,0,0,0,10,10,1,1,0,0',
          '#DST_IMAGE,0,0,0,0,10,10,0,255,255,255,255',
        ),
      ],
      ['skin/Decide/parts.tga', tga],
      ['skin/Play/close/LR2 default.tga', tga],
    ]);
    const skin = loadLr2SkinFromSourceFiles(files);
    expect(skin).toBeDefined();
    expect(skin?.images[0]?.source.imagePath).toMatch(/\*\.tga$/u);
    const bytes = resolveLr2AssetBytes(skin!, skin!.images[0]!.source.imagePath);
    expect(bytes).toBe(tga);
    // A `parts.tga` with the same basename sitting in the Decide folder must NOT be selected
    // when the wildcard scope is the close folder — the wildcard must stay folder-scoped.
    const candidatePaths = [...skin!.files.keys()];
    expect(candidatePaths).toContain('skin/Decide/parts.tga');
  });

  it('parses GROOVEGAUGE source/destination with index/addX/addY', () => {
    const files = new Map<string, Uint8Array>([
      [
        'skin/main.csv',
        lines(
          '#IMAGE,gauge.png',
          '#SRC_GROOVEGAUGE,0,0,0,0,12,8,4,1,0,0,3,0',
          '#DST_GROOVEGAUGE,0,0,40,400,3,8,0,255,255,255,255,1,0,0,0',
        ),
      ],
    ]);
    const skin = loadLr2SkinFromSourceFiles(files);
    expect(skin?.grooveGauges).toHaveLength(1);
    expect(skin?.grooveGauges[0]).toMatchObject({
      index: 0,
      addX: 3,
      addY: 0,
      source: { imagePath: 'gauge.png', x: 0, y: 0, w: 12, h: 8, divx: 4, divy: 1 },
      destination: { x: 40, y: 400, w: 3, h: 8, alpha: 1 },
    });
  });

  it('parses TRANSCOLOR (rgb) for transparency masking', () => {
    const files = new Map<string, Uint8Array>([['skin/main.csv', lines('#TRANSCOLOR,255,0,255', '#IMAGE,a.png')]]);
    const skin = loadLr2SkinFromSourceFiles(files);
    expect(skin?.transparentColor).toEqual({ r: 255, g: 0, b: 255 });
  });

  it('reproduces the LR2 official 7keys layout: 1 of 12 includes is taken', () => {
    const branches: string[] = [];
    for (const side of [900, 901]) {
      for (const sc of [905, 906]) {
        for (const size of [910, 911, 912]) {
          branches.push(`#IF,${side},${sc},${size}`, `#INCLUDE,b_${side}_${sc}_${size}.csv`, '#ENDIF');
        }
      }
    }
    const files = new Map<string, Uint8Array>([
      [
        'skin/main.lr2skin',
        lines(
          '#INFORMATION,0,LR2 STANDARD (7KEYS),cyclia,thumb.png',
          '#CUSTOMOPTION,PLAYSIDE,900,LEFT,RIGHT',
          '#CUSTOMOPTION,TURNTABLE,905,LEFT,RIGHT',
          '#CUSTOMOPTION,LANESIZE,910,NORMAL,WIDE,WIDE+',
          '#ENDOFHEADER',
          ...branches,
        ),
      ],
    ]);
    for (const side of [900, 901]) {
      for (const sc of [905, 906]) {
        for (const size of [910, 911, 912]) {
          files.set(`skin/b_${side}_${sc}_${size}.csv`, imageCsv(`b_${side}_${sc}_${size}`));
        }
      }
    }
    expect(imagePathsOf(loadLr2SkinFromSourceFiles(files))).toEqual(['b_900_905_910.png']);
  });

  it('picks the play skin for kind=play and the select skin for kind=select from a mixed bundle', () => {
    const files = new Map<string, Uint8Array>([
      [
        'LR2files/Theme/LR2/Play/play_7.lr2skin',
        lines(
          '#INFORMATION,7,LR2 PLAY,author,',
          '#IMAGE,play.png',
          '#SRC_IMAGE,0,0,0,0,10,10,1,1,0,0',
          '#DST_IMAGE,0,0,0,0,10,10,0,255,255,255,255',
        ),
      ],
      [
        'LR2files/Theme/LR2/Select/select.lr2skin',
        lines(
          '#INFORMATION,5,LR2 SELECT,author,',
          '#IMAGE,bar.png',
          '#SRC_BAR_BODY,0,0,0,0,300,40,1,1,0,0',
          '#DST_BAR_BODY_OFF,0,0,300,80,300,40,0,255,255,255,255',
          '#BAR_CENTER,0',
          '#BAR_AVAILABLE,1',
        ),
      ],
    ]);
    const playSkin = loadLr2SkinFromSourceFiles(files, { kind: 'play' });
    const selectSkin = loadLr2SkinFromSourceFiles(files, { kind: 'select' });
    expect(playSkin?.name).toBe('LR2 PLAY');
    expect(playSkin?.barLayout.slots).toHaveLength(0);
    expect(selectSkin?.name).toBe('LR2 SELECT');
    expect(selectSkin?.barLayout.slots).toHaveLength(1);
  });

  it('parses select-screen #SRC_BAR_BODY / #DST_BAR_BODY_OFF/_ON with #BAR_CENTER and #BAR_AVAILABLE', () => {
    const files = new Map<string, Uint8Array>([
      [
        'skin/select.csv',
        lines(
          '#IMAGE,bar.png',
          '#IMAGE,folder.png',
          // Two bar kinds: kind=0 (song) uses bar.png (gr=0), kind=1 (folder) uses folder.png (gr=1).
          '#SRC_BAR_BODY,0,0,0,0,300,40,1,1,0,0',
          '#SRC_BAR_BODY,1,1,0,0,300,40,1,1,0,0',
          // Slot 0 (off + on) and slot 1 (off only) -- exercises the sparse storage and verifies that on-keyframe
          // absence is tolerated. acc=0 a=255 r=g=b=255.
          '#DST_BAR_BODY_OFF,0,0,300,80,300,40,0,255,255,255,255',
          '#DST_BAR_BODY_ON,0,0,280,80,340,40,0,255,255,255,255',
          '#DST_BAR_BODY_OFF,1,0,300,124,300,40,0,255,255,255,255',
          '#BAR_CENTER,5',
          '#BAR_AVAILABLE,11',
        ),
      ],
    ]);
    const skin = loadLr2SkinFromSourceFiles(files);
    expect(skin?.barLayout.bodies).toHaveLength(2);
    expect(skin?.barLayout.bodies[0]).toMatchObject({ kind: 'song' });
    expect(skin?.barLayout.bodies[0]?.source.imagePath).toBe('bar.png');
    expect(skin?.barLayout.bodies[1]).toMatchObject({ kind: 'folder' });
    expect(skin?.barLayout.bodies[1]?.source.imagePath).toBe('folder.png');
    expect(skin?.barLayout.slots).toHaveLength(2);
    expect(skin?.barLayout.slots[0]?.off).toMatchObject({ x: 300, y: 80, w: 300, h: 40 });
    expect(skin?.barLayout.slots[0]?.on).toMatchObject({ x: 280, y: 80, w: 340, h: 40 });
    expect(skin?.barLayout.slots[1]?.off).toMatchObject({ x: 300, y: 124 });
    expect(skin?.barLayout.slots[1]?.on).toBeUndefined();
    expect(skin?.barLayout.center).toBe(5);
    expect(skin?.barLayout.available).toBe(11);
  });

  it('parses #SRC_BAR_LEVEL / _LAMP / _RANK with their per-difficulty / per-state kinds', () => {
    const files = new Map<string, Uint8Array>([
      [
        'skin/select.csv',
        lines(
          '#IMAGE,levels.png',
          '#IMAGE,lamps.png',
          '#IMAGE,ranks.png',
          // BAR_LEVEL: 3 difficulties (1=BEGINNER, 3=HYPER, 4=ANOTHER) using the same image sheet, sliced into 10 cells
          // horizontally.
          '#SRC_BAR_LEVEL,1,0,0,0,200,30,10,1,0,0,0,0,2',
          '#SRC_BAR_LEVEL,3,0,0,30,200,30,10,1,0,0,0,0,2',
          '#SRC_BAR_LEVEL,4,0,0,60,200,30,10,1,0,0,0,0,2',
          '#DST_BAR_LEVEL,0,0,260,2,20,16,0,255,255,255,255',
          // BAR_LAMP kinds 2 (EASY) and 4 (HARD)
          '#SRC_BAR_LAMP,2,1,0,0,40,16,1,1,0,0',
          '#SRC_BAR_LAMP,4,1,0,16,40,16,1,1,0,0',
          '#DST_BAR_LAMP,0,0,290,12,40,16,0,255,255,255,255',
          // BAR_RANK kinds 1 (F), 8 (AAA)
          '#SRC_BAR_RANK,1,2,0,0,32,32,1,1,0,0',
          '#SRC_BAR_RANK,8,2,32,0,32,32,1,1,0,0',
          '#DST_BAR_RANK,0,0,330,4,32,32,0,255,255,255,255',
        ),
      ],
    ]);
    const skin = loadLr2SkinFromSourceFiles(files);
    expect(skin?.barLayout.levels.map((entry) => entry.kind)).toEqual(['beginner', 'hyper', 'another']);
    expect(skin?.barLayout.levels[0]?.source.imagePath).toBe('levels.png');
    expect(skin?.barLayout.levels[0]?.source).toMatchObject({ alignment: 'right', padding: 2 });
    expect(skin?.barLayout.levelDestination).toMatchObject({ x: 260, y: 2, w: 20, h: 16 });
    expect(skin?.barLayout.lamps.map((entry) => entry.kind)).toEqual(['easy', 'hard']);
    expect(skin?.barLayout.lamps[0]?.source.imagePath).toBe('lamps.png');
    expect(skin?.barLayout.lampDestination).toMatchObject({ x: 290, y: 12, w: 40, h: 16 });
    expect(skin?.barLayout.ranks.map((entry) => entry.kind)).toEqual(['F', 'AAA']);
    expect(skin?.barLayout.ranks[0]?.source.imagePath).toBe('ranks.png');
    expect(skin?.barLayout.rankDestination).toMatchObject({ x: 330, y: 4, w: 32, h: 32 });
  });

  it('marks LR2 special-graphic gr indices (100=STAGEFILE / 101=BACKBMP / 102=BANNER) with sentinel paths', () => {
    const files = new Map<string, Uint8Array>([
      [
        'skin/select.csv',
        lines(
          '#IMAGE,plain.png',
          // gr=101 references the song's #BACKBMP at runtime. Skin must tolerate the absence of a #IMAGE,...,101
          // declaration.
          '#SRC_IMAGE,0,101,0,0,300,80,1,1,0,0',
          '#DST_IMAGE,0,0,40,30,300,80,0,255,255,255,255',
        ),
      ],
    ]);
    const skin = loadLr2SkinFromSourceFiles(files);
    expect(skin?.images).toHaveLength(1);
    expect(skin?.images[0]?.source.imagePath).toBe('__lr2_special:backbmp');
  });

  it('parses #SRC_BAR_TITLE / #DST_BAR_TITLE for the focused bar text overlay', () => {
    const files = new Map<string, Uint8Array>([
      [
        'skin/select.csv',
        lines(
          // SRC col 2 is the font index. Other slots are spec-padding.
          '#SRC_BAR_TITLE,0,3,0,0,0,0,0,0,0,0',
          '#DST_BAR_TITLE,0,0,8,4,260,24,0,255,255,255,255',
        ),
      ],
    ]);
    const skin = loadLr2SkinFromSourceFiles(files);
    expect(skin?.barLayout.title?.font).toBe(3);
    expect(skin?.barLayout.title?.destination).toMatchObject({ x: 8, y: 4, w: 260, h: 24 });
  });

  it('parses #SRC_BGA / #DST_BGA with nobase / nolayer / nopoor flags', () => {
    const files = new Map<string, Uint8Array>([
      [
        'skin/main.csv',
        lines(
          // LR2 default-style "normal" (op 30) BGA with all three layers visible.
          '#SRC_BGA,0,0,0,0,0,0,0,0,0,0,0,0,0',
          '#DST_BGA,0,0,291,56,256,256,0,255,255,255,255,0,0,0,0,0,0,30,0,0',
          // "no-layer + no-poor" alternative, gated on op 31 (large) — verifies that the column 11 / 12 / 13 flags
          // translate to the per-layer suppression booleans (column 11 = nobase = 0, 12 = nolayer = 1, 13 = nopoor =
          // 1).
          '#SRC_BGA,0,0,0,0,0,0,0,0,0,0,0,1,1',
          '#DST_BGA,0,0,230,0,392,392,0,255,255,255,255,0,1,0,0,0,0,31,0,0',
        ),
      ],
    ]);
    const skin = loadLr2SkinFromSourceFiles(files);
    expect(skin?.bgas).toHaveLength(2);
    expect(skin?.bgas[0]?.destination).toMatchObject({ x: 291, y: 56, w: 256, h: 256 });
    expect(skin?.bgas[0]).toMatchObject({ noBase: false, noLayer: false, noPoor: false });
    expect(skin?.bgas[1]?.destination).toMatchObject({ x: 230, y: 0, w: 392, h: 392 });
    expect(skin?.bgas[1]).toMatchObject({ noBase: false, noLayer: true, noPoor: true });
  });

  // -- Result-screen path filtering --------------------------------- Covers the `Lr2SkinKind === 'result'` branch in
  // `isSkinPathOfKind` / `scoreSkinPath` plus the loader fallback policy: non-play kinds must NOT silently grab a play
  // skin when no kind-specific path exists (that's how the result scene used to render blank).
  describe('result skin loader', () => {
    it('selects Result/result.lr2skin when present and de-ranks /CourseResult/', () => {
      const files = new Map<string, Uint8Array>([
        ['Theme/LR2/Result/result.lr2skin', imageCsv('result')],
        // Same filename in a sibling /CourseResult/ folder must NOT be picked when the user asks for kind: 'result' —
        // the LR2 default theme ships both and the per-song one wins.
        ['Theme/LR2/CourseResult/result.lr2skin', imageCsv('course')],
        ['Theme/LR2/Play/play_7.lr2skin', imageCsv('play')],
      ]);
      const skin = loadLr2SkinFromSourceFiles(files, { kind: 'result' });
      expect(imagePathsOf(skin)).toEqual(['result.png']);
    });

    it('returns undefined for kind: result when no Result/ skin is bundled', () => {
      const files = new Map<string, Uint8Array>([
        ['Theme/LR2/Play/play_7.lr2skin', imageCsv('play')],
        ['Theme/LR2/Select/select.lr2skin', imageCsv('select')],
      ]);
      // Earlier the loader fell through to "any .lr2skin" which would hand back play_7.lr2skin and the result scene
      // rendered blank because every play DST gates on play-only ops / timers. Asserting `undefined` here locks in the
      // "fall through to built-in fallback panel" contract.
      expect(loadLr2SkinFromSourceFiles(files, { kind: 'result' })).toBeUndefined();
    });

    it('returns undefined for kind: select when no Select/ skin is bundled', () => {
      const files = new Map<string, Uint8Array>([['Theme/LR2/Play/play_7.lr2skin', imageCsv('play')]]);
      expect(loadLr2SkinFromSourceFiles(files, { kind: 'select' })).toBeUndefined();
    });

    it('still falls back to any .lr2skin for kind: play (legacy single-skin bundle)', () => {
      // Some user bundles ship just one CSV and expect the play loader to pick it up regardless of folder layout. Keep
      // that behavior for `play` only — it's the fallback path that pre-dates select / result kind support.
      const files = new Map<string, Uint8Array>([['skin/main.lr2skin', imageCsv('main')]]);
      expect(imagePathsOf(loadLr2SkinFromSourceFiles(files, { kind: 'play' }))).toEqual(['main.png']);
    });
  });

  // -- Type-aware dispatch (LITONE4 / themes with non-canonical filenames) -----------------------------------------
  // Covers the `#INFORMATION,<type>,...` peek path: themes whose `.lr2skin` files aren't named `play_N.lr2skin` /
  // `select.lr2skin` / etc. still classify correctly when their declared type matches the requested kind. Regression
  // shield for LITONE4 support (which ships `AC7.lr2skin` for type=0).
  describe('#INFORMATION type-aware skin dispatch', () => {
    // Helper that prepends a `#INFORMATION,<type>,...` row to a regular image CSV — mimics the layout of a real
    // authored skin's entry CSV.
    const informationCsv = (type: number, imageName: string): Uint8Array =>
      lines(
        `#INFORMATION,${type},test skin,nobody,thumb.bmp,`,
        '#ENDOFHEADER',
        `#IMAGE,${imageName}.png`,
        '#SRC_IMAGE,0,0,0,0,100,100,1,1,0,0',
        '#DST_IMAGE,0,0,0,0,100,100,0,255,255,255,255',
      );

    it('picks LITONE4-style AC7.lr2skin for kind: play via the declared type', () => {
      const files = new Map<string, Uint8Array>([
        ['Theme/LITONE4/Play/AC7.lr2skin', informationCsv(0, 'ac7')],
        // Decoy: a select-type skin sitting in the same theme but irrelevant to the play request.
        ['Theme/LITONE4/Select/select.lr2skin', informationCsv(5, 'select')],
      ]);
      const skin = loadLr2SkinFromSourceFiles(files, { kind: 'play' });
      expect(imagePathsOf(skin)).toEqual(['ac7.png']);
    });

    it('picks LITONE4-style select.lr2skin for kind: select even though decide and result are also present', () => {
      const files = new Map<string, Uint8Array>([
        ['Theme/LITONE4/Play/AC7.lr2skin', informationCsv(0, 'play')],
        ['Theme/LITONE4/Decide/decide.lr2skin', informationCsv(6, 'decide')],
        ['Theme/LITONE4/Result/result.lr2skin', informationCsv(7, 'result')],
        ['Theme/LITONE4/Select/select.lr2skin', informationCsv(5, 'select')],
      ]);
      // Each kind should resolve to its declared sibling — no cross-pollination.
      expect(imagePathsOf(loadLr2SkinFromSourceFiles(files, { kind: 'select' }))).toEqual(['select.png']);
      expect(imagePathsOf(loadLr2SkinFromSourceFiles(files, { kind: 'decide' }))).toEqual(['decide.png']);
      expect(imagePathsOf(loadLr2SkinFromSourceFiles(files, { kind: 'result' }))).toEqual(['result.png']);
      expect(imagePathsOf(loadLr2SkinFromSourceFiles(files, { kind: 'play' }))).toEqual(['play.png']);
    });

    it('drops a skin whose declared type contradicts its folder name', () => {
      // Filename heuristic would put `Select/play_7.lr2skin` into the play candidate set, but the declared type
      // says it's a select skin — we trust the declared type. The pure-filename play skin should still win for the
      // play request; the misnamed file gets rejected from BOTH kinds' candidate lists.
      const files = new Map<string, Uint8Array>([
        // Misplaced: declared type 5 (select) under the Play folder.
        ['Theme/T/Play/play_7.lr2skin', informationCsv(5, 'misplaced')],
        ['Theme/T/Select/select.lr2skin', informationCsv(5, 'real-select')],
      ]);
      expect(imagePathsOf(loadLr2SkinFromSourceFiles(files, { kind: 'select' }))).toEqual(['real-select.png']);
      // Play has no valid candidate after the type filter rejects the misplaced one. The legacy single-skin fallback
      // for kind: play kicks in and grabs the misplaced file regardless of its declared type — same behaviour as
      // before this change for the "one .lr2skin in the bundle" case. Documenting that explicitly here.
      expect(imagePathsOf(loadLr2SkinFromSourceFiles(files, { kind: 'play' }))).toEqual(['misplaced.png']);
    });

    it('prefers play_<variant>.lr2skin over a type-only AC<N>.lr2skin in the same bundle', () => {
      // Bundles that ship BOTH the canonical filename and a non-canonical type-tagged file should pick the canonical
      // one — keeps the LR2 default theme's behaviour identical even when the type peek is enabled.
      const files = new Map<string, Uint8Array>([
        ['Theme/X/Play/play_7.lr2skin', informationCsv(0, 'canonical')],
        ['Theme/X/Play/AC7.lr2skin', informationCsv(0, 'ac7')],
      ]);
      expect(imagePathsOf(loadLr2SkinFromSourceFiles(files, { kind: 'play', playVariant: '7' }))).toEqual([
        'canonical.png',
      ]);
    });

    it('falls back to the filename heuristic when no #INFORMATION row is present', () => {
      // Older skins / hand-edited CSVs may omit `#INFORMATION` entirely. We fall back to the path heuristic so the
      // pre-type-aware behaviour is preserved for those.
      const files = new Map<string, Uint8Array>([
        ['Theme/X/Play/play_7.lr2skin', imageCsv('legacy-play')],
        ['Theme/X/Select/select.lr2skin', imageCsv('legacy-select')],
      ]);
      expect(imagePathsOf(loadLr2SkinFromSourceFiles(files, { kind: 'play' }))).toEqual(['legacy-play.png']);
      expect(imagePathsOf(loadLr2SkinFromSourceFiles(files, { kind: 'select' }))).toEqual(['legacy-select.png']);
    });
  });

  // -- defaultParseOps ---------------------------------------------- Op 90 (cleared) and 91 (failed) are runtime-only
  // flags but the LR2 default `Result/result_normal.csv` wraps the `#IMAGE` declarations themselves in `#IF,90` /
  // `#IF,91`. The parser has to enter BOTH branches at parse time so both atlases (parts.tga and parts_fail.tga) reach
  // the runtime — runtime DST gating then picks which is drawn on a per-frame basis.
  describe('defaultParseOps retains result-screen IF branches', () => {
    it('parses #IF,90 (cleared) and #IF,91 (failed) blocks together', () => {
      // Each #IMAGE declaration appends to the parser's `imagePaths` array; subsequent `#SRC_IMAGE,...,gr=N` indexes
      // back into it. Using gr=0 for both atlases would have the second SRC alias the first atlas — so the clear / fail
      // entries reference gr=0 and gr=1 respectively to verify both #IMAGE declarations (one per #IF branch) reached
      // the parser.
      const files = new Map<string, Uint8Array>([
        [
          'skin/main.csv',
          lines(
            '#IF,90',
            '#IMAGE,parts.png',
            '#SRC_IMAGE,0,0,0,0,100,100,1,1,0,0',
            '#DST_IMAGE,0,0,0,0,100,100,0,255,255,255,255',
            '#ENDIF',
            '#IF,91',
            '#IMAGE,parts_fail.png',
            '#SRC_IMAGE,0,1,0,0,100,100,1,1,0,0',
            '#DST_IMAGE,0,0,0,0,100,100,0,255,255,255,255',
            '#ENDIF',
          ),
        ],
      ]);
      // Both atlases should be present after parse — the runtime op gate decides which DST_IMAGE actually paints, but
      // neither can paint if its #IMAGE was filtered out at parse time.
      expect(imagePathsOf(loadLr2SkinFromSourceFiles(files))).toEqual(['parts.png', 'parts_fail.png']);
    });
  });

  // -- #SRC_GAUGECHART_* / #SRC_SCORECHART -------------------------- These directives extend the `#SRC_*` template
  // with four extra columns (field_w, field_h, start, end) that drive the polyline chart-area sizing and reveal
  // animation on the result screen. Verifying the parser captures them correctly is critical because the renderer uses
  // them directly without secondary fallbacks.
  describe('#SRC_GAUGECHART_* / #SRC_SCORECHART', () => {
    it('parses 1P green / red gauge charts with the per-spec columns', () => {
      // SRC layout: command,index,gr,x,y,w,h,divx,divy,cycle,timer, field_w,field_h,start,end DST layout:
      // command,index,time,x,y,w,h,acc,a,r,g,b,blend, filter,angle,center,loop,timer
      const files = new Map<string, Uint8Array>([
        [
          'skin/main.csv',
          lines(
            '#IMAGE,parts.png',
            // Index 0 = green gauge; 254×174 chart area, 500..2000ms reveal.
            '#SRC_GAUGECHART_1P,0,0,450,191,2,2,1,1,0,0,254,174,500,2000',
            '#DST_GAUGECHART_1P,0,0,20,206,2,2,0,255,0,255,0,0,0,0,0,0,0',
            // Index 1 = red gauge; same chart area, different tint.
            '#SRC_GAUGECHART_1P,1,0,446,191,2,2,1,1,0,0,254,174,500,2000',
            '#DST_GAUGECHART_1P,1,0,20,206,2,2,0,255,255,0,0,0,0,0,0,0,0',
          ),
        ],
      ]);
      const skin = loadLr2SkinFromSourceFiles(files);
      expect(skin?.gaugeCharts).toHaveLength(2);
      const green = skin?.gaugeCharts[0];
      expect(green?.side).toBe('1P');
      expect(green?.source).toMatchObject({
        index: 0,
        fieldWidth: 254,
        fieldHeight: 174,
        start: 500,
        end: 2000,
      });
      // DST `(x, y) = (20, 206)` is the LR2 bottom-left anchor; the tint `(0, 255, 0)` is what colors the polyline.
      // The renderer depends on both surfacing through `keyframes[0]`.
      expect(green?.destination).toMatchObject({ x: 20, y: 206, r: 0, g: 255, b: 0 });
      const red = skin?.gaugeCharts[1];
      expect(red?.source.index).toBe(1);
      expect(red?.destination).toMatchObject({ r: 255, g: 0, b: 0 });
    });

    it('pairs interleaved 1P / 2P SRC + DST entries by side', () => {
      // The spec template alternates 1P SRC, 1P DST, 2P SRC, 2P DST. The DST attaches to the most recent SRC of the
      // matching side — a naive "last SRC overall" attach would mis-pair.
      const files = new Map<string, Uint8Array>([
        [
          'skin/main.csv',
          lines(
            '#IMAGE,parts.png',
            '#SRC_GAUGECHART_1P,0,0,0,0,2,2,1,1,0,0,100,80,0,0',
            '#SRC_GAUGECHART_2P,0,0,0,0,2,2,1,1,0,0,100,80,0,0',
            '#DST_GAUGECHART_2P,0,0,300,200,2,2,0,255,0,128,255,0,0,0,0,0,0',
            '#DST_GAUGECHART_1P,0,0,20,200,2,2,0,255,255,128,0,0,0,0,0,0,0',
          ),
        ],
      ]);
      const skin = loadLr2SkinFromSourceFiles(files);
      expect(skin?.gaugeCharts).toHaveLength(2);
      const onesP = skin?.gaugeCharts.find((c) => c.side === '1P');
      const twoP = skin?.gaugeCharts.find((c) => c.side === '2P');
      // 1P DST anchors at x=20; 2P DST anchors at x=300. Wrong pairing would swap them.
      expect(onesP?.destination.x).toBe(20);
      expect(twoP?.destination.x).toBe(300);
    });

    it('parses #SRC_SCORECHART with current / best / target indices', () => {
      const files = new Map<string, Uint8Array>([
        [
          'skin/main.csv',
          lines(
            '#IMAGE,parts.png',
            // index 0 = this play, 1 = personal best, 2 = target.
            '#SRC_SCORECHART,0,0,454,191,2,2,1,1,0,0,254,180,500,2000',
            '#DST_SCORECHART,0,0,366,208,2,2,0,255,255,255,255,0,0,0,0,0,0',
            '#SRC_SCORECHART,1,0,450,191,2,2,1,1,0,0,254,180,500,2000',
            '#DST_SCORECHART,1,0,366,208,2,2,0,255,128,128,128,0,0,0,0,0,0',
            '#SRC_SCORECHART,2,0,446,191,2,2,1,1,0,0,254,180,500,2000',
            '#DST_SCORECHART,2,0,366,208,2,2,0,255,255,200,0,0,0,0,0,0,0',
          ),
        ],
      ]);
      const skin = loadLr2SkinFromSourceFiles(files);
      expect(skin?.scoreCharts).toHaveLength(3);
      expect(skin?.scoreCharts.map((c) => c.source.index)).toEqual([0, 1, 2]);
      expect(skin?.scoreCharts[0]?.source).toMatchObject({
        fieldWidth: 254,
        fieldHeight: 180,
        start: 500,
        end: 2000,
      });
    });

    it('drops chart entries whose DST is missing', () => {
      // No #DST_GAUGECHART_1P after the SRC — the entry should be pruned in `createGaugeChartElements` rather than
      // surface a half-formed `keyframes: []` element to the renderer.
      const files = new Map<string, Uint8Array>([
        ['skin/main.csv', lines('#IMAGE,parts.png', '#SRC_GAUGECHART_1P,0,0,0,0,2,2,1,1,0,0,100,80,0,0')],
      ]);
      expect(loadLr2SkinFromSourceFiles(files)?.gaugeCharts).toEqual([]);
    });
  });

  // -- resolveLr2AssetBytes case-insensitive lookup ----------------- Real LR2 themes routinely mix `parts.tga` /
  // `Parts.TGA`, and the chart side has the same problem with `#WAVxx kick.WAV`. Verify the resolver picks up a
  // case-mismatched key without the caller having to enumerate variants.
  describe('keyframe inheritance', () => {
    it('inherits op4 (turntable spin marker) from the previous keyframe when blank', () => {
      // Mirrors the LR2 default 7-keys skin's turntable-disc declaration (`Theme/LR2/Play/7keys/7_LL0.csv` line 299):
      // first keyframe sets op4=1, second omits it. Without inheritance the final keyframe would silently drop op4 back
      // to 0 and the spin code would never run.
      const files = new Map<string, Uint8Array>([
        [
          'skin/main.csv',
          lines(
            '#IMAGE,turntable.png',
            '#SRC_IMAGE,0,0,0,0,32,32,1,1,0,0,0,0,0',
            '#DST_IMAGE,0,500,30,335,32,32,2,0,255,255,255,1,1,0,0,800,0,0,0,0,1',
            '#DST_IMAGE,0,800,30,335,32,32,2,255,255,255,255,1,1,0,0,,,,,,',
          ),
        ],
      ]);
      const skin = loadLr2SkinFromSourceFiles(files);
      const image = skin?.images[0];
      expect(image?.destination.op4).toBe(1);
      // Sanity: the first keyframe still carries op4=1 too — the inheritance shouldn't reach back, just forward.
      expect(image?.keyframes[0]?.op4).toBe(1);
      expect(image?.keyframes[1]?.op4).toBe(1);
    });

    it('preserves an explicit op4=0 reset on a later keyframe', () => {
      // Inverse of the above: if a row genuinely sets op4=0 (not blank), inheritance must NOT clobber it back to a
      // previous op4=1. Defensive — no real-world skin does this, but a future one might.
      const files = new Map<string, Uint8Array>([
        [
          'skin/main.csv',
          lines(
            '#IMAGE,turntable.png',
            '#SRC_IMAGE,0,0,0,0,32,32,1,1,0,0,0,0,0',
            '#DST_IMAGE,0,0,0,0,32,32,0,255,255,255,255,1,0,0,0,0,0,0,0,0,1',
            '#DST_IMAGE,0,500,0,0,32,32,0,255,255,255,255,1,0,0,0,0,0,0,0,0,0',
          ),
        ],
      ]);
      const skin = loadLr2SkinFromSourceFiles(files);
      const image = skin?.images[0];
      expect(image?.destination.op4).toBe(0);
    });
  });

  describe('resolveLr2AssetBytes', () => {
    it('finds an asset whose key differs only by casing', () => {
      const files = new Map<string, Uint8Array>([
        ['skin/main.csv', imageCsv('parts')],
        // The skin CSV declared `#IMAGE,parts.png`; here the actual file lives at `Parts.PNG`. With case-insensitive
        // lookup the resolver still hands back the bytes.
        ['skin/Parts.PNG', new Uint8Array([0xde, 0xad, 0xbe, 0xef])],
      ]);
      const skin = loadLr2SkinFromSourceFiles(files);
      expect(skin).toBeDefined();
      const bytes = resolveLr2AssetBytes(skin!, 'parts.png');
      expect(bytes).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
    });
  });
});

describe('autoDetectCanvasFromObservedCoordinates', () => {
  // The helper is exported standalone so the data-shape coverage stays cheap to add — the integration path (a real
  // skin without `#RESOLUTION` gets its `width`/`height` upgraded by the loader) is exercised in the
  // `loadLr2SkinFromSourceFiles` block below.
  it('returns undefined when no corners were observed', () => {
    expect(autoDetectCanvasFromObservedCoordinates([])).toBeUndefined();
  });

  it('snaps to 640×480 for LR2-default-style coordinates', () => {
    // 200 entries clustered around (300, 200) — should land squarely in the 640×480 tier.
    const corners: Array<readonly [number, number]> = [];
    for (let i = 0; i < 200; i += 1) corners.push([300, 200]);
    expect(autoDetectCanvasFromObservedCoordinates(corners)).toEqual({ width: 640, height: 480 });
  });

  it('snaps to 1280×720 for HD-era coordinates', () => {
    const corners: Array<readonly [number, number]> = [];
    for (let i = 0; i < 200; i += 1) corners.push([1100, 650]);
    expect(autoDetectCanvasFromObservedCoordinates(corners)).toEqual({ width: 1280, height: 720 });
  });

  it('snaps to 1920×1080 for FHD-era coordinates (LITONE4 case)', () => {
    const corners: Array<readonly [number, number]> = [];
    for (let i = 0; i < 200; i += 1) corners.push([1800, 1000]);
    expect(autoDetectCanvasFromObservedCoordinates(corners)).toEqual({ width: 1920, height: 1080 });
  });

  it('ignores off-canvas animation outliers via the 90th-percentile cut', () => {
    // 100 on-screen entries clustered at (1800, 1000) + 5 animation outliers at (5000, 5000). The 90th-percentile
    // y lands inside the on-screen cluster (= 1000), not the outlier reach — the detector should still pick
    // 1920×1080 rather than the next-larger tier.
    const corners: Array<readonly [number, number]> = [];
    for (let i = 0; i < 100; i += 1) corners.push([1800, 1000]);
    for (let i = 0; i < 5; i += 1) corners.push([5000, 5000]);
    expect(autoDetectCanvasFromObservedCoordinates(corners)).toEqual({ width: 1920, height: 1080 });
  });

  it('keeps 640×480 for LR2-default-style 640×480 design + horizontal slide-in animations', () => {
    // Regression for the LR2 default decide-skin shape: on-screen bulk authored at 640×480, with a small number of
    // slide-in keyframes pushing `x+w` to ~800 (off-screen right). Per-axis 90th-percentile checks mis-classified
    // these as 1280×720 because the y percentile landed inside a slide-in band at y ≈ 600 — outside 640×480's
    // tolerance of 552. Joint inclusion correctly sees that the on-screen 90 % of corners fit 640×480 jointly.
    const corners: Array<readonly [number, number]> = [];
    for (let i = 0; i < 90; i += 1) corners.push([600, 400]);
    for (let i = 0; i < 10; i += 1) corners.push([800, 600]);
    expect(autoDetectCanvasFromObservedCoordinates(corners)).toEqual({ width: 640, height: 480 });
  });

  it('escalates when slide-in fraction exceeds the inclusion threshold (= bulk is genuinely off the small canvas)', () => {
    // Inverse check: when MORE than 10 % of corners land outside 640×480, the on-screen bulk isn't actually 640×480
    // — the skin is FHD-authored with a 640×480 "intro" region. Escalate to 1280×720 (which contains both clusters).
    const corners: Array<readonly [number, number]> = [];
    for (let i = 0; i < 60; i += 1) corners.push([600, 400]);
    for (let i = 0; i < 40; i += 1) corners.push([1200, 700]);
    expect(autoDetectCanvasFromObservedCoordinates(corners)).toEqual({ width: 1280, height: 720 });
  });

  it('escalates to a bigger canvas when the 90th percentile genuinely overflows the smaller tier', () => {
    // 50 entries at (700, 600) — beyond 480 even with the 15 % overshoot tolerance (480 × 1.15 = 552 ≤ 600), so
    // 640×480 isn't enough. 1280×720 contains both with room to spare.
    const corners: Array<readonly [number, number]> = [];
    for (let i = 0; i < 50; i += 1) corners.push([700, 600]);
    expect(autoDetectCanvasFromObservedCoordinates(corners)).toEqual({ width: 1280, height: 720 });
  });

  it('absorbs a slight 90th-percentile overshoot via the canvas-overshoot tolerance', () => {
    // 100 entries at (1950, 910) — `1950 > 1920` but only by 1.6 %, well within the 15 % tolerance. This is the
    // LITONE4 Select-skin shape (slide-in animations push p90 just past the canvas right edge). The detector
    // should NOT escalate to 2560×1440; the skin's design intent is 1920×1080.
    const corners: Array<readonly [number, number]> = [];
    for (let i = 0; i < 100; i += 1) corners.push([1950, 910]);
    expect(autoDetectCanvasFromObservedCoordinates(corners)).toEqual({ width: 1920, height: 1080 });
  });

  it('caps at 2560×1440 for skins whose coordinates exceed every standard tier', () => {
    // The renderer scales-to-fit at the screen layer; the cap just avoids inventing a non-standard canvas. 100
    // entries at (4000, 3000) — way beyond every preset — should land at the largest entry rather than escalate
    // indefinitely.
    const corners: Array<readonly [number, number]> = [];
    for (let i = 0; i < 100; i += 1) corners.push([4000, 3000]);
    expect(autoDetectCanvasFromObservedCoordinates(corners)).toEqual({ width: 2560, height: 1440 });
  });
});

describe('loadLr2SkinFromSourceFiles — #RESOLUTION-less canvas auto-detection', () => {
  const fhdLikeBody = (imageName: string): Uint8Array =>
    // Single `#IMAGE` with one `#DST_IMAGE` at FHD coordinates — `(x+w, y+h) = (1920, 1080)`. Authored without
    // `#RESOLUTION` to exercise the auto-detector path. LITONE4-shaped.
    new TextEncoder().encode(
      [
        '#IMAGE,' + imageName + '.png',
        '#SRC_IMAGE,0,0,0,0,100,100,1,1,0,0',
        '#DST_IMAGE,0,0,0,0,1920,1080,0,255,255,255,255',
      ].join('\n'),
    );

  it('snaps the canvas to 1920×1080 when the skin omits #RESOLUTION but uses FHD coordinates', () => {
    const files = new Map<string, Uint8Array>([['theme/play.lr2skin', fhdLikeBody('chrome')]]);
    const skin = loadLr2SkinFromSourceFiles(files);
    expect(skin?.width).toBe(1920);
    expect(skin?.height).toBe(1080);
  });

  it('respects an explicit #RESOLUTION over the auto-detected size', () => {
    // If the author DID declare `#RESOLUTION,1280,720` but a stray DST lives outside that box, we trust the
    // author's declaration (matches LR2's own behavior).
    const files = new Map<string, Uint8Array>([
      [
        'theme/play.lr2skin',
        new TextEncoder().encode(
          [
            '#RESOLUTION,1280,720',
            '#IMAGE,a.png',
            '#SRC_IMAGE,0,0,0,0,100,100,1,1,0,0',
            // DST at FHD coordinates — would auto-detect to 1920×1080 if `#RESOLUTION` was absent.
            '#DST_IMAGE,0,0,0,0,1920,1080,0,255,255,255,255',
          ].join('\n'),
        ),
      ],
    ]);
    const skin = loadLr2SkinFromSourceFiles(files);
    expect(skin?.width).toBe(1280);
    expect(skin?.height).toBe(720);
  });

  it('keeps the 640×480 fallback when the skin has no DST entries at all', () => {
    // No `#DST_*` parsed → no observed corners → auto-detector returns undefined → 640×480 default stays.
    const files = new Map<string, Uint8Array>([['theme/play.lr2skin', new TextEncoder().encode('#IMAGE,a.png\n')]]);
    const skin = loadLr2SkinFromSourceFiles(files);
    expect(skin?.width).toBe(640);
    expect(skin?.height).toBe(480);
  });
});
