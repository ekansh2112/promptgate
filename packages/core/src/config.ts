import { z } from 'zod';
import { DEFAULT_JUDGE_MODEL, DEFAULT_TARGET_MODEL } from './models.js';

export const AssertionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('contains'),
    value: z.string(),
  }),
  z.object({
    type: z.literal('not_contains'),
    value: z.string(),
  }),
  z.object({
    type: z.literal('regex'),
    pattern: z.string(),
  }),
  z.object({
    type: z.literal('json_equals'),
    path: z.string(),
    value: z.any(),
  }),
  z.object({
    type: z.literal('json_in'),
    path: z.string(),
    values: z.array(z.any()),
  }),
  z.object({
    type: z.literal('length_min'),
    value: z.number(),
  }),
  z.object({
    type: z.literal('length_max'),
    value: z.number(),
  }),
]);

export const TestCaseSchema = z.object({
  name: z.string().optional(),
  inputs: z.record(z.any()),
  assertions: z.array(AssertionSchema).optional(),
  critical: z.boolean().default(false),
});

export type TestCase = z.infer<typeof TestCaseSchema>;

export const TestSetSchema = z.array(TestCaseSchema);

export type TestSet = z.infer<typeof TestSetSchema>;

export const PromptConfigSchema = z.object({
  name: z.string(),
  path: z.string(),
  model: z.string().default(DEFAULT_TARGET_MODEL),
  variables: z.array(z.string()).default([]),
  testSet: z.string(),
  rubric: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().positive().optional(),
  systemPrompt: z.string().optional(),
});

export type PromptConfig = z.infer<typeof PromptConfigSchema>;

export const PromptGateConfigSchema = z.object({
  prompts: z.array(PromptConfigSchema),
  scoring: z
    .object({
      runs: z.number().positive().default(1),
      passRateThreshold: z.number().min(0).max(1).default(0.1),
      enableCache: z.boolean().default(true),
      judgeModel: z.string().default(DEFAULT_JUDGE_MODEL),
    })
    .default({}),
  providers: z
    .object({
      gemini: z
        .object({
          apiKey: z.string().optional(),
        })
        .optional(),
      openai: z
        .object({
          apiKey: z.string().optional(),
          baseUrl: z.string().optional(),
        })
        .optional(),
    })
    .default({}),
});

export type PromptGateConfig = z.infer<typeof PromptGateConfigSchema>;
