import { describe, it, expect } from 'vitest';
import { calculateJudgeAgreement } from '../calibration.js';

describe('calculateJudgeAgreement', () => {
  it('matches labels by prompt and case name, not output text', () => {
    const result = calculateJudgeAgreement(
      [
        {
          promptName: 'Code Review Summary',
          caseName: 'Bug fix',
          output: 'anything',
          label: 'good',
        },
      ],
      [
        {
          caseName: 'Bug fix',
          promptName: 'Code Review Summary',
          output: 'completely different generated text',
          judgePreferred: 'head',
          isHead: true,
        },
      ]
    );

    expect(result.totalCases).toBe(1);
    expect(result.agreementPercentage).toBe(100);
  });

  it('counts disagreement when judge prefers the opposite side', () => {
    const result = calculateJudgeAgreement(
      [
        {
          promptName: 'Code Review Summary',
          caseName: 'Bug fix',
          output: '',
          label: 'good',
        },
      ],
      [
        {
          caseName: 'Bug fix',
          promptName: 'Code Review Summary',
          output: 'head output',
          judgePreferred: 'base',
          isHead: true,
        },
      ]
    );

    expect(result.totalCases).toBe(1);
    expect(result.agreementPercentage).toBe(0);
  });

  it('returns zero when no labels match', () => {
    const result = calculateJudgeAgreement(
      [
        {
          promptName: 'Other',
          caseName: 'Missing',
          output: '',
          label: 'good',
        },
      ],
      [
        {
          caseName: 'Bug fix',
          promptName: 'Code Review Summary',
          output: 'x',
          judgePreferred: 'head',
          isHead: true,
        },
      ]
    );

    expect(result.totalCases).toBe(0);
    expect(result.agreementPercentage).toBe(0);
  });
});
