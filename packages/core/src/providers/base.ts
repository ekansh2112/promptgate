import type { Provider, ModelCall, LLMResponse } from '../types.js';

export abstract class BaseProvider implements Provider {
  abstract name: string;

  abstract call(params: ModelCall): Promise<LLMResponse>;

  abstract estimateCost(
    model: string,
    inputTokens: number,
    outputTokens: number
  ): number;

  protected estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  protected async handleError(error: any): Promise<LLMResponse> {
    return {
      content: '',
      latencyMs: 0,
      cost: 0,
      error: error.message || String(error),
    };
  }
}
