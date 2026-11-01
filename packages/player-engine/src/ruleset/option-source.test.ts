import { describe, expect, test } from 'vite-plus/test';
import {
  isKnownOptionSource,
  isQualifiedOptionName,
  migrateOptionValue,
  optionValueName,
  qualifyOptionValue,
  resolveOptionSource,
  splitOptionSource,
} from './option-source.ts';

describe('source-qualified option values (ADR 0019)', () => {
  test('only names two sources define differently take a source', () => {
    for (const name of ['RANDOM', 'S-RANDOM', 'CONVERGE', 'BATTLE']) expect(isQualifiedOptionName(name)).toBe(true);
    for (const name of ['MIRROR', 'H-RANDOM', 'SCATTER', 'TWO-PLAYER', 'BATTLE-AS'])
      expect(isQualifiedOptionName(name)).toBe(false);
  });

  test('splits a qualified value and keeps a bare one or an unknown prefix whole', () => {
    expect(splitOptionSource('lr2:S-RANDOM')).toEqual({ source: 'lr2', name: 'S-RANDOM' });
    expect(splitOptionSource('____:BATTLE')).toEqual({ source: '____', name: 'BATTLE' });
    expect(splitOptionSource('S-RANDOM')).toEqual({ source: undefined, name: 'S-RANDOM' });
    expect(splitOptionSource('pms:RANDOM')).toEqual({ source: undefined, name: 'pms:RANDOM' });
    expect(optionValueName('beatoraja:CONVERGE')).toBe('CONVERGE');
    expect(optionValueName('H-RANDOM')).toBe('H-RANDOM');
  });

  test('a bare colliding value is the judge ruleset own; a qualified one keeps its source', () => {
    expect(resolveOptionSource('RANDOM', 'beatoraja')).toEqual({ source: 'beatoraja', name: 'RANDOM' });
    expect(resolveOptionSource('lr2:RANDOM', 'beatoraja')).toEqual({ source: 'lr2', name: 'RANDOM' });
    expect(resolveOptionSource('SPIRAL', 'lr2')).toEqual({ source: undefined, name: 'SPIRAL' });
  });

  test('qualifies a colliding name only for a source that defines it', () => {
    expect(qualifyOptionValue('lr2', 'S-RANDOM')).toBe('lr2:S-RANDOM');
    expect(qualifyOptionValue('____', 'CONVERGE')).toBe('CONVERGE');
    expect(qualifyOptionValue('lr2', 'BATTLE')).toBe('BATTLE');
    expect(qualifyOptionValue('beatoraja', 'H-RANDOM')).toBe('H-RANDOM');
  });

  test('migrates a stored bare value to the ruleset selected at migration time, once', () => {
    expect(migrateOptionValue('RANDOM', '____')).toBe('____:RANDOM');
    expect(migrateOptionValue('BATTLE', 'beatoraja')).toBe('beatoraja:BATTLE');
    expect(migrateOptionValue('lr2:RANDOM', 'beatoraja')).toBe('lr2:RANDOM');
    expect(migrateOptionValue('OFF', 'lr2')).toBe('OFF');
  });

  test('knows which qualified values a source defines', () => {
    expect(isKnownOptionSource('beatoraja:CONVERGE')).toBe(true);
    expect(isKnownOptionSource('____:CONVERGE')).toBe(false);
    expect(isKnownOptionSource('lr2:BATTLE')).toBe(false);
    expect(isKnownOptionSource('lr2:SPIRAL')).toBe(false);
    expect(isKnownOptionSource('SPIRAL')).toBe(true);
  });
});
