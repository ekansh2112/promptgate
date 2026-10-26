import { BaseProvider } from './base.js';
import type { ModelCall, LLMResponse } from '../types.js';

interface GeminiConfig {
  apiKey: string;
  baseUrl?: string;
}

export class GeminiProvider extends BaseProvider {
  name = 'gemini';
  private apiKey: string;
  private baseUrl: string;

  constructor(config: GeminiConfig) {
    super();
    this.apiKey = config.apiKey;
    this.baseUrl =
      config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
  }

  async call(params: ModelCall): Promise<LLMResponse> {
    const startTime = Date.now();

    try {
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

      const requestBody: any = {
        contents,
        generationConfig: {},
      };

      if (params.temperature !== undefined) {
        requestBody.generationConfig.temperature = params.temperature;
      }

      if (params.maxTokens) {
        requestBody.generationConfig.maxOutputTokens = params.maxTokens;
      }

      const response = await fetch(
        `${this.baseUrl}/models/${params.model}:generateContent?key=${this.apiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        }
      );

      const latencyMs = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Gemini API error (${response.status}): ${errorText}`
        );
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
      const cost = this.estimateCost(params.model, inputTokens, outputTokens);

      return {
        content: text,
        latencyMs,
        cost,
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  estimateCost(
    model: string,
    inputTokens: number,
    outputTokens: number
  ): number {
    const rates: Record<string, { input: number; output: number }> = {
      'gemini-2.0-flash-exp': { input: 0, output: 0 },
      'gemini-1.5-flash': { input: 0.075, output: 0.3 },
      'gemini-1.5-flash-8b': { input: 0.0375, output: 0.15 },
      'gemini-1.5-pro': { input: 1.25, output: 5.0 },
    };

    const rate = rates[model] || rates['gemini-1.5-flash'];

    return (
      (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000
    );
  }
}
