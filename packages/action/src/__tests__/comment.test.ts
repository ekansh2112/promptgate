import { describe, it, expect } from 'vitest';
import { formatPRComment } from '../comment.js';
import type { EvalReport } from '@promptgate/core';

function report(overrides: Partial<EvalReport> = {}): EvalReport {
  return {
    timestamp: '2026-10-26T22:00:00.000Z',
    baseRef: 'aaaaaaaa',
    headRef: 'bbbbbbbb',
    prompts: [],
    passed: false,
    totalCost: 0,
    ...overrides,
  };
}

describe('formatPRComment', () => {
  it('titles an all-error run as evaluation error and includes the first message', () => {
    const comment = formatPRComment(
      report({
        evaluationError: 'Gemini API error (404): no longer available to new users',
      })
    );

    expect(comment).toContain('<!-- promptgate-report -->');
    expect(comment).toMatch(/evaluation error/i);
    expect(comment).toContain('Gemini API error (404): no longer available to new users');
    expect(comment).not.toContain('PASSED');
    expect(comment).not.toMatch(/Evaluation FAILED/);
  });

  it('uses PASSED/FAILED only when cases actually scored', () => {
    const comment = formatPRComment(report({ passed: true, prompts: [] }));
    expect(comment).toContain('PASSED');
    expect(comment).not.toMatch(/evaluation error/i);
  });
});
