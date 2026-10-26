import { Hono } from 'hono';
import type { Env } from '../types.js';
import { createSession } from '../auth.js';

const app = new Hono<{ Bindings: Env }>();

app.get('/auth/github', (c) => {
  const clientId = c.env.GITHUB_OAUTH_CLIENT_ID;
  const redirectUri =
    'https://promptgate-api.ekansh-gupta.workers.dev/auth/github/callback';
  const scope = 'read:user';

  const authUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}`;

  return c.redirect(authUrl);
});

app.get('/auth/github/callback', async (c) => {
  try {
    const code = c.req.query('code');
    if (!code) {
      return c.json({ error: 'Missing code parameter' }, 400);
    }

    const tokenResponse = await fetch(
      'https://github.com/login/oauth/access_token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          client_id: c.env.GITHUB_OAUTH_CLIENT_ID,
          client_secret: c.env.GITHUB_OAUTH_CLIENT_SECRET,
          code,
        }),
      }
    );

    const tokenData = (await tokenResponse.json()) as { access_token?: string };
    if (!tokenData.access_token) {
      return c.json({ error: 'Failed to get access token' }, 500);
    }

    const userResponse = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    const userData = (await userResponse.json()) as { id: number; login: string };

    const sessionToken = await createSession(c, userData.id, userData.login);

    return c.html(`
      <!DOCTYPE html>
      <html>
      <head><title>Login Successful</title></head>
      <body>
        <script>
          localStorage.setItem('promptgate_session', '${sessionToken}');
          window.location.href = 'https://promptgate-dashboard.pages.dev';
        </script>
      </body>
      </html>
    `);
  } catch (error: any) {
    console.error('OAuth error:', error);
    return c.json({ error: 'Authentication failed' }, 500);
  }
});

export default app;
