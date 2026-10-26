import { describe, it, expect } from 'vitest';
import { validateModel, validatePromptSize } from '../quota.js';

describe('quota', () => {
  describe('validateModel', () => {
    it('should allow hosted Gemini 3.5 flash models', () => {
      expect(validateModel('gemini-3.5-flash-lite')).toBe(true);
      expect(validateModel('gemini-3.5-flash')).toBe(true);
    });

    it('should reject retired, expensive, and high-quota models', () => {
      expect(validateModel('gpt-4')).toBe(false);
      expect(validateModel('claude-3-opus')).toBe(false);
      expect(validateModel('gemini-1.5-pro')).toBe(false);
      expect(validateModel('gemini-2.5-flash')).toBe(false);
      expect(validateModel('gemini-2.5-flash-lite')).toBe(false);
      expect(validateModel('gemini-3.8-flash')).toBe(false);
    });
  });

  describe('validatePromptSize', () => {
    it('should allow prompts under the limit', () => {
      expect(validatePromptSize('hello world')).toBe(true);
      expect(validatePromptSize('a'.repeat(50_000))).toBe(true);
    });

    it('should reject prompts over the limit', () => {
      expect(validatePromptSize('a'.repeat(50_001))).toBe(false);
      expect(validatePromptSize('a'.repeat(100_000))).toBe(false);
    });
  });
});
