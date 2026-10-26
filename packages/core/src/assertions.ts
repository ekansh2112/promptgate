import type { Assertion, AssertionResult } from './types.js';

export function checkAssertion(
  assertion: Assertion,
  output: string
): AssertionResult {
  switch (assertion.type) {
    case 'contains':
      return {
        type: 'contains',
        passed: output.includes(assertion.value),
        expected: assertion.value,
        message: `Output should contain "${assertion.value}"`,
      };

    case 'not_contains':
      return {
        type: 'not_contains',
        passed: !output.includes(assertion.value),
        expected: `not containing "${assertion.value}"`,
        message: `Output should not contain "${assertion.value}"`,
      };

    case 'regex': {
      const regex = new RegExp(assertion.pattern);
      const passed = regex.test(output);
      return {
        type: 'regex',
        passed,
        expected: assertion.pattern,
        message: `Output should match pattern /${assertion.pattern}/`,
      };
    }

    case 'json_equals': {
      try {
        const parsed = JSON.parse(output);
        const value = getNestedValue(parsed, assertion.path);
        const passed = deepEqual(value, assertion.value);
        return {
          type: 'json_equals',
          passed,
          expected: assertion.value,
          actual: value,
          message: `JSON path ${assertion.path} should equal ${JSON.stringify(assertion.value)}`,
        };
      } catch (error) {
        return {
          type: 'json_equals',
          passed: false,
          expected: assertion.value,
          message: `Failed to parse JSON or access path ${assertion.path}`,
        };
      }
    }

    case 'json_in': {
      try {
        const parsed = JSON.parse(output);
        const value = getNestedValue(parsed, assertion.path);
        const passed = assertion.values.some((v: any) => deepEqual(value, v));
        return {
          type: 'json_in',
          passed,
          expected: assertion.values,
          actual: value,
          message: `JSON path ${assertion.path} should be one of ${JSON.stringify(assertion.values)}`,
        };
      } catch (error) {
        return {
          type: 'json_in',
          passed: false,
          expected: assertion.values,
          message: `Failed to parse JSON or access path ${assertion.path}`,
        };
      }
    }

    case 'length_min':
      return {
        type: 'length_min',
        passed: output.length >= assertion.value,
        expected: `>= ${assertion.value}`,
        actual: output.length,
        message: `Output length should be at least ${assertion.value}`,
      };

    case 'length_max':
      return {
        type: 'length_max',
        passed: output.length <= assertion.value,
        expected: `<= ${assertion.value}`,
        actual: output.length,
        message: `Output length should be at most ${assertion.value}`,
      };

    default:
      return {
        type: 'unknown',
        passed: false,
        message: 'Unknown assertion type',
      };
  }
}

function getNestedValue(obj: any, path: string): any {
  const keys = path.split('.');
  let current = obj;
  for (const key of keys) {
    if (current == null) return undefined;
    current = current[key];
  }
  return current;
}

function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (!keysB.includes(key)) return false;
    if (!deepEqual(a[key], b[key])) return false;
  }

  return true;
}
