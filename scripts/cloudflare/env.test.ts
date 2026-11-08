import { describe, expect, it } from 'vite-plus/test';
import { isLocalCloudflareCommand, LOCAL_D1_DATABASE_ID, resolveCloudflareEnv } from './env.ts';

describe('isLocalCloudflareCommand', () => {
  it('treats cf dev and --local runs as local', () => {
    expect(isLocalCloudflareCommand(['dev'])).toBe(true);
    expect(isLocalCloudflareCommand(['--local', '--persist-to', '.wrangler/state'])).toBe(true);
  });

  it('treats builds, deploys and remote migrations as remote', () => {
    expect(isLocalCloudflareCommand(['build', '--mode', 'preview'])).toBe(false);
    expect(isLocalCloudflareCommand(['deploy'])).toBe(false);
    expect(isLocalCloudflareCommand([])).toBe(false);
  });
});

describe('resolveCloudflareEnv', () => {
  it('returns the trimmed value from the environment', () => {
    expect(resolveCloudflareEnv('X_ID', { X_ID: ' abc \n' }, ['deploy'], undefined)).toBe('abc');
    expect(resolveCloudflareEnv('X_ID', { X_ID: 'abc' }, ['dev'], LOCAL_D1_DATABASE_ID)).toBe('abc');
  });

  it('falls back to the local value only for local commands', () => {
    expect(resolveCloudflareEnv('X_ID', {}, ['dev'], LOCAL_D1_DATABASE_ID)).toBe(LOCAL_D1_DATABASE_ID);
    expect(resolveCloudflareEnv('X_ID', { X_ID: '' }, ['--local'], undefined)).toBeUndefined();
  });

  it('fails a remote command without the value', () => {
    expect(() => resolveCloudflareEnv('X_ID', {}, ['build', '--mode', 'preview'], undefined)).toThrow(
      'X_ID is not set',
    );
    expect(() => resolveCloudflareEnv('X_ID', { X_ID: '  ' }, [], LOCAL_D1_DATABASE_ID)).toThrow('X_ID is not set');
  });
});
