import { describe, it, expect } from 'vitest';
import { DEFAULT_JUDGE_MODEL, DEFAULT_TARGET_MODEL } from '../models.js';
import { PromptGateConfigSchema } from '../config.js';

describe('default models', () => {
  it('uses Gemini 3.5 flash-lite as the target and 3.5 flash as the judge', () => {
    expect(DEFAULT_TARGET_MODEL).toBe('gemini-3.5-flash-lite');
    expect(DEFAULT_JUDGE_MODEL).toBe('gemini-3.5-flash');
  });

  it('applies those defaults when the config omits model and judgeModel', () => {
    const parsed = PromptGateConfigSchema.parse({
      prompts: [
        {
          name: 'n',
          path: 'p.txt',
          testSet: 't.yaml',
        },
      ],
    });
    expect(parsed.prompts[0].model).toBe('gemini-3.5-flash-lite');
    expect(parsed.scoring.judgeModel).toBe('gemini-3.5-flash');
    expect(parsed.scoring.runs).toBe(1);
  });
});
