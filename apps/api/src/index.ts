import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './types.js';
import llmRoutes from './routes/llm.js';
import resultsRoutes from './routes/results.js';
import authRoutes from './routes/auth.js';
import apiRoutes from './routes/api.js';

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

app.route('/', llmRoutes);
app.route('/', resultsRoutes);
app.route('/', authRoutes);
app.route('/', apiRoutes);

export default app;
