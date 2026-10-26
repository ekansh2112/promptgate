import { describe, it, expect } from 'vitest';
import { validateModel, validatePromptSize } from '../quota.js';

describe('quota', () => {
  describe('validateModel', () => {
    it('should allow gemini flash models', () => {
      expect(validateModel('gemini-2.0-flash')).toBe(true);
      expect(validateModel('gemini-2.0-flash-exp')).toBe(true);
      expect(validateModel('gemini-2.5-flash')).toBe(true);
      expect(validateModel('gemini-2.5-flash-lite')).toBe(true);
      expect(validateModel('gemini-1.5-flash')).toBe(true);
      expect(validateModel('gemini-1.5-flash-8b')).toBe(true);
    });

    it('should reject expensive models', () => {
      expect(validateModel('gpt-4')).toBe(false);
      expect(validateModel('claude-3-opus')).toBe(false);
      expect(validateModel('gemini-1.5-pro')).toBe(false);
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
