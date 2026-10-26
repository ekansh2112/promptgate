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
} from '@promptgate/core';
import type { Provider, EvalReport } from '@promptgate/core';

async function run() {
  try {
    const configPath = core.getInput('config') || 'promptgate.yaml';
    const baseRef = core.getInput('base-ref') || github.context.payload.pull_request?.base?.sha || 'main';
    const headRef = core.getInput('head-ref') || github.context.sha;
    const uploadResults = core.getBooleanInput('upload-results') || false;
    const apiUrl = core.getInput('api-url') || 'https://promptgate-api.ekansh-gupta.workers.dev';

    const workspacePath = process.env.GITHUB_WORKSPACE || process.cwd();

    core.info(`Starting PromptGate evaluation...`);
    core.info(`Config: ${configPath}`);
    core.info(`Base: ${baseRef}`);
    core.info(`Head: ${headRef}`);

    const changedFiles = await getChangedFiles(baseRef, headRef);
    core.info(`Changed files: ${changedFiles.length}`);

    await checkoutRef(baseRef, '/tmp/promptgate-base');
    await checkoutRef(headRef, '/tmp/promptgate-head');

    const provider = await createProvider(apiUrl);

    const engine = new PromptGateEngine({
      configPath: path.join(workspacePath, configPath),
      baseDir: '/tmp/promptgate-base',
      headDir: '/tmp/promptgate-head',
      provider,
      baseRef,
      headRef,
      changedFiles,
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

    if (!report.passed) {
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

function formatPRComment(report: EvalReport): string {
  const emoji = report.passed ? '✅' : '❌';
  const status = report.passed ? 'PASSED' : 'FAILED';

  let comment = `<!-- promptgate-report -->\n\n`;
  comment += `## ${emoji} PromptGate Evaluation ${status}\n\n`;
  comment += `**Base:** \`${report.baseRef.slice(0, 7)}\` | **Head:** \`${report.headRef.slice(0, 7)}\`\n\n`;

  for (const promptResult of report.prompts) {
    const delta = promptResult.passRateDelta;
    const deltaStr = delta >= 0 ? `+${(delta * 100).toFixed(1)}%` : `${(delta * 100).toFixed(1)}%`;
    const deltaEmoji = delta < -0.05 ? '📉' : delta > 0.05 ? '📈' : '➡️';

    comment += `### ${promptResult.promptName}\n\n`;
    comment += `| Metric | Base | Head | Delta |\n`;
    comment += `|--------|------|------|-------|\n`;
    comment += `| Pass Rate | ${(promptResult.basePassRate * 100).toFixed(1)}% | ${(promptResult.headPassRate * 100).toFixed(1)}% | ${deltaEmoji} ${deltaStr} |\n`;
    comment += `| Avg Latency | ${promptResult.avgLatencyBase.toFixed(0)}ms | ${promptResult.avgLatencyHead.toFixed(0)}ms | ${(promptResult.avgLatencyHead - promptResult.avgLatencyBase).toFixed(0)}ms |\n`;
    comment += `| Cost | $${promptResult.totalCostBase.toFixed(4)} | $${promptResult.totalCostHead.toFixed(4)} | $${(promptResult.totalCostHead - promptResult.totalCostBase).toFixed(4)} |\n`;

    if (promptResult.criticalFailures > 0) {
      comment += `\n⚠️ **${promptResult.criticalFailures} critical failure(s)**\n`;
    }

    if (promptResult.flakyCount > 0) {
      comment += `\n🎲 **${promptResult.flakyCount} flaky case(s)** (non-deterministic outputs)\n`;
    }

    const regressedCases = promptResult.caseResults.filter(
      (c) =>
        c.judgeResult?.preferredVersion === 'base' ||
        (!c.baseContextFree.error && c.headContextFree.error) ||
        (c.baseAssertions.every((a) => a.passed) && c.headAssertions.some((a) => !a.passed))
    );

    if (regressedCases.length > 0) {
      comment += `\n<details>\n<summary>🔍 Regressed Cases (${regressedCases.length})</summary>\n\n`;
      for (const caseResult of regressedCases.slice(0, 3)) {
        comment += `**${caseResult.caseName || 'Unnamed'}**${caseResult.critical ? ' 🔴 CRITICAL' : ''}\n\n`;
        comment += `Base: \`${truncate(caseResult.baseOutput, 100)}\`\n\n`;
        comment += `Head: \`${truncate(caseResult.headOutput, 100)}\`\n\n`;
        if (caseResult.judgeResult) {
          comment += `Judge: ${caseResult.judgeResult.reasoning}\n\n`;
        }
      }
      comment += `</details>\n\n`;
    }
  }

  comment += `\n**Total Cost:** $${report.totalCost.toFixed(4)}\n`;
  comment += `\n_Evaluated at ${new Date(report.timestamp).toLocaleString()}_\n`;

  return comment;
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '...';
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
