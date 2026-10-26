import type { Context } from 'hono';
import type { Env, Session } from './types.js';

export async function createSession(
  c: Context<{ Bindings: Env }>,
  githubId: number,
  username: string
): Promise<string> {
  let user = await c.env.DB.prepare(
    'SELECT id FROM users WHERE github_id = ?'
  )
    .bind(githubId)
    .first<{ id: number }>();

  if (!user) {
    const result = await c.env.DB.prepare(
      'INSERT INTO users (github_id, username) VALUES (?, ?) RETURNING id'
    )
      .bind(githubId, username)
      .first<{ id: number }>();
    user = result!;
  }

  const session: Session = {
    userId: user.id,
    username,
    githubId,
    expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
  };

  const token = await signSession(c.env.SESSION_SECRET, session);
  return token;
}

export async function verifySession(
  secret: string,
  token: string
): Promise<Session | null> {
  try {
    const payload = await verifyJWT(secret, token);
    if (payload.expiresAt < Date.now()) {
      return null;
    }
    return payload as Session;
  } catch {
    return null;
  }
}

async function signSession(secret: string, session: Session): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(session));
  const keyData = encoder.encode(secret);

  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', key, data);
  const signatureHex = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return `${btoa(JSON.stringify(session))}.${signatureHex}`;
}

async function verifyJWT(secret: string, token: string): Promise<any> {
  const [payloadB64, signatureHex] = token.split('.');
  if (!payloadB64 || !signatureHex) {
    throw new Error('Invalid token format');
  }

  const encoder = new TextEncoder();
  const payload = atob(payloadB64);
  const data = encoder.encode(payload);
  const keyData = encoder.encode(secret);

  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );

  const signature = new Uint8Array(
    signatureHex.match(/.{2}/g)!.map((byte) => parseInt(byte, 16))
  );

  const valid = await crypto.subtle.verify('HMAC', key, signature, data);
  if (!valid) {
    throw new Error('Invalid signature');
  }

  return JSON.parse(payload);
}

export async function checkRepoAccess(
  githubId: number,
  repository: string,
  isPrivate: boolean
): Promise<boolean> {
  if (!isPrivate) return true;

  const response = await fetch(
    `https://api.github.com/repos/${repository}/collaborators/${githubId}`,
    {
      headers: {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'PromptGate',
      },
    }
  );

  return response.status === 204;
}
