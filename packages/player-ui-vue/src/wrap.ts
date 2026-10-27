import {
  defineComponent,
  h,
  onBeforeMount,
  shallowRef,
  type ComponentObjectPropsOptions,
  type DefineComponent,
} from 'vue';
import { defineBeMusicElements, type BeMusicUIEventMap } from '@be-music/player-ui';

type Pascal<S extends string> = S extends `${infer A}-${infer B}` ? `${Capitalize<A>}${Pascal<B>}` : Capitalize<S>;
export type BeMusicVueEventHandlers<K extends keyof BeMusicUIEventMap> = {
  [P in K as `on${Pascal<P>}`]?: (detail: BeMusicUIEventMap[P]) => void;
};
export interface BeMusicVueElementRef {
  readonly element: HTMLElement | undefined;
  focusSearch(): void;
}
export function wrap<Props extends object, K extends keyof BeMusicUIEventMap>(
  name: string,
  tag: string,
  properties: readonly (keyof Props & string)[],
  events: readonly K[],
): DefineComponent<Props & BeMusicVueEventHandlers<K>, BeMusicVueElementRef> {
  const Component = defineComponent({
    name,
    inheritAttrs: false,
    props: Object.fromEntries(
      properties.map((key) => [
        key,
        ['compact', 'disabled', 'launching'].includes(key)
          ? { type: Boolean, default: undefined }
          : key === 'selectedIndex'
            ? { type: Number, default: undefined }
            : null,
      ]),
    ) as ComponentObjectPropsOptions<Props>,
    emits: [...events],
    setup(props, { attrs, emit, expose, slots }) {
      const element = shallowRef<HTMLElement & { focusSearch?: () => void }>();
      onBeforeMount(() => defineBeMusicElements());
      expose({ element, focusSearch: () => element.value?.focusSearch?.() });
      const listeners = Object.fromEntries(
        events.map((event) => [
          `on${event[0]!.toUpperCase()}${event.slice(1)}`,
          (value: CustomEvent<BeMusicUIEventMap[K]>) => emit(event, value.detail),
        ]),
      );
      return () => {
        // The . prefix sends objects as DOM properties, including before an element upgrades.
        const values = props as unknown as Props;
        const fields =
          typeof document === 'undefined' ? {} : Object.fromEntries(properties.map((key) => [`.${key}`, values[key]]));
        return h(tag, { ...attrs, ...fields, ...listeners, ref: element }, slots.default?.());
      };
    },
  });
  return Component as unknown as DefineComponent<Props & BeMusicVueEventHandlers<K>, BeMusicVueElementRef>;
}
