import { AsyncDirective } from 'lit/async-directive.js';
import { directive, type Part } from 'lit/directive.js';
import { onPlayerLangChange, playerText } from '../player-copy.ts';

type Shell = ReturnType<typeof playerText>['shell'];
type TextKey = { [K in keyof Shell]: Shell[K] extends string ? K : never }[keyof Shell];
type LocalizedValue = TextKey | (() => unknown);

/** Each binding owns its text/attribute; no selector pass rewrites Lit's child markers. */
class LocalizedDirective extends AsyncDirective {
  private value: LocalizedValue | undefined;
  private unsubscribe: (() => void) | undefined;

  override render(value: LocalizedValue): unknown {
    this.value = value;
    return typeof value === 'function' ? value() : playerText().shell[value];
  }

  override update(_part: Part, [value]: [LocalizedValue]): unknown {
    if (this.isConnected && this.unsubscribe === undefined) this.subscribe();
    return this.render(value);
  }

  protected override disconnected(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  protected override reconnected(): void {
    this.subscribe();
    if (this.value !== undefined) this.setValue(this.render(this.value));
  }

  private subscribe(): void {
    this.unsubscribe = onPlayerLangChange(() => {
      if (this.value !== undefined) this.setValue(this.render(this.value));
    });
  }
}

export const localized = directive(LocalizedDirective);
