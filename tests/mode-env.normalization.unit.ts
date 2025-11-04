import { describe, it, expect } from 'vitest';
import { normalizeMode, normalizeEnvironment } from '../src/types/index.js';

describe('Mode/Environment normalization', () => {
  it('normalizes mode values', () => {
    expect(normalizeMode('arena')).toBe('arena');
    expect(normalizeMode('strategy')).toBe('strategy');
    expect(normalizeMode('dashboard')).toBe('strategy');
    expect(normalizeMode('SINGLE')).toBe('strategy');
    expect(normalizeMode(undefined)).toBe('strategy');
  });

  it('normalizes environment values', () => {
    expect(normalizeEnvironment('live')).toBe('live');
    expect(normalizeEnvironment('paper')).toBe('paper');
    expect(normalizeEnvironment('simulate')).toBe('simulate');
    expect(normalizeEnvironment('simulation')).toBe('simulate');
    expect(normalizeEnvironment('prod')).toBe('live');
    expect(normalizeEnvironment('dev')).toBe('simulate');
    expect(normalizeEnvironment(undefined)).toBe('simulate');
  });
});
