export interface Env {
  DB: D1Database;
  GEMINI_API_KEY: string;
  GITHUB_OAUTH_CLIENT_SECRET: string;
  GITHUB_OAUTH_CLIENT_ID: string;
  SESSION_SECRET: string;
  AI_GATEWAY_URL?: string;
}

export interface Session {
  userId: number;
  username: string;
  githubId: number;
  expiresAt: number;
}

export interface QuotaUsage {
  repository: string;
  date: string;
  callCount: number;
  tokenCount: number;
}

export interface OIDCClaims {
  iss: string;
  sub: string;
  aud: string;
  exp: number;
  iat: number;
  repository: string;
  repository_owner: string;
  repository_id: string;
  workflow?: string;
  ref?: string;
}
