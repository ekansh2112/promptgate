import { Hono } from 'hono';
import type { Env } from '../types.js';
import { verifyGitHubOIDC } from '../oidc.js';
import {
  checkQuota,
  incrementQuota,
  validateModel,
  validatePromptSize,
} from '../quota.js';
import { callGemini, estimateTokens, hashRequest } from '../lib/llm.js';

const app = new Hono<{ Bindings: Env }>();

app.post('/v1/llm', async (c) => {
  try {
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: 'Missing authorization' }, 401);
    }

    const token = authHeader.slice(7);
    
    let claims;
    try {
      claims = await verifyGitHubOIDC(token);
    } catch (error: any) {
      if (error.message === 'Invalid OIDC token') {
        return c.json({
          error: 'Fork PRs cannot use hosted mode. Please add GEMINI_API_KEY or OPENAI_API_KEY to your repository secrets to use your own API key (BYOK).',
        }, 403);
      }
      throw error;
    }

    const { model, prompt, systemPrompt, temperature, maxTokens } =
      await c.req.json();

    if (!validateModel(model)) {
      return c.json(
        {
          error: `Model ${model} not allowed in hosted mode. Allowed models: gemini-2.0-flash, gemini-2.5-flash, gemini-1.5-flash, gemini-1.5-flash-8b. For other models, add your own API key (BYOK).`,
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

export default app;
