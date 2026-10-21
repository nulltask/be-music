/** Renderer-independent entry: no Pixi initialization, DOM mounts or automatic keyboard listeners. */
import { SceneController } from '../session/controller.ts';
import { SelectSession, type SelectSessionOptions } from '../session/select/select-session.ts';
import type { SelectFrame, SelectIntent } from '../view/types.ts';

export { SceneController, type SceneStore } from '../session/controller.ts';
export type { SceneSession, SessionKeyEvent } from '../session/contracts.ts';
export type { SelectSessionOptions } from '../session/select/select-session.ts';
export type { SelectFrame, SelectIntent } from '../view/types.ts';

/** A standalone collection browser, including previews, using the same session as the Canvas and DOM skins. */
export function createSelectController(options: SelectSessionOptions): SceneController<SelectFrame, SelectIntent> {
  return new SceneController(new SelectSession(options));
}
