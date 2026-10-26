import { describe, it, expect, vi } from 'vitest';
import { computeContextFreeScore, runBidirectionalJudge } from '../scoring.js';
import type { LLMResponse, Provider } from '../types.js';

describe('computeContextFreeScore', () => {
  it('should detect valid JSON', () => {
    const response: LLMResponse = {
      content: JSON.stringify({ key: 'value' }),
      latencyMs: 100,
      cost: 0.001,
    };

    const score = computeContextFreeScore(response);
    expect(score.validJson).toBe(true);
    expect(score.error).toBe(false);
    expect(score.refusal).toBe(false);
  });

  it('should detect invalid JSON', () => {
    const response: LLMResponse = {
      content: 'not json',
      latencyMs: 100,
      cost: 0.001,
    };

    const score = computeContextFreeScore(response);
    expect(score.validJson).toBe(false);
  });

  it('should detect errors', () => {
    const response: LLMResponse = {
      content: '',
      latencyMs: 0,
      cost: 0,
      error: 'API error',
    };

    const score = computeContextFreeScore(response);
    expect(score.error).toBe(true);
  });

  it('should detect refusals', () => {
    const response: LLMResponse = {
      content: '',
      latencyMs: 100,
      cost: 0,
      refusal: true,
    };

    const score = computeContextFreeScore(response);
    expect(score.refusal).toBe(true);
  });

  it('should measure length and latency', () => {
    const response: LLMResponse = {
      content: 'hello world',
      latencyMs: 250,
      cost: 0.002,
    };

    const score = computeContextFreeScore(response);
    expect(score.length).toBe(11);
    expect(score.latencyMs).toBe(250);
    expect(score.cost).toBe(0.002);
  });
});

describe('runBidirectionalJudge', () => {
  it('should agree when both judges pick the same', async () => {
    let callCount = 0;
    const mockProvider: Provider = {
      name: 'mock',
      call: vi.fn().mockImplementation(async () => {
        callCount++;
        // First call: (base, head) -> B means head
        // Second call: (head, base) -> A means head (reversed)
        return {
          content: JSON.stringify({
            preferred: callCount === 1 ? 'B' : 'A',
            reasoning: 'This is better',
            confidence: 0.8,
          }),
          latencyMs: 100,
          cost: 0.001,
        };
      }),
      estimateCost: () => 0.001,
    };

    const result = await runBidirectionalJudge(
      mockProvider,
      'Choose the better output',
      'Test prompt',
      { input: 'test' },
      'base output',
      'head output'
    );

    expect(result.preferredVersion).toBe('head');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('should tie when judges disagree', async () => {
    let callCount = 0;
    const mockProvider: Provider = {
      name: 'mock',
      call: vi.fn().mockImplementation(async () => {
        callCount++;
        return {
          content: JSON.stringify({
            preferred: callCount === 1 ? 'A' : 'A',
            reasoning: 'Reasoning',
            confidence: 0.7,
          }),
          latencyMs: 100,
          cost: 0.001,
        };
      }),
      estimateCost: () => 0.001,
    };

    const result = await runBidirectionalJudge(
      mockProvider,
      'Choose the better output',
      'Test prompt',
      { input: 'test' },
      'base output',
      'head output'
    );

    expect(result.preferredVersion).toBe('tie');
  });

  it('should handle judge failures gracefully', async () => {
    const mockProvider: Provider = {
      name: 'mock',
      call: vi.fn().mockResolvedValue({
        content: 'invalid json',
        latencyMs: 100,
        cost: 0.001,
        error: 'Parse error',
      }),
      estimateCost: () => 0.001,
    };

    const result = await runBidirectionalJudge(
      mockProvider,
      'Choose the better output',
      'Test prompt',
      { input: 'test' },
      'base output',
      'head output'
    );

    expect(result.preferredVersion).toBe('tie');
    expect(result.confidence).toBe(0);
  });
});
