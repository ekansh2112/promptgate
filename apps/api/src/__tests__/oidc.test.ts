import { describe, it, expect, vi, beforeEach } from 'vitest';
import { verifyGitHubOIDC } from '../oidc.js';
import { jwtVerify } from 'jose';

vi.mock('jose', () => ({
  jwtVerify: vi.fn(),
  createRemoteJWKSet: vi.fn(() => 'mock-jwks'),
}));

describe('OIDC verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should verify valid GitHub OIDC token', async () => {
    (jwtVerify as any).mockResolvedValue({
      payload: {
        iss: 'https://token.actions.githubusercontent.com',
        sub: 'repo:owner/repo:ref:refs/heads/main',
        aud: 'promptgate',
        exp: Date.now() / 1000 + 3600,
        iat: Date.now() / 1000,
        repository: 'owner/repo',
        repository_owner: 'owner',
        repository_id: '123456',
        workflow: 'CI',
        ref: 'refs/heads/main',
      },
    });

    const result = await verifyGitHubOIDC('mock-token');

    expect(result.repository).toBe('owner/repo');
    expect(result.repository_owner).toBe('owner');
    expect(result.iss).toBe('https://token.actions.githubusercontent.com');
  });

  it('should reject invalid token', async () => {
    (jwtVerify as any).mockRejectedValue(new Error('Invalid signature'));

    await expect(verifyGitHubOIDC('invalid-token')).rejects.toThrow(
      'Invalid OIDC token'
    );
  });

  it('should verify token with correct issuer and audience', async () => {
    (jwtVerify as any).mockImplementation(
      async (token: string, jwks: any, options: any) => {
        expect(options.issuer).toBe('https://token.actions.githubusercontent.com');
        expect(options.audience).toBe('promptgate');
        return {
          payload: {
            iss: 'https://token.actions.githubusercontent.com',
            aud: 'promptgate',
            repository: 'owner/repo',
            repository_owner: 'owner',
            repository_id: '123',
            sub: 'test',
            exp: Date.now() / 1000 + 3600,
            iat: Date.now() / 1000,
          },
        };
      }
    );

    const result = await verifyGitHubOIDC('mock-token');
    expect(result.repository).toBe('owner/repo');
  });
});
