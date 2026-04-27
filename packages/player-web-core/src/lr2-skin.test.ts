import { describe, expect, it } from 'vitest';
import { loadLr2SkinFromSourceFiles, resolveLr2AssetBytes } from './lr2-skin.ts';

const lines = (...rows: string[]): Uint8Array => new TextEncoder().encode(rows.join('\n'));

const imageCsv = (name: string, grIndex = 0): Uint8Array =>
  lines(
    `#IMAGE,${name}.png`,
    `#SRC_IMAGE,0,${grIndex},0,0,100,100,1,1,0,0`,
    '#DST_IMAGE,0,0,0,0,100,100,0,255,255,255,255',
  );

const imagePathsOf = (skin: ReturnType<typeof loadLr2SkinFromSourceFiles>): string[] =>
  skin?.images.map((image) => image.source.imagePath) ?? [];

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
    // The judge SRC keeps the FULL multi-cell rectangle (w=200, divx=2) so
    // the renderer can pick the active animation cell at runtime; cell width
    // equals w/divx = 100 px.
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
    // The destination is the FINAL keyframe (used for visibility checks);
    // for the LR2 judge fade chain that's the 0-alpha terminal frame.
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
    // The regular POOR (id=1) overwrites the early POOR (id=0) so the
    // surviving entry is the second one.
    expect(skin?.judges.poor?.[0]?.source).toMatchObject({ y: 30 });
    expect(skin?.judges.poor?.[0]?.destination).toMatchObject({ y: 200 });
  });

  it('parses NOWCOMBO_1P with judgement-specific kinds and align values', () => {
    const files = new Map<string, Uint8Array>([
      [
        'skin/main.csv',
        lines(
          '#IMAGE,combo.png',
          // align=1 => 'left' (matching the LR2 reference video — combo
          // digits sit immediately to the right of the judgement plate;
          // we follow NUMBER's 0=right/1=left/2=center mapping).
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
    // 同じ basename の `parts.tga` (Decide フォルダ) は close フォルダ要求では選ばれない
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
          // Two bar kinds: kind=0 (song) uses bar.png (gr=0),
          // kind=1 (folder) uses folder.png (gr=1).
          '#SRC_BAR_BODY,0,0,0,0,300,40,1,1,0,0',
          '#SRC_BAR_BODY,1,1,0,0,300,40,1,1,0,0',
          // Slot 0 (off + on) and slot 1 (off only) -- exercises the
          // sparse storage and verifies that on-keyframe absence is
          // tolerated. acc=0 a=255 r=g=b=255.
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
          // BAR_LEVEL: 3 difficulties (1=BEGINNER, 3=HYPER, 4=ANOTHER) using
          // the same image sheet, sliced into 10 cells horizontally.
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
          // gr=101 references the song's #BACKBMP at runtime. Skin must
          // tolerate the absence of a #IMAGE,...,101 declaration.
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
          // "no-layer + no-poor" alternative, gated on op 31 (large) —
          // verifies that the column 11 / 12 / 13 flags translate to the
          // per-layer suppression booleans (column 11 = nobase = 0,
          // 12 = nolayer = 1, 13 = nopoor = 1).
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
});
