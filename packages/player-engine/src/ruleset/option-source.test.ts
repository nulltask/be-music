import { describe, expect, test } from 'vite-plus/test';
import {
  canonicalOptionValue,
  isKnownOptionSource,
  optionValueSources,
  isQualifiedOptionName,
  migrateOptionValue,
  optionValueName,
  qualifyOptionValue,
  resolveOptionSource,
  splitOptionSource,
} from './option-source.ts';

describe('source-qualified option values (ADR 0019)', () => {
  test('only names two sources define differently take a source', () => {
    for (const name of ['S-RANDOM', 'CONVERGE', 'BATTLE']) expect(isQualifiedOptionName(name)).toBe(true);
    for (const name of ['RANDOM', 'MIRROR', 'H-RANDOM', 'SCATTER', 'TWO-PLAYER', 'BATTLE-AS'])
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
    expect(resolveOptionSource('S-RANDOM', 'beatoraja')).toEqual({ source: 'beatoraja', name: 'S-RANDOM' });
    expect(resolveOptionSource('lr2:S-RANDOM', 'beatoraja')).toEqual({ source: 'lr2', name: 'S-RANDOM' });
    expect(resolveOptionSource('SPIRAL', 'lr2')).toEqual({ source: undefined, name: 'SPIRAL' });
  });

  test('RANDOM is one option for every source, and AC shares LR2 S-RANDOM', () => {
    for (const value of ['RANDOM', 'lr2:RANDOM', 'beatoraja:RANDOM', '____:RANDOM'])
      expect(resolveOptionSource(value, 'beatoraja')).toEqual({ source: undefined, name: 'RANDOM' });
    expect(resolveOptionSource('S-RANDOM', '____')).toEqual({ source: 'lr2', name: 'S-RANDOM' });
    expect(resolveOptionSource('____:S-RANDOM', 'beatoraja')).toEqual({ source: 'lr2', name: 'S-RANDOM' });
    expect(canonicalOptionValue('beatoraja:RANDOM')).toBe('RANDOM');
    expect(canonicalOptionValue('____:S-RANDOM')).toBe('lr2:S-RANDOM');
    expect(canonicalOptionValue('beatoraja:S-RANDOM')).toBe('beatoraja:S-RANDOM');
    expect(optionValueSources('lr2:S-RANDOM')).toEqual(['lr2', '____']);
    expect(optionValueSources('____:S-RANDOM')).toEqual(['lr2', '____']);
    expect(optionValueSources('beatoraja:S-RANDOM')).toEqual(['beatoraja']);
    expect(optionValueSources('lr2:RANDOM')).toEqual([]);
    expect(optionValueSources('SPIRAL')).toEqual([]);
  });

  test('qualifies a colliding name only for a source that defines it', () => {
    expect(qualifyOptionValue('lr2', 'S-RANDOM')).toBe('lr2:S-RANDOM');
    expect(qualifyOptionValue('____', 'S-RANDOM')).toBe('lr2:S-RANDOM');
    expect(qualifyOptionValue('beatoraja', 'RANDOM')).toBe('RANDOM');
    expect(qualifyOptionValue('____', 'CONVERGE')).toBe('CONVERGE');
    expect(qualifyOptionValue('lr2', 'BATTLE')).toBe('BATTLE');
    expect(qualifyOptionValue('beatoraja', 'H-RANDOM')).toBe('H-RANDOM');
  });

  test('migrates a stored bare value to the ruleset selected at migration time, once', () => {
    expect(migrateOptionValue('S-RANDOM', 'beatoraja')).toBe('beatoraja:S-RANDOM');
    expect(migrateOptionValue('S-RANDOM', '____')).toBe('lr2:S-RANDOM');
    expect(migrateOptionValue('RANDOM', '____')).toBe('RANDOM');
    expect(migrateOptionValue('BATTLE', 'beatoraja')).toBe('beatoraja:BATTLE');
    expect(migrateOptionValue('lr2:S-RANDOM', 'beatoraja')).toBe('lr2:S-RANDOM');
    expect(migrateOptionValue('lr2:RANDOM', 'beatoraja')).toBe('RANDOM');
    expect(migrateOptionValue('____:S-RANDOM', 'lr2')).toBe('lr2:S-RANDOM');
    expect(migrateOptionValue('OFF', 'lr2')).toBe('OFF');
  });

  test('knows which qualified values a source defines', () => {
    expect(isKnownOptionSource('beatoraja:CONVERGE')).toBe(true);
    expect(isKnownOptionSource('____:CONVERGE')).toBe(false);
    expect(isKnownOptionSource('____:S-RANDOM')).toBe(true);
    expect(isKnownOptionSource('lr2:RANDOM')).toBe(true);
    expect(isKnownOptionSource('lr2:BATTLE')).toBe(false);
    expect(isKnownOptionSource('lr2:SPIRAL')).toBe(false);
    expect(isKnownOptionSource('SPIRAL')).toBe(true);
  });
});
