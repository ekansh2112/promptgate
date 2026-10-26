import { Hono } from 'hono';
import type { Env } from '../types.js';
import { verifyGitHubOIDC } from '../oidc.js';
import { saveEvalResults } from '../lib/db.js';

const app = new Hono<{ Bindings: Env }>();

app.post('/v1/results', async (c) => {
  try {
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: 'Missing authorization' }, 401);
    }

    const token = authHeader.slice(7);
    const claims = await verifyGitHubOIDC(token);

    const { repository, pr, baseRef, headRef, report } = await c.req.json();

    if (claims.repository !== repository) {
      return c.json({ error: 'Repository mismatch' }, 403);
    }

    const runId = await saveEvalResults(
      c.env,
      repository,
      pr,
      baseRef,
      headRef,
      report
    );

    return c.json({ success: true, runId });
  } catch (error: any) {
    console.error('Results upload error:', error);
    return c.json({ error: error.message || 'Internal server error' }, 500);
  }
});

export default app;
