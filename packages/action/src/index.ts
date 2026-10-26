import * as core from '@actions/core';
import * as github from '@actions/github';
import { DefaultArtifactClient } from '@actions/artifact';
import fs from 'fs/promises';
import path from 'path';
import {
  PromptGateEngine,
  GeminiProvider,
  OpenAIProvider,
  ProxyProvider,
  DEFAULT_TARGET_MODEL,
  DEFAULT_JUDGE_MODEL,
} from '@promptgate/core';
import type { Provider, EvalReport } from '@promptgate/core';
import { formatPRComment } from './comment.js';

async function run() {
  try {
    // Check if this is a fork PR
    const pr = github.context.payload.pull_request;
    if (pr && pr.head.repo.fork) {
      core.warning(
        '⚠️ PromptGate skipped: This PR is from a fork. For security reasons, ' +
        'PromptGate does not run on fork PRs in hosted mode. ' +
        'To evaluate fork PRs, use BYOK (bring your own key) mode.'
      );
      return;
    }

    const configPath = core.getInput('config') || 'promptgate.yaml';
    const baseRef = core.getInput('base-ref') || github.context.payload.pull_request?.base?.sha || 'main';
    const headRef = core.getInput('head-ref') || github.context.sha;
    const uploadResults = core.getBooleanInput('upload-results') || false;
    const apiUrl = core.getInput('api-url') || 'https://promptgate-api.ekansh-gupta.workers.dev';
    const model = core.getInput('model') || DEFAULT_TARGET_MODEL;
    const judgeModel = core.getInput('judge-model') || DEFAULT_JUDGE_MODEL;

    const workspacePath = process.env.GITHUB_WORKSPACE || process.cwd();

    core.info(`Starting PromptGate evaluation...`);
    core.info(`Config: ${configPath}`);
    core.info(`Base: ${baseRef}`);
    core.info(`Head: ${headRef}`);
    core.info(`Target model: ${model}`);
    core.info(`Judge model: ${judgeModel}`);

    const changedFiles = await getChangedFiles(baseRef, headRef);
    core.info(`Changed files: ${changedFiles.length}`);

    const provider = await createProvider(apiUrl);

    const engine = new PromptGateEngine({
      configPath: path.join(workspacePath, configPath),
      provider,
      baseRef,
      headRef,
      changedFiles,
      modelOverride: model,
      judgeModel,
    });

    const report = await engine.run();

    await fs.writeFile(
      'promptgate-report.json',
      JSON.stringify(report, null, 2)
    );

    const artifact = new DefaultArtifactClient();
    await artifact.uploadArtifact(
      'promptgate-report',
      ['promptgate-report.json'],
      '.',
      { retentionDays: 30 }
    );

    if (github.context.payload.pull_request && process.env.GITHUB_TOKEN) {
      await postPRComment(report);
    }

    if (uploadResults && process.env.ACTIONS_ID_TOKEN_REQUEST_URL) {
      await uploadToAPI(report, apiUrl);
    }

    if (report.evaluationError) {
      core.setFailed(`PromptGate evaluation error: ${report.evaluationError}`);
    } else if (!report.passed) {
      core.setFailed('PromptGate evaluation failed: regressions detected');
    } else {
      core.info('✅ All prompts passed evaluation');
    }

    core.setOutput('passed', report.passed);
    core.setOutput('total-cost', report.totalCost.toFixed(4));
  } catch (error: any) {
    core.setFailed(error.message);
  }
}

async function getChangedFiles(baseRef: string, headRef: string): Promise<string[]> {
  const { execSync } = await import('child_process');
  try {
    const output = execSync(`git diff --name-only ${baseRef} ${headRef}`, {
      cwd: process.env.GITHUB_WORKSPACE || process.cwd(),
      encoding: 'utf-8',
    });
    return output.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

async function checkoutRef(ref: string, targetDir: string) {
  const { execSync } = await import('child_process');
  const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
  
  await fs.mkdir(targetDir, { recursive: true });
  
  execSync(`cp -r ${workspace}/. ${targetDir}/`, {
    cwd: workspace,
    stdio: 'inherit',
  });
  
  execSync(`git checkout ${ref}`, {
    cwd: targetDir,
    stdio: 'inherit',
  });
}

async function createProvider(apiUrl: string): Promise<Provider> {
  const geminiKey = process.env.GEMINI_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const openaiBaseUrl = process.env.OPENAI_BASE_URL;

  if (geminiKey) {
    core.info('Using Gemini provider (BYOK)');
    return new GeminiProvider({ apiKey: geminiKey });
  }

  if (openaiKey) {
    core.info('Using OpenAI provider (BYOK)');
    return new OpenAIProvider({
      apiKey: openaiKey,
      baseUrl: openaiBaseUrl,
    });
  }

  const idToken = await core.getIDToken('promptgate');
  if (!idToken) {
    throw new Error(
      'No provider API key configured and OIDC token unavailable. ' +
        'Either add GEMINI_API_KEY or OPENAI_API_KEY to secrets, or enable id-token: write permission.'
    );
  }

  core.info('Using hosted provider mode');
  return new ProxyProvider({ apiUrl, token: idToken });
}

async function postPRComment(report: EvalReport) {
  const token = process.env.GITHUB_TOKEN;
  if (!token || !github.context.payload.pull_request) return;

  const octokit = github.getOctokit(token);
  const comment = formatPRComment(report);

  const { data: comments } = await octokit.rest.issues.listComments({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    issue_number: github.context.payload.pull_request.number,
  });

    const existingComment = comments.find(
    (c: any) => c.user?.type === 'Bot' && c.body?.includes('<!-- promptgate-report -->')
  );

  if (existingComment) {
    await octokit.rest.issues.updateComment({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      comment_id: existingComment.id,
      body: comment,
    });
  } else {
    await octokit.rest.issues.createComment({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      issue_number: github.context.payload.pull_request.number,
      body: comment,
    });
  }
}

async function uploadToAPI(report: EvalReport, apiUrl: string) {
  try {
    const idToken = await core.getIDToken('promptgate');

    const response = await fetch(`${apiUrl}/v1/results`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        repository: github.context.repo.owner + '/' + github.context.repo.repo,
        pr: github.context.payload.pull_request?.number,
        baseRef: report.baseRef,
        headRef: report.headRef,
        report,
      }),
    });

    if (response.ok) {
      core.info('✓ Results uploaded to PromptGate dashboard');
    } else {
      core.warning(`Failed to upload results: ${response.status}`);
    }
  } catch (error: any) {
    core.warning(`Failed to upload results: ${error.message}`);
  }
}

run();
