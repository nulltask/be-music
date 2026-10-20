import {
  BEATORAJA_LUA_TIMER_OFF_VALUE,
  BEATORAJA_NUM,
  evaluateBeatorajaLuaNumber,
  evaluateBeatorajaLuaString,
  type BeatorajaFloatPropertyRef,
  type BeatorajaIntegerPropertyRef,
  type BeatorajaLuaRuntimeContext,
  type BeatorajaStringPropertyRef,
} from '@be-music/skin-beatoraja';
import type { BeatorajaRenderContext } from '../../../skin/beatoraja/render.ts';
import type { BeatorajaPlaySkinViewOptions } from './options.ts';

/** `main_state.judge(n)`'s number ids: PERFECT, GREAT, GOOD, BAD, POOR, combo break. */
const LUA_JUDGE_NUMBERS = [
  BEATORAJA_NUM.PERFECT,
  BEATORAJA_NUM.GREAT,
  BEATORAJA_NUM.GOOD,
  BEATORAJA_NUM.BAD,
  BEATORAJA_NUM.POOR,
  BEATORAJA_NUM.COMBOBREAK,
] as const;

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/**
 * The Lua side of a {@link BeatorajaPlaySkinView}: the `main_state` runtime context that a skin's Lua functions read
 * each frame, and the integer / string / float properties that are either a ref id or a Lua function.
 */
export class BeatorajaSkinLuaContext {
  private readonly resolveTextContent: (refOp: number) => string | undefined;
  private readonly resolveNumberValue: (refOp: number) => number | undefined;
  private readonly resolveGraphValue: (type: number) => number | undefined;
  private readonly resolveSliderValue: (type: number) => number | undefined;
  private readonly resolveGaugePercent: () => number | undefined;

  constructor(options: BeatorajaPlaySkinViewOptions) {
    this.resolveTextContent = options.resolveTextContent ?? (() => undefined);
    this.resolveNumberValue = options.resolveNumberValue ?? (() => undefined);
    this.resolveGraphValue = options.resolveGraphValue ?? (() => undefined);
    this.resolveSliderValue = options.resolveSliderValue ?? (() => undefined);
    this.resolveGaugePercent = options.resolveGaugePercent ?? (() => undefined);
  }

  /**
   * The Lua runtime context for this frame. Built once and kept: its functions read the frame through
   * {@link luaFrame}, set here each frame, instead of a fresh set of closures being made every frame. The Lua bridge
   * only reads the context while it evaluates a call (`update` does that synchronously), never later.
   */
  buildLuaRuntimeContext(context: BeatorajaRenderContext): BeatorajaLuaRuntimeContext {
    this.luaFrame = context;
    const lua = (this.luaRuntimeContext ??= this.createLuaRuntimeContext());
    // Forward host audio hooks so BooleanProperty / customEvent callbacks evaluated at draw
    // time can fire SE. The hooks are the audio service's skin sounds, owned by the scene,
    // which the beatoraja view hands in (`skinSounds`); the skin-view never owns audio state.
    lua.audioPlay = context.audioPlay;
    lua.audioLoop = context.audioLoop;
    lua.audioStop = context.audioStop;
    return lua;
  }

  private luaFrame: BeatorajaRenderContext | undefined;
  private luaRuntimeContext: Mutable<BeatorajaLuaRuntimeContext> | undefined;

  private createLuaRuntimeContext(): Mutable<BeatorajaLuaRuntimeContext> {
    const frame = (): BeatorajaRenderContext => this.luaFrame!;
    return {
      option: (id) => frame().activeOps.has(id),
      number: (id) => this.resolveNumberValue(id),
      floatNumber: (id) => this.resolveSliderValue(id) ?? this.resolveGraphValue(id),
      text: (id) => this.resolveTextContent(id),
      offset: (id) => frame().resolveOffset?.(id),
      timer: (id) => {
        const start = id === 0 ? 0 : frame().getTimerStart(id);
        return start === undefined ? BEATORAJA_LUA_TIMER_OFF_VALUE : start * 1000;
      },
      time: () => frame().nowMs * 1000,
      rate: () => this.resolveNumberValue(BEATORAJA_NUM.SCORE_RATE),
      exscore: () => this.resolveNumberValue(BEATORAJA_NUM.POINT),
      judge: (judge) => {
        const ref = LUA_JUDGE_NUMBERS[judge];
        return ref === undefined ? undefined : this.resolveNumberValue(ref);
      },
      gauge: () => {
        const percent = this.resolveGaugePercent();
        return percent;
      },
      // `main_state.gauge_type()` — beatoraja's `BEATORAJA_GAUGE_MODE.*` int constant.
      // Sourced from the play bridge's `resolveGaugeState`. Returns `undefined` when no
      // frame has landed yet; the Lua bridge defaults to 0 in that case.
      gaugeType: () => frame().resolveGaugeState?.()?.mode,
    };
  }

  resolveIntegerProperty(property: BeatorajaIntegerPropertyRef, luaContext: BeatorajaLuaRuntimeContext): number {
    if (typeof property === 'number') return this.resolveNumberValue(property) ?? 0;
    return evaluateBeatorajaLuaNumber(property, luaContext) ?? 0;
  }

  resolveStringProperty(property: BeatorajaStringPropertyRef, luaContext: BeatorajaLuaRuntimeContext): string {
    if (typeof property === 'number') return this.resolveTextContent(property) ?? '';
    return evaluateBeatorajaLuaString(property, luaContext) ?? '';
  }

  resolveFloatProperty(
    property: BeatorajaFloatPropertyRef,
    luaContext: BeatorajaLuaRuntimeContext,
    kind: 'graph' | 'slider',
  ): number | undefined {
    if (typeof property === 'number') {
      return kind === 'graph' ? this.resolveGraphValue(property) : this.resolveSliderValue(property);
    }
    return evaluateBeatorajaLuaNumber(property, luaContext);
  }
}
