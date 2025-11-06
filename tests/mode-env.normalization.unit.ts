import { describe, it, expect } from 'vitest';
import { normalizeMode, normalizeEnvironment, ValidationError } from '../src/types/index.js';

describe('Mode/Environment normalization', () => {
  it('normalizes mode values', () => {
    // Canonical values
    expect(normalizeMode('arena')).toBe('arena');
    expect(normalizeMode('single')).toBe('single');
    // Case insensitive
    expect(normalizeMode('SINGLE')).toBe('single');
    expect(normalizeMode('ARENA')).toBe('arena');
    // Null/undefined default to 'single' for convenience
    expect(normalizeMode(undefined)).toBe('single');
    expect(normalizeMode(null)).toBe('single');
  });

  it('throws ValidationError for invalid mode values', () => {
    // Invalid values should throw
    expect(() => normalizeMode('unknown')).toThrow(ValidationError);
    expect(() => normalizeMode('strategy')).toThrow(ValidationError);
    expect(() => normalizeMode('solo')).toThrow(ValidationError);
    expect(() => normalizeMode('dashboard')).toThrow(ValidationError);
    expect(() => normalizeMode('invalid')).toThrow(ValidationError);

    // Verify error messages
    expect(() => normalizeMode('strategy')).toThrow('Invalid mode value: "strategy"');
    expect(() => normalizeMode('unknown')).toThrow('Invalid mode value: "unknown"');
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
