import { BaseProvider } from './base.js';
import type { ModelCall, LLMResponse } from '../types.js';

interface GeminiConfig {
  apiKey: string;
  baseUrl?: string;
}

const MODEL_FALLBACKS = [
  'gemini-2.0-flash',
  'gemini-2.5-flash',
  'gemini-1.5-flash',
  'gemini-flash-latest',
];

export class GeminiProvider extends BaseProvider {
  name = 'gemini';
  private apiKey: string;
  private baseUrl: string;
  private resolvedModel: string | null = null;

  constructor(config: GeminiConfig) {
    super();
    this.apiKey = config.apiKey;
    this.baseUrl =
      config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
  }

  async call(params: ModelCall): Promise<LLMResponse> {
    const startTime = Date.now();
    const modelsToTry = this.resolvedModel
      ? [this.resolvedModel]
      : [params.model, ...MODEL_FALLBACKS.filter((m) => m !== params.model)];

    let lastError: Error | null = null;

    for (const model of modelsToTry) {
      try {
        const result = await this.callModel(model, params, startTime);
        this.resolvedModel = model;
        if (model !== params.model) {
          console.warn(`Gemini model ${params.model} unavailable; using ${model}`);
        }
        return result;
      } catch (error: any) {
        lastError = error;
        const statusMatch = String(error.message).match(/Gemini API error \((\d+)\)/);
        const status = statusMatch ? Number(statusMatch[1]) : 0;
        const retryable = status === 404 || status === 400 || status === 429 || status >= 500;
        if (!retryable || modelsToTry.indexOf(model) === modelsToTry.length - 1) {
          console.error(`Gemini call failed (${model}): ${error.message}`);
          return this.handleError(error);
        }
        console.warn(`Gemini model ${model} failed (${status || 'error'}); trying fallback`);
      }
    }

    return this.handleError(lastError || new Error('Gemini request failed'));
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

    const requestBody: Record<string, unknown> = {
      contents,
      generationConfig: {},
    };

    const generationConfig: Record<string, unknown> = {};
    if (params.temperature !== undefined) {
      generationConfig.temperature = params.temperature;
    }
    if (params.maxTokens) {
      generationConfig.maxOutputTokens = params.maxTokens;
    }
    requestBody.generationConfig = generationConfig;

    const response = await fetch(
      `${this.baseUrl}/models/${model}:generateContent?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'PromptGate/1.0',
        },
        body: JSON.stringify(requestBody),
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
