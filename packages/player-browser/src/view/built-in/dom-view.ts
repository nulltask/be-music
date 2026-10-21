import {
  resolveBeMusicSkinSettings,
  type BeMusicDOMPresentation,
  type BeMusicDOMFactory,
  type BeMusicDOMSelectFrame,
  type BeMusicDOMSelectActions,
  type BeMusicDOMResultFrame,
  type BeMusicDOMResultActions,
  type BeMusicDOMDecideFrame,
  type BeMusicDOMDecideActions,
} from '@be-music/player-skin-sdk';
import { PLAY_OPTION_CHOICES } from '@be-music/player-scene-model';
import { Container } from 'pixi.js';
import type { BuiltInKit } from '../../host/family-kit.ts';
import type { PixiSceneHost } from '../../host/scene-host.ts';
import { SkinDOMMount } from '../../skin/be-music/dom-mount.ts';
import type {
  FamilyView,
  IntentSink,
  SelectFrame,
  SelectIntent,
  SelectView,
  ResultFrame,
  ResultIntent,
  ResultView,
  DecideFrame,
  DecideIntent,
  DecideView,
} from '../types.ts';
import { BUILT_IN_RESULT_TIMING } from './result-view.ts';
import { resolveBuiltInDecideTiming } from './decide-view.ts';

/** Compatibility adapter for the existing Pixi host. DOM mounts themselves have no Pixi dependency. */
abstract class DOMFamilyView<Frame, Intent, DOMFrame, Actions> implements FamilyView<Frame, Intent> {
  public readonly family = 'built-in' as const;
  public readonly root = new Container();
  protected presentation: BeMusicDOMPresentation;
  private readonly skin: BuiltInKit['skin'];
  protected emit: IntentSink<Intent> = () => {};
  private host: PixiSceneHost | undefined;
  protected readonly mount: SkinDOMMount<DOMFrame, Actions>;

  public constructor(kit: BuiltInKit, factory: BeMusicDOMFactory<DOMFrame, Actions>, actions: Actions, kind: string) {
    this.skin = kit.skin;
    this.presentation = {
      settings: resolveBeMusicSkinSettings(kit.skin, kit.settings),
      effects: kit.effects ?? 'full',
    };
    this.mount = new SkinDOMMount(factory, actions, kind);
  }

  public attach(host: PixiSceneHost, emit: IntentSink<Intent>): void {
    this.emit = emit;
    this.host = host;
    this.mount.attach(host.domRoot);
  }

  public detach(): void {
    this.emit = () => {};
    this.host = undefined;
    this.mount.detach();
  }

  public dispose(): void {
    this.detach();
    this.mount.dispose();
    if (!this.root.destroyed) this.root.destroy();
  }

  public updateKit(kit: BuiltInKit): void {
    if (kit.skin === this.skin)
      this.presentation = {
        settings: resolveBeMusicSkinSettings(kit.skin, kit.settings),
        effects: kit.effects ?? 'full',
      };
  }
  /** Native screens follow CSS viewport orientation, including while their data snapshot is unchanged. */
  protected syncOrientation(): void {
    const screen = this.host?.app.screen;
    if (screen) this.host?.setStageOrientation(screen.height > screen.width ? 'portrait' : 'landscape');
  }

  public abstract draw(frame: Frame): void;
}

export class DOMSelectView
  extends DOMFamilyView<SelectFrame, SelectIntent, BeMusicDOMSelectFrame, BeMusicDOMSelectActions>
  implements SelectView
{
  public readonly launchOutroMs = 0;
  public get ownsSearchInput(): boolean {
    return this.mount.hasSearchInput;
  }
  public focusSearch(): boolean {
    return this.mount.focusSearch();
  }
  private revision = -1;
  private launching = false;

  public constructor(kit: BuiltInKit) {
    // Event handlers resolve emit at invocation time, after attach; the skin never receives a session object.
    let send: IntentSink<SelectIntent> = () => {};
    super(
      kit,
      kit.skin.dom!.select!,
      {
        focus: (index) => send({ type: 'browse', command: { type: 'jump', index } }),
        activate: () => send({ type: 'activate' }),
        back: () => send({ type: 'browse', command: { type: 'close' } }),
        search: (text) => send({ type: 'browse', command: { type: 'search', text } }),
        play: (autoPlay) => send({ type: 'start', autoPlay }),
        setPlayOption: (key, value) => send({ type: 'set-play-option', key, value }),
        readText: () => send({ type: 'readtext' }),
        gesture: () => send({ type: 'gesture' }),
      },
      'select',
    );
    send = (intent) => this.emit(intent);
  }

  public override attach(host: PixiSceneHost, emit: IntentSink<SelectIntent>): void {
    this.revision = -1;
    super.attach(host, emit);
  }

  public override updateKit(kit: BuiltInKit): void {
    super.updateKit(kit);
    this.revision = -1;
  }

  public searchFieldRect(): undefined {
    return undefined;
  }

  public draw(frame: SelectFrame): void {
    this.syncOrientation();
    const launching = frame.startedAtMs !== undefined;
    if (frame.revision === this.revision && this.launching === launching) return;
    this.revision = frame.revision;
    this.launching = launching;
    this.mount.update({
      ...this.presentation,
      revision: frame.revision,
      entries: frame.entries,
      selectedIndex: frame.cursor,
      folderLabel: frame.browse.path.at(-1)?.label,
      searchQuery: frame.browse.searchText,
      playOptions: frame.playOptions,
      playOptionChoices: PLAY_OPTION_CHOICES,
      readText: frame.readText?.text,
      launching,
    });
  }
}

export class DOMResultView
  extends DOMFamilyView<ResultFrame, ResultIntent, BeMusicDOMResultFrame, BeMusicDOMResultActions>
  implements ResultView
{
  public readonly timing = BUILT_IN_RESULT_TIMING;

  public constructor(kit: BuiltInKit) {
    let send: IntentSink<ResultIntent> = () => {};
    super(
      kit,
      kit.skin.dom!.result!,
      {
        continue: () => send({ type: 'continue' }),
        retry: () => send({ type: 'retry' }),
      },
      'result',
    );
    send = (intent) => this.emit(intent);
  }

  public draw(frame: ResultFrame): void {
    this.syncOrientation();
    this.mount.update({
      ...this.presentation,
      result: frame.result,
      inputReady: frame.clock.nowMs >= frame.inputOpenAtMs,
    });
  }
}

export class DOMDecideView
  extends DOMFamilyView<DecideFrame, DecideIntent, BeMusicDOMDecideFrame, BeMusicDOMDecideActions>
  implements DecideView
{
  public readonly timing;

  public constructor(kit: BuiltInKit) {
    let send: IntentSink<DecideIntent> = () => {};
    super(
      kit,
      kit.skin.dom!.decide!,
      {
        continue: () => send({ type: 'continue' }),
        cancel: () => send({ type: 'cancel' }),
      },
      'decide',
    );
    send = (intent) => this.emit(intent);
    this.timing = resolveBuiltInDecideTiming(kit);
  }

  public draw(frame: DecideFrame): void {
    this.syncOrientation();
    this.mount.update({
      ...this.presentation,
      chart: frame.chart,
      progress: frame.progress,
      inputReady: frame.clock.nowMs >= frame.inputOpenAtMs,
    });
  }
}
