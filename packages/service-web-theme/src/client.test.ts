import { collectResultSync } from '@lit-labs/ssr/lib/render-result.js';
import { expect, test, vi } from 'vite-plus/test';
import { html } from 'lit';
import { render } from '@lit-labs/ssr';
import { BeMusicStatusElement, defineServiceUI } from './client.ts';

test('registration is explicit, idempotent, and refuses a different implementation', () => {
  const elements = new Map<string, CustomElementConstructor>();
  const define = vi.fn((name: string, constructor: CustomElementConstructor) => elements.set(name, constructor));
  const registry = { get: (name: string) => elements.get(name), define } as unknown as CustomElementRegistry;
  expect(elements.size).toBe(0);
  defineServiceUI(registry);
  defineServiceUI(registry);
  expect(define).toHaveBeenCalledExactlyOnceWith('be-music-status', BeMusicStatusElement);
  elements.set('be-music-status', class {} as CustomElementConstructor);
  expect(() => defineServiceUI(registry)).toThrow('Conflicting be-music-status');
});

test('a server notice remains fallback content and client messages are escaped', () => {
  defineServiceUI();
  const fallback = collectResultSync(render(html`<be-music-status>Server notice</be-music-status>`));
  expect(fallback).toContain('<slot>');
  expect(fallback).toContain('Server notice');
  const message = collectResultSync(
    render(html`<be-music-status .message=${'<img src=x>'}>Server notice</be-music-status>`),
  );
  expect(message).toContain('&lt;img src=x&gt;');
  expect(message).not.toContain('<img src=x>');
});
