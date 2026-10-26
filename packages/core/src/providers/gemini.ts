import { BaseProvider } from './base.js';
import type { ModelCall, LLMResponse } from '../types.js';

interface GeminiConfig {
  apiKey: string;
  baseUrl?: string;
}

const MODEL_FALLBACKS: string[] = [];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryDelayMs(message: string): number {
  const match = message.match(/"retryDelay":\s*"(\d+)s"/);
  if (match) {
    return (Number(match[1]) + 1) * 1000;
  }
  return 15_000;
}

export class GeminiProvider extends BaseProvider {
  name = 'gemini';
  private apiKey: string;
  private baseUrl: string;
  private resolvedModel: string | null = null;
  private lastCallAt = 0;
  private minIntervalMs: number;

  constructor(config: GeminiConfig) {
    super();
    this.apiKey = config.apiKey;
    this.baseUrl =
      config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
    const fromEnv = Number(process.env.GEMINI_MIN_INTERVAL_MS);
    this.minIntervalMs = Number.isFinite(fromEnv) && fromEnv >= 0 ? fromEnv : 4_000;
  }

  async call(params: ModelCall): Promise<LLMResponse> {
    const startTime = Date.now();
    const modelsToTry = this.resolvedModel
      ? [this.resolvedModel]
      : [params.model, ...MODEL_FALLBACKS.filter((m) => m !== params.model)];

    let lastError: Error | null = null;

    for (const model of modelsToTry) {
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          await this.throttle();
          const result = await this.callModel(model, params, startTime);
          this.resolvedModel = model;
          if (model !== params.model) {
            console.warn(
              `Gemini model ${params.model} unavailable; using ${model}`
            );
          }
          return result;
        } catch (error: any) {
          lastError = error;
          const statusMatch = String(error.message).match(
            /Gemini API error \((\d+)\)/
          );
          const status = statusMatch ? Number(statusMatch[1]) : 0;

          if (status === 429) {
            const daily =
              /per day|requests per day|retry in \d+h/i.test(error.message);
            if (daily) {
              console.error(
                `Gemini daily quota exceeded (${model}). Add a paid key or wait.`
              );
              return this.handleError(error);
            }
            if (attempt < 3) {
              const delay = Math.min(parseRetryDelayMs(error.message), 20_000);
              console.warn(
                `Gemini rate limited (${model}); waiting ${Math.round(delay / 1000)}s`
              );
              await sleep(delay);
              continue;
            }
            console.error(`Gemini still rate limited after retries (${model})`);
            return this.handleError(error);
          }

          const tryNextModel = status === 404 || status === 400;
          if (tryNextModel) {
            console.warn(
              `Gemini model ${model} failed (${status}); trying fallback`
            );
            break;
          }

          console.error(`Gemini call failed (${model}): ${error.message}`);
          return this.handleError(error);
        }
      }
    }

    console.error(
      `Gemini call failed after retries: ${lastError?.message || 'unknown error'}`
    );
    return this.handleError(lastError || new Error('Gemini request failed'));
  }

  private async throttle(): Promise<void> {
    if (this.minIntervalMs <= 0) return;
    const elapsed = Date.now() - this.lastCallAt;
    if (this.lastCallAt && elapsed < this.minIntervalMs) {
      await sleep(this.minIntervalMs - elapsed);
    }
    this.lastCallAt = Date.now();
  }

  private async callModel(
    model: string,
    params: ModelCall,
    startTime: number
  ): Promise<LLMResponse> {
    const contents = [];

    if (params.systemPrompt) {
      contents.push({
        role: 'user',
        parts: [{ text: params.systemPrompt }],
      });
      contents.push({
        role: 'model',
        parts: [{ text: 'Understood.' }],
      });
    }

    contents.push({
      role: 'user',
      parts: [{ text: params.prompt }],
    });

    const generationConfig: Record<string, unknown> = {};
    if (params.temperature !== undefined) {
      generationConfig.temperature = params.temperature;
    }
    if (params.maxTokens) {
      generationConfig.maxOutputTokens = params.maxTokens;
    }

    const response = await fetch(
      `${this.baseUrl}/models/${model}:generateContent?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'PromptGate/1.0',
        },
        body: JSON.stringify({ contents, generationConfig }),
        signal: AbortSignal.timeout(45_000),
      }
    );

    const latencyMs = Date.now() - startTime;

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
      return {
        content: '',
        latencyMs,
        cost: 0,
        refusal: true,
      };
    }

    const candidate = data.candidates[0];
    const text = candidate.content?.parts?.[0]?.text || '';

    const inputTokens = this.estimateTokens(params.prompt);
    const outputTokens = this.estimateTokens(text);
    const cost = this.estimateCost(model, inputTokens, outputTokens);

    return {
      content: text,
      latencyMs,
      cost,
    };
  }

  estimateCost(
    model: string,
    inputTokens: number,
    outputTokens: number
  ): number {
    const rates: Record<string, { input: number; output: number }> = {
      'gemini-2.0-flash-exp': { input: 0, output: 0 },
      'gemini-2.0-flash': { input: 0.1, output: 0.4 },
      'gemini-2.5-flash': { input: 0.15, output: 0.6 },
      'gemini-1.5-flash': { input: 0.075, output: 0.3 },
      'gemini-1.5-flash-8b': { input: 0.0375, output: 0.15 },
      'gemini-flash-latest': { input: 0.1, output: 0.4 },
      'gemini-1.5-pro': { input: 1.25, output: 5.0 },
    };

    const rate = rates[model] || rates['gemini-2.0-flash'];

    return (
      (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000
    );
  }
}
