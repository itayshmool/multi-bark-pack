import { describe, it, expect } from 'vitest';
import { errorMessage } from './error.js';

describe('errorMessage', () => {
  it('extracts message from Error instance', () => {
    expect(errorMessage(new Error('something broke'))).toBe('something broke');
  });

  it('converts string to string', () => {
    expect(errorMessage('raw error')).toBe('raw error');
  });

  it('converts number to string', () => {
    expect(errorMessage(42)).toBe('42');
  });

  it('converts null/undefined to string', () => {
    expect(errorMessage(null)).toBe('null');
    expect(errorMessage(undefined)).toBe('undefined');
  });
});
