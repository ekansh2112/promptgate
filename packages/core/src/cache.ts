import crypto from 'crypto';
import type { LLMResponse, CacheEntry } from './types.js';

export class ResponseCache {
  private cache = new Map<string, CacheEntry>();
  private enabled: boolean;

  constructor(enabled = true) {
    this.enabled = enabled;
  }

  hash(
    prompt: string,
    model: string,
    systemPrompt?: string,
    temperature?: number,
    maxTokens?: number
  ): string {
    const data = JSON.stringify({
      prompt,
      model,
      systemPrompt,
      temperature,
      maxTokens,
    });
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  get(hash: string): LLMResponse | undefined {
    if (!this.enabled) return undefined;
    return this.cache.get(hash)?.response;
  }

  set(hash: string, response: LLMResponse): void {
    if (!this.enabled) return;
    this.cache.set(hash, {
      hash,
      response,
      timestamp: Date.now(),
    });
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}
