import { BaseProvider } from './base.js';
import type { ModelCall, LLMResponse } from '../types.js';

interface ProxyConfig {
  apiUrl: string;
  token: string;
}

export class ProxyProvider extends BaseProvider {
  name = 'proxy';
  private apiUrl: string;
  private token: string;

  constructor(config: ProxyConfig) {
    super();
    this.apiUrl = config.apiUrl;
    this.token = config.token;
  }

  async call(params: ModelCall): Promise<LLMResponse> {
    const startTime = Date.now();

    try {
      const response = await fetch(`${this.apiUrl}/v1/llm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({
          model: params.model,
          prompt: params.prompt,
          systemPrompt: params.systemPrompt,
          temperature: params.temperature,
          maxTokens: params.maxTokens,
        }),
      });

      const latencyMs = Date.now() - startTime;

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as any;
        if (response.status === 429) {
          throw new Error(
            'Quota reached. Add your own API key to continue using PromptGate.'
          );
        }
        throw new Error(
          errorData.error || `API error (${response.status})`
        );
      }

      const data = (await response.json()) as any;

      return {
        content: data.content || '',
        latencyMs,
        cost: data.cost || 0,
        refusal: data.refusal || false,
        error: data.error,
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
    return 0;
  }
}
