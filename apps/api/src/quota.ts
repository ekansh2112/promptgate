import type { Env } from './types.js';

const DAILY_CALL_LIMIT = 1000;
const DAILY_TOKEN_LIMIT = 500_000;
const GLOBAL_DAILY_BUDGET = 50.0;
const ALLOWED_MODELS = [
  'gemini-2.0-flash',
  'gemini-2.0-flash-exp',
  'gemini-2.0-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-1.5-flash',
  'gemini-1.5-flash-8b',
];
const MAX_PROMPT_LENGTH = 50_000;

export async function checkQuota(
  env: Env,
  repository: string
): Promise<{ allowed: boolean; reason?: string }> {
  const today = new Date().toISOString().split('T')[0];

  const quota = await env.DB.prepare(
    'SELECT call_count, token_count FROM quotas WHERE repository = ? AND date = ?'
  )
    .bind(repository, today)
    .first<{ call_count: number; token_count: number }>();

  if (quota) {
    if (quota.call_count >= DAILY_CALL_LIMIT) {
      return {
        allowed: false,
        reason: `Daily call limit (${DAILY_CALL_LIMIT}) reached. Add your own API key to continue.`,
      };
    }
    if (quota.token_count >= DAILY_TOKEN_LIMIT) {
      return {
        allowed: false,
        reason: `Daily token limit (${DAILY_TOKEN_LIMIT}) reached. Add your own API key to continue.`,
      };
    }
  }

  const globalSpend = await env.DB.prepare(
    'SELECT SUM(total_cost) as total FROM runs WHERE date(timestamp) = ?'
  )
    .bind(today)
    .first<{ total: number | null }>();

  if (globalSpend && globalSpend.total && globalSpend.total >= GLOBAL_DAILY_BUDGET) {
    return {
      allowed: false,
      reason: 'Global daily budget reached. Please try again tomorrow or add your own API key.',
    };
  }

  return { allowed: true };
}

export async function incrementQuota(
  env: Env,
  repository: string,
  tokens: number
): Promise<void> {
  const today = new Date().toISOString().split('T')[0];

  await env.DB.prepare(
    `INSERT INTO quotas (repository, date, call_count, token_count)
     VALUES (?, ?, 1, ?)
     ON CONFLICT(repository, date) DO UPDATE SET
       call_count = call_count + 1,
       token_count = token_count + ?`
  )
    .bind(repository, today, tokens, tokens)
    .run();
}

export function validateModel(model: string): boolean {
  return ALLOWED_MODELS.includes(model);
}

export function validatePromptSize(prompt: string): boolean {
  return prompt.length <= MAX_PROMPT_LENGTH;
}
