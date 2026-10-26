import { Hono } from 'hono';
import type { Env } from '../types.js';
import { verifySession, checkRepoAccess } from '../auth.js';

const app = new Hono<{ Bindings: Env }>();

app.get('/api/repos', async (c) => {
  const sessionToken = c.req.header('Authorization')?.slice(7);
  const session = sessionToken
    ? await verifySession(c.env.SESSION_SECRET, sessionToken)
    : null;

  const repos = await c.env.DB.prepare(
    `SELECT DISTINCT r.id, r.full_name, r.is_private, 
     COUNT(runs.id) as run_count, MAX(runs.created_at) as last_run
     FROM repositories r
     LEFT JOIN runs ON runs.repository_id = r.id
     GROUP BY r.id
     ORDER BY last_run DESC NULLS LAST`
  ).all<{
    id: number;
    full_name: string;
    is_private: number;
    run_count: number;
    last_run: number | null;
  }>();

  const accessible = [];
  for (const repo of repos.results) {
    if (repo.is_private === 1) {
      if (!session) continue;
      const hasAccess = await checkRepoAccess(
        session.githubId,
        repo.full_name,
        true
      );
      if (!hasAccess) continue;
    }
    accessible.push(repo);
  }

  return c.json({ repositories: accessible });
});

app.get('/api/repos/:owner/:name/runs', async (c) => {
  const owner = c.req.param('owner');
  const name = c.req.param('name');
  const repository = `${owner}/${name}`;

  const repo = await c.env.DB.prepare(
    'SELECT id, is_private FROM repositories WHERE full_name = ?'
  )
    .bind(repository)
    .first<{ id: number; is_private: number }>();

  if (!repo) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  if (repo.is_private) {
    const sessionToken = c.req.header('Authorization')?.slice(7);
    if (!sessionToken) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const session = await verifySession(c.env.SESSION_SECRET, sessionToken);
    if (!session) {
      return c.json({ error: 'Invalid session' }, 401);
    }

    const hasAccess = await checkRepoAccess(
      session.githubId,
      repository,
      true
    );
    if (!hasAccess) {
      return c.json({ error: 'Forbidden' }, 403);
    }
  }

  const runs = await c.env.DB.prepare(
    `SELECT id, pr_number, base_ref, head_ref, passed, total_cost, timestamp, created_at
     FROM runs
     WHERE repository_id = ?
     ORDER BY created_at DESC
     LIMIT 100`
  )
    .bind(repo.id)
    .all();

  return c.json({ runs: runs.results });
});

app.get('/api/repos/:owner/:name/runs/:runId/details', async (c) => {
  const owner = c.req.param('owner');
  const name = c.req.param('name');
  const runId = c.req.param('runId');
  const repository = `${owner}/${name}`;

  const repo = await c.env.DB.prepare(
    'SELECT id, is_private FROM repositories WHERE full_name = ?'
  )
    .bind(repository)
    .first<{ id: number; is_private: number }>();

  if (!repo) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  if (repo.is_private) {
    const sessionToken = c.req.header('Authorization')?.slice(7);
    if (!sessionToken) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const session = await verifySession(c.env.SESSION_SECRET, sessionToken);
    if (!session) {
      return c.json({ error: 'Invalid session' }, 401);
    }

    const hasAccess = await checkRepoAccess(
      session.githubId,
      repository,
      true
    );
    if (!hasAccess) {
      return c.json({ error: 'Forbidden' }, 403);
    }
  }

  const run = await c.env.DB.prepare(
    'SELECT * FROM runs WHERE id = ? AND repository_id = ?'
  )
    .bind(runId, repo.id)
    .first();

  if (!run) {
    return c.json({ error: 'Run not found' }, 404);
  }

  const prompts = await c.env.DB.prepare(
    'SELECT * FROM prompt_results WHERE run_id = ?'
  )
    .bind(runId)
    .all();

  const promptsWithCases = await Promise.all(
    prompts.results.map(async (prompt: any) => {
      const cases = await c.env.DB.prepare(
        'SELECT * FROM case_results WHERE prompt_result_id = ?'
      )
        .bind(prompt.id)
        .all();

      return {
        ...prompt,
        cases: cases.results.map((c: any) => ({
          ...c,
          inputs: JSON.parse(c.inputs),
          judge_result: c.judge_result ? JSON.parse(c.judge_result) : null,
        })),
      };
    })
  );

  return c.json({
    run,
    prompts: promptsWithCases,
    calibrationAgreement: (run as any).calibration_agreement ?? null,
    calibrationSampleSize: (run as any).calibration_sample_size ?? null,
  });
});

app.get('/api/repos/:owner/:name/prompts/:promptName/trend', async (c) => {
  const owner = c.req.param('owner');
  const name = c.req.param('name');
  const promptName = decodeURIComponent(c.req.param('promptName'));
  const repository = `${owner}/${name}`;

  const repo = await c.env.DB.prepare(
    'SELECT id, is_private FROM repositories WHERE full_name = ?'
  )
    .bind(repository)
    .first<{ id: number; is_private: number }>();

  if (!repo) {
    return c.json({ error: 'Repository not found' }, 404);
  }

  if (repo.is_private) {
    const sessionToken = c.req.header('Authorization')?.slice(7);
    if (!sessionToken) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const session = await verifySession(c.env.SESSION_SECRET, sessionToken);
    if (!session) {
      return c.json({ error: 'Invalid session' }, 401);
    }

    const hasAccess = await checkRepoAccess(
      session.githubId,
      repository,
      true
    );
    if (!hasAccess) {
      return c.json({ error: 'Forbidden' }, 403);
    }
  }

  const trend = await c.env.DB.prepare(
    `SELECT pr.run_id, pr.head_pass_rate, pr.base_pass_rate, r.timestamp, r.pr_number
     FROM prompt_results pr
     JOIN runs r ON pr.run_id = r.id
     WHERE r.repository_id = ? AND pr.prompt_name = ?
     ORDER BY r.created_at ASC
     LIMIT 50`
  )
    .bind(repo.id, promptName)
    .all();

  const dataPoints = (trend.results || []).map((row: any) => ({
    run_id: row.run_id,
    timestamp: row.timestamp,
    head_pass_rate: row.head_pass_rate,
    base_pass_rate: row.base_pass_rate,
    pr_number: row.pr_number,
  }));

  return c.json({ dataPoints, trend: dataPoints });
});

export default app;
