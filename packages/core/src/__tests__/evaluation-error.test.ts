import { describe, it, expect } from 'vitest';
import { collectEvaluationError } from '../engine.js';
import type { PromptResult } from '../types.js';

function prompt(cases: PromptResult['caseResults']): PromptResult {
  return {
    promptName: 'Test',
    promptPath: 'x.txt',
    model: 'gemini-3.5-flash-lite',
    totalCases: cases.length,
    passedCases: 0,
    failedCases: cases.length,
    criticalFailures: 0,
    flakyCount: 0,
    basePassRate: 0,
    headPassRate: 0,
    passRateDelta: 0,
    totalCostBase: 0,
    totalCostHead: 0,
    avgLatencyBase: 0,
    avgLatencyHead: 0,
    caseResults: cases,
  };
}

function erroredCase(message?: string) {
  return {
    caseName: 'c',
    inputs: {},
    critical: false,
    baseOutput: '',
    headOutput: '',
    baseContextFree: {
      validJson: false,
      refusal: false,
      error: true,
      length: 0,
      latencyMs: 0,
      cost: 0,
    },
    headContextFree: {
      validJson: false,
      refusal: false,
      error: true,
      length: 0,
      latencyMs: 0,
      cost: 0,
    },
    baseAssertions: [],
    headAssertions: [],
    flaky: false,
    runs: 1,
    providerError: message,
  };
}

describe('collectEvaluationError', () => {
  it('returns the first provider error when every case failed', () => {
    const err = collectEvaluationError([
      prompt([
        erroredCase('Gemini API error (404): model gone'),
        erroredCase('later'),
      ]),
    ]);
    expect(err).toBe('Gemini API error (404): model gone');
  });

  it('returns undefined when any case produced an output', () => {
    const ok = erroredCase();
    ok.baseContextFree.error = false;
    ok.baseOutput = 'hello';
    ok.providerError = undefined;
    expect(collectEvaluationError([prompt([ok])])).toBeUndefined();
  });
});
