import { describe, it, expect } from 'vitest';
import { normalizeMode, normalizeEnvironment } from '../src/types/index.js';

describe('Mode/Environment normalization', () => {
  it('normalizes mode values', () => {
    // Canonical values
    expect(normalizeMode('arena')).toBe('arena');
    expect(normalizeMode('single')).toBe('single');
    // Case insensitive
    expect(normalizeMode('SINGLE')).toBe('single');
    expect(normalizeMode('ARENA')).toBe('arena');
    // Unknown values default to 'single' (no aliases supported)
    expect(normalizeMode(undefined)).toBe('single');
    expect(normalizeMode('unknown')).toBe('single');
    expect(normalizeMode('strategy')).toBe('single'); // Treated as unknown, defaults to 'single'
    expect(normalizeMode('solo')).toBe('single'); // Treated as unknown, defaults to 'single'
    expect(normalizeMode('dashboard')).toBe('single'); // Treated as unknown, defaults to 'single'
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
