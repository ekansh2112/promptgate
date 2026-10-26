import { describe, it, expect, beforeEach } from 'vitest';
import { ResponseCache } from '../cache.js';
import type { LLMResponse } from '../types.js';

describe('ResponseCache', () => {
  let cache: ResponseCache;

  beforeEach(() => {
    cache = new ResponseCache(true);
  });

  it('should generate consistent hashes', () => {
    const hash1 = cache.hash('test prompt', 'gpt-4', 'system', 0.7, 100);
    const hash2 = cache.hash('test prompt', 'gpt-4', 'system', 0.7, 100);
    expect(hash1).toBe(hash2);
  });

  it('should generate different hashes for different inputs', () => {
    const hash1 = cache.hash('test prompt', 'gpt-4', 'system', 0.7, 100);
    const hash2 = cache.hash('different prompt', 'gpt-4', 'system', 0.7, 100);
    expect(hash1).not.toBe(hash2);
  });

  it('should store and retrieve responses', () => {
    const response: LLMResponse = {
      content: 'test response',
      latencyMs: 100,
      cost: 0.001,
    };

    const hash = cache.hash('test', 'model');
    cache.set(hash, response);

    const retrieved = cache.get(hash);
    expect(retrieved).toEqual(response);
  });

  it('should return undefined for missing entries', () => {
    const result = cache.get('nonexistent');
    expect(result).toBeUndefined();
  });

  it('should respect enabled flag', () => {
    const disabledCache = new ResponseCache(false);
    const response: LLMResponse = {
      content: 'test',
      latencyMs: 100,
      cost: 0.001,
    };

    const hash = disabledCache.hash('test', 'model');
    disabledCache.set(hash, response);

    expect(disabledCache.get(hash)).toBeUndefined();
  });

  it('should clear cache', () => {
    const response: LLMResponse = {
      content: 'test',
      latencyMs: 100,
      cost: 0.001,
    };

    const hash = cache.hash('test', 'model');
    cache.set(hash, response);
    expect(cache.size()).toBe(1);

    cache.clear();
    expect(cache.size()).toBe(0);
    expect(cache.get(hash)).toBeUndefined();
  });
});
