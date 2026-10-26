import type { Env } from '../types.js';

export async function callGemini(
  env: Env,
  model: string,
  prompt: string,
  systemPrompt?: string,
  temperature?: number,
  maxTokens?: number
): Promise<{
  content: string;
  cost: number;
  refusal?: boolean;
  error?: string;
}> {
  const contents = [];

  if (systemPrompt) {
    contents.push({
      role: 'user',
      parts: [{ text: systemPrompt }],
    });
    contents.push({
      role: 'model',
      parts: [{ text: 'Understood.' }],
    });
  }

  contents.push({
    role: 'user',
    parts: [{ text: prompt }],
  });

  const requestBody: any = {
    contents,
    generationConfig: {},
  };

  if (temperature !== undefined) {
    requestBody.generationConfig.temperature = temperature;
  }

  if (maxTokens) {
    requestBody.generationConfig.maxOutputTokens = maxTokens;
  }

  const baseUrl =
    env.AI_GATEWAY_URL || 'https://generativelanguage.googleapis.com/v1beta';

  const response = await fetch(
    `${baseUrl}/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as any;

  if (
    data.promptFeedback?.blockReason ||
    !data.candidates ||
    data.candidates.length === 0
  ) {
    return { content: '', cost: 0, refusal: true };
  }

  const text = data.candidates[0].content?.parts?.[0]?.text || '';
  const inputTokens = estimateTokens(prompt);
  const outputTokens = estimateTokens(text);
  const cost = estimateCost(model, inputTokens, outputTokens);

  return { content: text, cost };
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const rates: Record<string, { input: number; output: number }> = {
    'gemini-3.5-flash-lite': { input: 0.1, output: 0.4 },
    'gemini-3.5-flash': { input: 0.15, output: 0.6 },
  };

  const rate = rates[model] || rates['gemini-3.5-flash-lite'];
  return (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000;
}

export async function hashRequest(
  model: string,
  prompt: string,
  systemPrompt?: string
): Promise<string> {
  const data = JSON.stringify({ model, prompt, systemPrompt });
  const encoder = new TextEncoder();
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(data));
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
