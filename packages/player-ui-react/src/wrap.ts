import * as React from 'react';
import { createComponent, type ReactWebComponent, type EventName } from '@lit/react';
import { defineBeMusicElements } from '@be-music/player-ui';

const useClientLayoutEffect: typeof React.useEffect =
  typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect;

/** Render the typed element only after registration, so first properties and refs see an upgraded instance. */
export function wrap<I extends HTMLElement, E extends Record<string, string | EventName>>(
  tagName: string,
  elementClass: { new (): I },
  events: E,
): ReactWebComponent<I, E> {
  const Component = createComponent({ react: React, tagName, elementClass, events });
  // Keep the implementation bag simple; the public ReactWebComponent retains exact property/event types.
  const Render = Component as unknown as React.ComponentType<Record<string, unknown>>;
  const Wrapper = React.forwardRef<I, Record<string, unknown>>((props, ref) => {
    const [ready, setReady] = React.useState(false);
    useClientLayoutEffect(() => {
      defineBeMusicElements();
      setReady(true);
    }, []);
    if (!ready) {
      const shell: React.HTMLAttributes<HTMLElement> = {
        id: props.id as string | undefined,
        className: props.className as string | undefined,
        style: props.style as React.CSSProperties | undefined,
        suppressHydrationWarning: true,
      };
      return React.createElement(tagName, shell, props.children as React.ReactNode);
    }
    return React.createElement(Render, { ...props, ref });
  });
  Wrapper.displayName = elementClass.name;
  return Wrapper as unknown as ReactWebComponent<I, E>;
}
