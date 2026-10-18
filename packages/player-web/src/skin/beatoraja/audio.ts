// The sounds a beatoraja skin's Lua plays with `main_state.audio_play / audio_loop / audio_stop`.
//
// ModernChic is the heavy user: `Root/customsound.lua` calls `audio_play(skin_config.get_path(
// "Root/sounds/click.ogg"))` from every panel toggle, song change and confirm. The audio service
// plays them (`createAudioService().skinSounds`, from `@be-music/player-web/runtime`), reading the
// path from the theme's files.

/**
 * Compact bag of audio callbacks scenes pass into their `BeatorajaRenderContext` so Lua
 * `main_state.audio_*` calls fired from BooleanProperty / customEvent closures at draw time
 * route to the host's audio backend. Mirrors the per-method shape of
 * `BeatorajaLuaRuntimeContext.audioPlay / audioLoop / audioStop`. The audio service's `skinSounds`
 * implements it, and `skinSounds.owned(owner)` makes the same calls with an owner.
 */
export interface BeatorajaSkinAudio {
  play: (path: string, vol: number) => boolean;
  loop: (path: string, vol: number) => boolean;
  stop: (path: string) => boolean;
}
