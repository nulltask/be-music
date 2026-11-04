import { BlendModeFilter, type Graphics } from 'pixi.js';
import { SYN_GLASS } from './style.ts';

const surfaces = new WeakMap<Graphics, Graphics>();

/** One backdrop capture per panel batch; foreground frames and text stay outside the filter. */
export function bindGlassSurface(foreground: Graphics, surface: Graphics): void {
  surfaces.set(foreground, surface);
  if (surface.filters?.length) return;
  const filter = new BlendModeFilter({
    gl: {
      functions: `
        uniform highp vec4 uInputSize;
        uniform vec4 uInputClamp;
        vec4 glassSample(vec2 uv) {
          return texture(uBackTexture, clamp(uv, uInputClamp.xy, uInputClamp.zw));
        }
      `,
      main: `
        vec2 d = uInputSize.zw * 4.0;
        vec4 blurred = back * 0.25;
        blurred += (glassSample(vTextureCoord + vec2(d.x, 0.0)) + glassSample(vTextureCoord - vec2(d.x, 0.0))
          + glassSample(vTextureCoord + vec2(0.0, d.y)) + glassSample(vTextureCoord - vec2(0.0, d.y))) * 0.125;
        blurred += (glassSample(vTextureCoord + d) + glassSample(vTextureCoord - d)
          + glassSample(vTextureCoord + vec2(d.x, -d.y)) + glassSample(vTextureCoord + vec2(-d.x, d.y))) * 0.0625;
        float coverage = clamp(front.a / 0.68, 0.0, 1.0);
        finalColor = vec4(front.rgb + mix(back.rgb, blurred.rgb, coverage) * (1.0 - front.a), blendedAlpha);
      `,
    },
    gpu: {
      functions: `
        fn glassSample(uv: vec2<f32>) -> vec4<f32> {
          return textureSample(uBackTexture, uSampler, clamp(uv, gfu.uInputClamp.xy, gfu.uInputClamp.zw));
        }
      `,
      main: `
        let d = gfu.uInputSize.zw * 4.0;
        var blurred = back * 0.25;
        blurred += (glassSample(uv + vec2<f32>(d.x, 0.0)) + glassSample(uv - vec2<f32>(d.x, 0.0))
          + glassSample(uv + vec2<f32>(0.0, d.y)) + glassSample(uv - vec2<f32>(0.0, d.y))) * 0.125;
        blurred += (glassSample(uv + d) + glassSample(uv - d)
          + glassSample(uv + vec2<f32>(d.x, -d.y)) + glassSample(uv + vec2<f32>(-d.x, d.y))) * 0.0625;
        let coverage = clamp(front.a / 0.68, 0.0, 1.0);
        out = vec4<f32>(front.rgb + mix(back.rgb, blurred.rgb, coverage) * (1.0 - front.a), blendedAlpha);
      `,
    },
  });
  // Match the captured backdrop density; a different resolution would shift its texture coordinates.
  filter.resolution = 'inherit';
  surface.filters = [filter];
  surface.once('destroyed', () => filter.destroy());
}

/** Routes only panel fills into the blurred surface, leaving every foreground detail sharp. */
export function drawGlassSurface(graphics: Graphics, x: number, y: number, w: number, h: number, opacity = 0.96): void {
  const surface = surfaces.get(graphics);
  (surface ?? graphics).rect(x, y, w, h).fill({ color: SYN_GLASS, alpha: surface ? opacity * 0.72 : opacity });
}
