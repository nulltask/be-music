import type { BeMusicDOMFactory, BeMusicDOMScreen } from '@be-music/player-skin-sdk';

/** Native mount independent of Pixi. Detaching keeps screen state; disposing ends its listeners and resources. */
export class SkinDOMMount<Frame, Actions> {
  private element: HTMLElement | undefined;
  private screen: BeMusicDOMScreen<Frame> | undefined;
  private disposed = false;

  private readonly factory: BeMusicDOMFactory<Frame, Actions>;
  private readonly actions: Actions;
  private readonly kind: string;

  public constructor(factory: BeMusicDOMFactory<Frame, Actions>, actions: Actions, kind: string) {
    this.factory = factory;
    this.actions = actions;
    this.kind = kind;
  }

  public attach(parent: HTMLElement): void {
    if (this.disposed) throw new Error('Cannot attach a disposed DOM skin');
    if (!this.element) {
      const element = parent.ownerDocument.createElement('div');
      element.dataset.beMusicScreen = this.kind;
      Object.assign(element.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
      element.addEventListener('keydown', (event) => {
        const target = event.composedPath()[0] as HTMLElement | undefined;
        const tag = target?.tagName;
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          target?.isContentEditable ||
          ((tag === 'BUTTON' || tag === 'A') && (event.code === 'Enter' || event.code === 'Space'))
        ) {
          event.stopPropagation();
        }
      });
      this.element = element;
      try {
        this.screen = this.factory(element, this.actions);
      } catch (error) {
        this.element = undefined;
        throw error;
      }
    }
    parent.append(this.element);
  }

  public update(frame: Frame): void {
    if (this.element?.isConnected && !this.disposed) this.screen?.update(frame);
  }

  public get hasSearchInput(): boolean {
    return this.screen?.focusSearch !== undefined;
  }

  public focusSearch(): boolean {
    if (!this.element?.isConnected || !this.screen?.focusSearch) return false;
    this.screen.focusSearch();
    return true;
  }

  public detach(): void {
    this.element?.remove();
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.detach();
    this.screen?.dispose();
    this.screen = undefined;
    this.element = undefined;
  }
}
