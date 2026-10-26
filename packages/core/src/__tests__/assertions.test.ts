import { describe, it, expect } from 'vitest';
import { checkAssertion } from '../assertions.js';

describe('checkAssertion', () => {
  it('should check contains assertion', () => {
    const result = checkAssertion(
      { type: 'contains', value: 'hello' },
      'hello world'
    );
    expect(result.passed).toBe(true);

    const result2 = checkAssertion(
      { type: 'contains', value: 'goodbye' },
      'hello world'
    );
    expect(result2.passed).toBe(false);
  });

  it('should check not_contains assertion', () => {
    const result = checkAssertion(
      { type: 'not_contains', value: 'error' },
      'success message'
    );
    expect(result.passed).toBe(true);

    const result2 = checkAssertion(
      { type: 'not_contains', value: 'error' },
      'error occurred'
    );
    expect(result2.passed).toBe(false);
  });

  it('should check regex assertion', () => {
    const result = checkAssertion(
      { type: 'regex', pattern: '^\\d{3}$' },
      '123'
    );
    expect(result.passed).toBe(true);

    const result2 = checkAssertion(
      { type: 'regex', pattern: '^\\d{3}$' },
      '1234'
    );
    expect(result2.passed).toBe(false);
  });

  it('should check json_equals assertion', () => {
    const result = checkAssertion(
      { type: 'json_equals', path: 'status', value: 'success' },
      JSON.stringify({ status: 'success' })
    );
    expect(result.passed).toBe(true);

    const result2 = checkAssertion(
      { type: 'json_equals', path: 'nested.value', value: 42 },
      JSON.stringify({ nested: { value: 42 } })
    );
    expect(result2.passed).toBe(true);

    const result3 = checkAssertion(
      { type: 'json_equals', path: 'status', value: 'failure' },
      JSON.stringify({ status: 'success' })
    );
    expect(result3.passed).toBe(false);
  });

  it('should check json_in assertion', () => {
    const result = checkAssertion(
      { type: 'json_in', path: 'status', values: ['success', 'ok'] },
      JSON.stringify({ status: 'success' })
    );
    expect(result.passed).toBe(true);

    const result2 = checkAssertion(
      { type: 'json_in', path: 'status', values: ['success', 'ok'] },
      JSON.stringify({ status: 'failure' })
    );
    expect(result2.passed).toBe(false);
  });

  it('should check length_min assertion', () => {
    const result = checkAssertion(
      { type: 'length_min', value: 5 },
      'hello world'
    );
    expect(result.passed).toBe(true);

    const result2 = checkAssertion(
      { type: 'length_min', value: 20 },
      'short'
    );
    expect(result2.passed).toBe(false);
  });

  it('should check length_max assertion', () => {
    const result = checkAssertion(
      { type: 'length_max', value: 100 },
      'short text'
    );
    expect(result.passed).toBe(true);

    const result2 = checkAssertion(
      { type: 'length_max', value: 5 },
      'this is too long'
    );
    expect(result2.passed).toBe(false);
  });
});
