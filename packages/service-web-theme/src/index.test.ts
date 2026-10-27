import { describe, expect, it } from 'vite-plus/test';
import { SERVICE_CSS } from './index.ts';

describe('SERVICE_CSS', () => {
  it('compiles Basecoat components and keeps dark colors on the system scheme', () => {
    expect(SERVICE_CSS).toContain('.btn{');
    expect(SERVICE_CSS).toContain('.card{');
    expect(SERVICE_CSS).toContain('@media (prefers-color-scheme:dark){:root{--background:');
    for (const token of [
      '--background:',
      '--foreground:',
      '--card-foreground:',
      '--popover:',
      '--primary-foreground:',
      '--secondary:',
      '--muted-foreground:',
      '--accent:',
      '--destructive:',
      '--border:',
      '--input:',
      '--ring:',
      '--radius:',
      '--chart-1:',
      '--sidebar:',
    ]) {
      expect(SERVICE_CSS).toContain(token);
    }
    expect(SERVICE_CSS).not.toMatch(/--(?:bg|fg|soft|line|danger|primary-fg):/u);
    expect(SERVICE_CSS).toMatch(/header nav :is\(a, ?button\)\.btn:active\{[^}]*translate:none/);
    expect(SERVICE_CSS).toContain('.btn:focus-visible');
  });
});
