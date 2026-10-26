import { BaseProvider } from './base.js';
import type { ModelCall, LLMResponse } from '../types.js';

interface OpenAIConfig {
  apiKey: string;
  baseUrl?: string;
}

export class OpenAIProvider extends BaseProvider {
  name = 'openai';
  private apiKey: string;
  private baseUrl: string;

  constructor(config: OpenAIConfig) {
    super();
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://api.openai.com/v1';
  }

  async call(params: ModelCall): Promise<LLMResponse> {
    const startTime = Date.now();

    try {
      const messages: any[] = [];

      if (params.systemPrompt) {
        messages.push({
          role: 'system',
          content: params.systemPrompt,
        });
      }

      messages.push({
        role: 'user',
        content: params.prompt,
      });

      const requestBody: any = {
        model: params.model,
        messages,
      };

      if (params.temperature !== undefined) {
        requestBody.temperature = params.temperature;
      }

      if (params.maxTokens) {
        requestBody.max_tokens = params.maxTokens;
      }

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(requestBody),
      });

      const latencyMs = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `OpenAI API error (${response.status}): ${errorText}`
        );
      }

      const data = (await response.json()) as any;

      if (
        !data.choices ||
        data.choices.length === 0 ||
        data.choices[0].finish_reason === 'content_filter'
      ) {
        return {
          content: '',
          latencyMs,
          cost: 0,
          refusal: true,
        };
      }

      const text = data.choices[0].message?.content || '';

      const inputTokens = data.usage?.prompt_tokens || this.estimateTokens(params.prompt);
      const outputTokens = data.usage?.completion_tokens || this.estimateTokens(text);
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
      'gpt-4o': { input: 2.5, output: 10.0 },
      'gpt-4o-mini': { input: 0.15, output: 0.6 },
      'gpt-4-turbo': { input: 10.0, output: 30.0 },
      'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
    };

    const rate = rates[model] || { input: 0.5, output: 1.5 };

    return (
      (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000
    );
  }
}
