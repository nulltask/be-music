import { GpuBlendModesToPixi, State, WebGLRenderer, WebGPURenderer, type BLEND_MODES, type Renderer } from 'pixi.js';
import { logger } from '../logger.ts';
import {
  BEATORAJA_BLEND_STATES,
  type BeatorajaBlendFactor,
  type BeatorajaBlendState,
  type BeatorajaCustomBlendMode,
} from '../skin/beatoraja/blend.ts';

const log = logger('beatoraja-blend-modes');

/**
 * Registers beatoraja's blend codes 4 and 9 (`BEATORAJA_BLEND_STATES`) as Pixi blend modes on `renderer`: on WebGL in
 * the state's blend table (colour and alpha factors apart, through `blendFuncSeparate`), again whenever the context is
 * restored (Pixi rebuilds the table then), and on WebGPU in the shared pipeline table.
 */
export function registerBeatorajaBlendModes(renderer: Renderer): void {
  const modes = Object.entries(BEATORAJA_BLEND_STATES) as [BeatorajaCustomBlendMode, BeatorajaBlendState][];
  if (renderer instanceof WebGLRenderer) {
    const install = () => {
      const gl = renderer.gl;
      const glFactor: Record<BeatorajaBlendFactor, number> = {
        zero: gl.ZERO,
        one: gl.ONE,
        src: gl.SRC_COLOR,
        dst: gl.DST_COLOR,
        'one-minus-dst': gl.ONE_MINUS_DST_COLOR,
        'one-minus-src-alpha': gl.ONE_MINUS_SRC_ALPHA,
      };
      const state = renderer.state as unknown as { blendModesMap: Record<string, number[]> };
      for (const [mode, { color, alpha }] of modes) {
        state.blendModesMap[mode] = [...color, ...alpha].map((factor) => glFactor[factor]);
      }
    };
    install();
    renderer.runners.contextChange.add({ contextChange: install });
  } else if (renderer instanceof WebGPURenderer) {
    for (const [mode, { color, alpha }] of modes) {
      GpuBlendModesToPixi[mode as BLEND_MODES] = {
        color: { srcFactor: color[0], dstFactor: color[1], operation: 'add' },
        alpha: { srcFactor: alpha[0], dstFactor: alpha[1], operation: 'add' },
      };
    }
    giveCustomBlendModesPipelineIds(modes.map(([mode]) => mode));
  }
}

/**
 * Pixi's WebGPU pipeline cache keys a pipeline by the state's `_blendModeId`, which its own table gives only to the
 * built-in modes and leaves 0 (normal) for any other; a custom mode would then reuse the normal pipeline and never
 * blend as registered. Gives each of `modes` an id past the built-in ones (0-10) by wrapping `State`'s `blendMode`
 * setter, once. The id must stay under 32 to fit its five bits of the key.
 */
function giveCustomBlendModesPipelineIds(modes: readonly string[]): void {
  const prototype = State.prototype as unknown as { [CUSTOM_BLEND_IDS_PATCHED]?: true };
  if (prototype[CUSTOM_BLEND_IDS_PATCHED]) return;
  const descriptor = Object.getOwnPropertyDescriptor(State.prototype, 'blendMode');
  if (descriptor?.set === undefined) {
    log.warn('Pixi State has no blendMode setter: beatoraja blend codes 4 and 9 draw as normal on WebGPU');
    return;
  }
  const ids = new Map(modes.map((mode, index) => [mode, 11 + index]));
  Object.defineProperty(State.prototype, 'blendMode', {
    ...descriptor,
    set(this: State & { _blendModeId: number }, value: BLEND_MODES) {
      descriptor.set?.call(this, value);
      const id = ids.get(value);
      if (id !== undefined) this._blendModeId = id;
    },
  });
  prototype[CUSTOM_BLEND_IDS_PATCHED] = true;
}

const CUSTOM_BLEND_IDS_PATCHED = Symbol('be-music.custom-blend-ids');
