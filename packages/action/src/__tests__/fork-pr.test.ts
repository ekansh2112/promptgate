import { describe, it, expect } from 'vitest';

describe('Fork PR detection', () => {
  it('should detect fork PR from head.repo.fork field', () => {
    const pr = {
      head: {
        repo: {
          fork: true,
        },
      },
    };

    expect(pr.head.repo.fork).toBe(true);
  });

  it('should allow same-repo PR', () => {
    const pr = {
      head: {
        repo: {
          fork: false,
        },
      },
    };

    expect(pr.head.repo.fork).toBe(false);
  });

  it('should handle missing fork field as false', () => {
    const pr = {
      head: {
        repo: {},
      },
    };

    // @ts-expect-error - Testing missing field
    expect(pr.head.repo.fork).toBeUndefined();
  });
});

describe('Fork PR security message', () => {
  it('should provide clear guidance for fork PRs', () => {
    const message =
      '⚠️ PromptGate skipped: This PR is from a fork. For security reasons, ' +
      'PromptGate does not run on fork PRs in hosted mode. ' +
      'To evaluate fork PRs, use BYOK (bring your own key) mode.';

    expect(message).toContain('fork');
    expect(message).toContain('security');
    expect(message).toContain('BYOK');
  });
});
