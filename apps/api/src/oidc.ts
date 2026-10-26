import { jwtVerify, createRemoteJWKSet } from 'jose';
import type { OIDCClaims } from './types.js';

const GITHUB_JWKS_URL = 'https://token.actions.githubusercontent.com/.well-known/jwks';
const GITHUB_ISSUER = 'https://token.actions.githubusercontent.com';

const jwks = createRemoteJWKSet(new URL(GITHUB_JWKS_URL));

export async function verifyGitHubOIDC(token: string): Promise<OIDCClaims> {
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: GITHUB_ISSUER,
      audience: 'promptgate',
    });

    return {
      iss: payload.iss as string,
      sub: payload.sub as string,
      aud: payload.aud as string,
      exp: payload.exp as number,
      iat: payload.iat as number,
      repository: payload.repository as string,
      repository_owner: payload.repository_owner as string,
      repository_id: payload.repository_id as string,
      workflow: payload.workflow as string | undefined,
      ref: payload.ref as string | undefined,
    };
  } catch (error) {
    throw new Error('Invalid OIDC token');
  }
}
