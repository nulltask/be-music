import { describe, expect, it } from 'vite-plus/test';
import { loadLR2SkinFromSourceFiles } from './skin.ts';

function loadSkin(directive: string, width = 1920, height = 1080) {
  return loadLR2SkinFromSourceFiles(
    new Map([
      [
        'theme/play.lr2skin',
        new TextEncoder().encode(
          [
            '#INFORMATION,0,Resolution fixture,Be-Music',
            directive,
            '#IMAGE,chrome.png',
            '#SRC_IMAGE,0,0,0,0,100,100,1,1,0,0',
            `#DST_IMAGE,0,0,120,240,${width - 120},${height - 240},0,255,255,255,255`,
          ].join('\n'),
        ),
      ],
    ]),
  );
}

describe('LR2 CSV resolution declarations', () => {
  it.each([
    [0, 640, 480],
    [1, 1280, 720],
    [2, 1920, 1080],
    [3, 3840, 2160],
  ])('maps index %i to %i × %i and keeps authored coordinates', (index, width, height) => {
    // The deliberate FHD rectangle must not override an explicit smaller resolution.
    const skin = loadSkin(`#RESOLUTION,${index}`);
    expect(skin).toMatchObject({ width, height });
    expect(skin?.images[0]?.destination).toMatchObject({ x: 120, y: 240, w: 1800, h: 840 });
  });

  it.each(['#RESOLUTION,1,', '#RESOLUTION, 1 , '])('accepts an empty trailing height: %s', (directive) => {
    expect(loadSkin(directive)).toMatchObject({ width: 1280, height: 720 });
  });

  it('retains explicit width,height as an extension', () => {
    expect(loadSkin('#RESOLUTION,1600,900')).toMatchObject({ width: 1600, height: 900 });
  });

  it.each([
    '',
    '#RESOLUTION',
    '#RESOLUTION,',
    '#RESOLUTION, ',
    '#RESOLUTION,-1',
    '#RESOLUTION,4',
    '#RESOLUTION,1.5',
    '#RESOLUTION,nope',
    '#RESOLUTION,Infinity',
    '#RESOLUTION,1280',
    '#RESOLUTION,1280,0',
    '#RESOLUTION,0,720',
    '#RESOLUTION,1280,-1',
    '#RESOLUTION,1280,NaN',
  ])('keeps coordinate detection after a missing or invalid declaration: %s', (directive) => {
    expect(loadSkin(directive)).toMatchObject({ width: 1920, height: 1080 });
  });

  it('keeps the classic 640 × 480 canvas when neither declaration nor coordinates require HD', () => {
    expect(loadSkin('', 640, 480)).toMatchObject({ width: 640, height: 480 });
  });

  it('does not erase an earlier valid declaration after an invalid one', () => {
    expect(loadSkin('#RESOLUTION,1\n#RESOLUTION,-1')).toMatchObject({ width: 1280, height: 720 });
  });
});
