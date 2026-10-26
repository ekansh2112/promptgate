import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './types.js';
import { verifyGitHubOIDC } from './oidc.js';
import {
  checkQuota,
  incrementQuota,
  validateModel,
  validatePromptSize,
} from './quota.js';
import { createSession, verifySession, checkRepoAccess } from './auth.js';

const app = new Hono<{ Bindings: Env }>();

app.use(
  '*',
  cors({
    origin: ['https://promptgate-dashboard.pages.dev', 'http://localhost:5173'],
    credentials: true,
  })
);

app.get('/', (c) => {
  return c.json({
    name: 'PromptGate API',
    version: '1.0.0',
    status: 'ok',
  });
});

app.get('/health', (c) => {
  return c.json({ status: 'healthy', timestamp: Date.now() });
});

app.post('/v1/llm', async (c) => {
  try {
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: 'Missing authorization' }, 401);
    }

    const token = authHeader.slice(7);
    const claims = await verifyGitHubOIDC(token);

    const { model, prompt, systemPrompt, temperature, maxTokens } =
      await c.req.json();

    if (!validateModel(model)) {
      return c.json(
        {
          error: `Model ${model} not allowed. Allowed models: gemini-2.0-flash-exp, gemini-1.5-flash, gemini-1.5-flash-8b`,
        },
        400
      );
    }

    if (!validatePromptSize(prompt)) {
      return c.json(
        { error: 'Prompt exceeds maximum size of 50,000 characters' },
        400
      );
    }

    const quotaCheck = await checkQuota(c.env, claims.repository);
    if (!quotaCheck.allowed) {
      return c.json({ error: quotaCheck.reason }, 429);
    }

    const hash = await hashRequest(model, prompt, systemPrompt);
    const cached = await c.env.DB.prepare(
      'SELECT response FROM cache WHERE hash = ?'
    )
      .bind(hash)
      .first<{ response: string }>();

    if (cached) {
      return c.json(JSON.parse(cached.response));
    }

    const startTime = Date.now();
    const response = await callGemini(
      c.env,
      model,
      prompt,
      systemPrompt,
      temperature,
      maxTokens
    );
    const latencyMs = Date.now() - startTime;

    const result = {
      content: response.content,
      latencyMs,
      cost: response.cost,
      refusal: response.refusal,
      error: response.error,
    };

    await c.env.DB.prepare(
      'INSERT INTO cache (hash, response) VALUES (?, ?)'
    )
      .bind(hash, JSON.stringify(result))
      .run();

    const tokens = estimateTokens(prompt) + estimateTokens(response.content);
    await incrementQuota(c.env, claims.repository, tokens);

    return c.json(result);
  } catch (error: any) {
    console.error('LLM proxy error:', error);
    return c.json({ error: error.message || 'Internal server error' }, 500);
  }
});

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

    let repo = await c.env.DB.prepare(
      'SELECT id FROM repositories WHERE full_name = ?'
    )
      .bind(repository)
      .first<{ id: number }>();

    if (!repo) {
      const result = await c.env.DB.prepare(
        'INSERT INTO repositories (full_name, is_private) VALUES (?, 0) RETURNING id'
      )
        .bind(repository)
        .first<{ id: number }>();
      repo = result!;
    }

    const runResult = await c.env.DB.prepare(
      `INSERT INTO runs (repository_id, pr_number, base_ref, head_ref, passed, total_cost, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`
    )
      .bind(
        repo.id,
        pr || null,
        baseRef,
        headRef,
        report.passed ? 1 : 0,
        report.totalCost,
        report.timestamp
      )
      .first<{ id: number }>();

    for (const promptResult of report.prompts) {
      const promptResultRow = await c.env.DB.prepare(
        `INSERT INTO prompt_results (
          run_id, prompt_name, prompt_path, model, total_cases, passed_cases,
          failed_cases, critical_failures, flaky_count, base_pass_rate,
          head_pass_rate, pass_rate_delta, total_cost_base, total_cost_head,
          avg_latency_base, avg_latency_head
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
      )
        .bind(
          runResult!.id,
          promptResult.promptName,
          promptResult.promptPath,
          promptResult.model,
          promptResult.totalCases,
          promptResult.passedCases,
          promptResult.failedCases,
          promptResult.criticalFailures,
          promptResult.flakyCount,
          promptResult.basePassRate,
          promptResult.headPassRate,
          promptResult.passRateDelta,
          promptResult.totalCostBase,
          promptResult.totalCostHead,
          promptResult.avgLatencyBase,
          promptResult.avgLatencyHead
        )
        .first<{ id: number }>();

      for (const caseResult of promptResult.caseResults) {
        await c.env.DB.prepare(
          `INSERT INTO case_results (
            prompt_result_id, case_name, inputs, critical, base_output,
            head_output, flaky, judge_result
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(
            promptResultRow!.id,
            caseResult.caseName || null,
            JSON.stringify(caseResult.inputs),
            caseResult.critical ? 1 : 0,
            trimOutput(caseResult.baseOutput),
            trimOutput(caseResult.headOutput),
            caseResult.flaky ? 1 : 0,
            caseResult.judgeResult ? JSON.stringify(caseResult.judgeResult) : null
          )
          .run();
      }
    }

    return c.json({ success: true, runId: runResult!.id });
  } catch (error: any) {
    console.error('Results upload error:', error);
    return c.json({ error: error.message || 'Internal server error' }, 500);
  }
});

app.get('/auth/github', (c) => {
  const clientId = c.env.GITHUB_OAUTH_CLIENT_ID;
  const redirectUri = 'https://promptgate-api.ekansh-gupta.workers.dev/auth/github/callback';
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

    const tokenData = await tokenResponse.json<{ access_token?: string }>();
    if (!tokenData.access_token) {
      return c.json({ error: 'Failed to get access token' }, 500);
    }

    const userResponse = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    const userData = await userResponse.json<{ id: number; login: string }>();

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

app.get('/api/repos', async (c) => {
  const sessionToken = c.req.header('Authorization')?.slice(7);
  if (!sessionToken) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const session = await verifySession(c.env.SESSION_SECRET, sessionToken);
  if (!session) {
    return c.json({ error: 'Invalid session' }, 401);
  }

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
    const hasAccess = await checkRepoAccess(
      session.githubId,
      repo.full_name,
      repo.is_private === 1
    );
    if (hasAccess) {
      accessible.push(repo);
    }
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

async function callGemini(
  env: Env,
  model: string,
  prompt: string,
  systemPrompt?: string,
  temperature?: number,
  maxTokens?: number
): Promise<{
  content: string;
  cost: number;
  refusal?: boolean;
  error?: string;
}> {
  const contents = [];

  if (systemPrompt) {
    contents.push({
      role: 'user',
      parts: [{ text: systemPrompt }],
    });
    contents.push({
      role: 'model',
      parts: [{ text: 'Understood.' }],
    });
  }

  contents.push({
    role: 'user',
    parts: [{ text: prompt }],
  });

  const requestBody: any = {
    contents,
    generationConfig: {},
  };

  if (temperature !== undefined) {
    requestBody.generationConfig.temperature = temperature;
  }

  if (maxTokens) {
    requestBody.generationConfig.maxOutputTokens = maxTokens;
  }

  const baseUrl = env.AI_GATEWAY_URL || 'https://generativelanguage.googleapis.com/v1beta';

  const response = await fetch(
    `${baseUrl}/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errorText}`);
  }

  const data = await response.json<any>();

  if (
    data.promptFeedback?.blockReason ||
    !data.candidates ||
    data.candidates.length === 0
  ) {
    return { content: '', cost: 0, refusal: true };
  }

  const text = data.candidates[0].content?.parts?.[0]?.text || '';
  const inputTokens = estimateTokens(prompt);
  const outputTokens = estimateTokens(text);
  const cost = estimateCost(model, inputTokens, outputTokens);

  return { content: text, cost };
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const rates: Record<string, { input: number; output: number }> = {
    'gemini-2.0-flash-exp': { input: 0, output: 0 },
    'gemini-1.5-flash': { input: 0.075, output: 0.3 },
    'gemini-1.5-flash-8b': { input: 0.0375, output: 0.15 },
  };

  const rate = rates[model] || rates['gemini-1.5-flash'];
  return (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000;
}

async function hashRequest(
  model: string,
  prompt: string,
  systemPrompt?: string
): Promise<string> {
  const data = JSON.stringify({ model, prompt, systemPrompt });
  const encoder = new TextEncoder();
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(data));
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function trimOutput(output: string, maxLength = 10_000): string {
  if (output.length <= maxLength) return output;
  return output.slice(0, maxLength) + '... [truncated]';
}

export default app;
