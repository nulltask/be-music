import type { BeMusicDOMFactory, BeMusicDOMScreen } from '@be-music/player-skin-sdk';

/** Native mount independent of Pixi. Detaching keeps screen state; disposing ends its listeners and resources. */
export class SkinDOMMount<Frame, Actions, Screen extends BeMusicDOMScreen<Frame> = BeMusicDOMScreen<Frame>> {
  private element: HTMLElement | undefined;
  private screen: Screen | undefined;
  private disposed = false;
  private opacity = 1;

  private readonly factory: BeMusicDOMFactory<Frame, Actions, Screen>;
  private readonly actions: Actions;
  private readonly kind: string;

  public constructor(factory: BeMusicDOMFactory<Frame, Actions, Screen>, actions: Actions, kind: string) {
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
          ((tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY') && (event.code === 'Enter' || event.code === 'Space'))
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

  /** The mounted screen while it is in the document, for screen-specific calls beyond {@link update}. */
  public get connectedScreen(): Screen | undefined {
    return this.element?.isConnected && !this.disposed ? this.screen : undefined;
  }

  /** Fades the whole mount with the Canvas scene it sits on (0 to 1). */
  public setOpacity(opacity: number): void {
    if (!this.element || opacity === this.opacity) return;
    this.opacity = opacity;
    this.element.style.opacity = opacity >= 1 ? '' : String(opacity);
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
