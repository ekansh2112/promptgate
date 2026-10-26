import type { Env } from '../types.js';

export function trimOutput(output: string, maxLength = 10_000): string {
  if (output.length <= maxLength) return output;
  return output.slice(0, maxLength) + '... [truncated]';
}

export async function getOrCreateRepository(
  env: Env,
  repository: string,
  isPrivate = false
): Promise<{ id: number }> {
  let repo = await env.DB.prepare(
    'SELECT id FROM repositories WHERE full_name = ?'
  )
    .bind(repository)
    .first<{ id: number }>();

  if (!repo) {
    const result = await env.DB.prepare(
      'INSERT INTO repositories (full_name, is_private) VALUES (?, ?) RETURNING id'
    )
      .bind(repository, isPrivate ? 1 : 0)
      .first<{ id: number }>();
    repo = result!;
  }

  return repo;
}

export async function saveEvalResults(
  env: Env,
  repository: string,
  pr: number | null,
  baseRef: string,
  headRef: string,
  report: any
): Promise<number> {
  const repo = await getOrCreateRepository(env, repository);

  const runResult = await env.DB.prepare(
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
    const promptResultRow = await env.DB.prepare(
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
      await env.DB.prepare(
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
          caseResult.judgeResult
            ? JSON.stringify(caseResult.judgeResult)
            : null
        )
        .run();
    }
  }

  return runResult!.id;
}
