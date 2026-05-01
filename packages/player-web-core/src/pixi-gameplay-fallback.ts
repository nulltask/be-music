import { Container, Graphics } from 'pixi.js';
import { BGA, BG, DESIGN_HEIGHT, DESIGN_WIDTH, GROOVE, PLAYFIELD, WHITE, YELLOW } from './pixi-gameplay-constants.ts';

export function renderFallbackLr2Frame(layer: Container): void {
  const frame = new Graphics();
  frame.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill(BG);

  frame.rect(20, 0, 268, 128).fill(0x2b2d30);
  frame.rect(34, 0, 70, 122).fill(0x494b4d);
  frame.rect(116, 0, 90, 122).fill(0x3a3c3f);
  frame.rect(214, 0, 62, 122).fill(0x444649);
  frame.rect(22, 124, 266, 4).fill(WHITE);

  frame.rect(PLAYFIELD.x, PLAYFIELD.y, PLAYFIELD.w, PLAYFIELD.judgementY - PLAYFIELD.y).fill(0x080a0e);
  for (let x = PLAYFIELD.x; x <= PLAYFIELD.x + PLAYFIELD.w; x += PLAYFIELD.w / 8) {
    frame.rect(x, PLAYFIELD.y, 1, PLAYFIELD.judgementY - PLAYFIELD.y).fill({ color: 0x9da6b5, alpha: 0.35 });
  }

  frame.rect(BGA.x, BGA.y, BGA.w, BGA.h).fill(0x031008);
  frame
    .poly([BGA.x + 22, BGA.y, BGA.x + BGA.w, BGA.y, BGA.x + 76, BGA.y + BGA.h, BGA.x, BGA.y + BGA.h])
    .fill({ color: 0x0b4e1f, alpha: 0.55 });
  frame.rect(BGA.x, BGA.y, 1, BGA.h).fill(YELLOW);

  frame.rect(GROOVE.x, GROOVE.y, GROOVE.w, GROOVE.h).stroke({ color: 0xffffff, width: 1, alpha: 0.85 });
  frame.rect(GROOVE.x + 40, GROOVE.y, 40, GROOVE.h).fill({ color: 0x72d677, alpha: 0.28 });
  frame.rect(GROOVE.x, GROOVE.y + GROOVE.h - 42, 38, 22).fill(0x1167ff);
  frame.rect(GROOVE.x + 38, GROOVE.y + GROOVE.h - 42, 40, 22).fill(0x17c447);
  frame.rect(GROOVE.x + 78, GROOVE.y + GROOVE.h - 42, 38, 22).fill(0xef2020);
  for (let y = GROOVE.y + 28; y < GROOVE.y + GROOVE.h - 48; y += 29) {
    frame.rect(GROOVE.x, y, GROOVE.w, 1).fill({ color: 0xffffff, alpha: 0.8 });
  }

  frame.roundRect(24, 324, 42, 52, 4).fill(0x31363b).stroke({ color: 0xadb5bd, width: 2 });
  frame.circle(45, 350, 13).stroke({ color: 0x9bd6ff, width: 3 });
  for (let index = 0; index < 7; index += 1) {
    const x = 84 + index * 29;
    frame
      .rect(x, 330, 20, 40)
      .fill(index % 2 ? 0x1d2128 : 0xf2f4f7)
      .stroke({ color: 0x101318, width: 2 });
  }
  frame.rect(40, 386, 210, 18).fill(0x111418).stroke({ color: 0x9da6b5, width: 2 });
  frame.rect(45, 389, 200, 12).fill(0xf01924);
  frame.rect(272, 382, 52, 20).fill(0x0e52a8).stroke({ color: 0x9da6b5, width: 2 });
  frame.rect(16, 408, 608, 62).fill(0x262a2e).stroke({ color: 0x9da6b5, width: 1 });
  frame.rect(338, 430, 198, 12).fill(0x4b4f55);
  frame.rect(546, 392, 50, 56).fill(0x1d343c).stroke({ color: 0x9bd6ff, width: 2 });

  layer.addChild(frame);
}
