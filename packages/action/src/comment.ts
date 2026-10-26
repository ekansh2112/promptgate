import type { EvalReport } from '@promptgate/core';

export function formatPRComment(report: EvalReport): string {
  let comment = `<!-- promptgate-report -->\n\n`;

  if (report.evaluationError) {
    comment += `## ❌ PromptGate Evaluation Error\n\n`;
    comment += `**evaluation error:** ${report.evaluationError}\n\n`;
    comment += `Every test case failed before scoring. This is not a prompt regression — the LLM provider returned errors for all cases.\n\n`;
    comment += `**Base:** \`${report.baseRef.slice(0, 7)}\` | **Head:** \`${report.headRef.slice(0, 7)}\`\n`;
    comment += `\n_Evaluated at ${new Date(report.timestamp).toLocaleString()}_\n`;
    return comment;
  }

  const emoji = report.passed ? '✅' : '❌';
  const status = report.passed ? 'PASSED' : 'FAILED';

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

    const casesToShow =
      regressedCases.length > 0
        ? regressedCases.slice(0, 3)
        : promptResult.caseResults.slice(0, 2);

    if (casesToShow.length > 0) {
      const heading =
        regressedCases.length > 0
          ? `🔍 Regressed Cases (${regressedCases.length})`
          : `🔍 Sample Cases (${casesToShow.length})`;
      comment += `\n<details>\n<summary>${heading}</summary>\n\n`;
      for (const caseResult of casesToShow) {
        comment += `**${caseResult.caseName || 'Unnamed'}**${caseResult.critical ? ' 🔴 CRITICAL' : ''}\n\n`;
        comment += `Base: \`${truncate(caseResult.baseOutput, 180)}\`\n\n`;
        comment += `Head: \`${truncate(caseResult.headOutput, 180)}\`\n\n`;
        if (caseResult.judgeResult) {
          comment += `Judge (${caseResult.judgeResult.preferredVersion}): ${caseResult.judgeResult.reasoning}\n\n`;
        }
      }
      comment += `</details>\n\n`;
    }
  }

  comment += `\n**Total Cost:** $${report.totalCost.toFixed(4)}\n`;

  if (report.calibrationAgreement !== undefined && report.calibrationSampleSize !== undefined) {
    comment += `\n**Judge Calibration:** ${report.calibrationAgreement.toFixed(1)}% agreement (${report.calibrationSampleSize} labeled cases)\n`;
  }

  comment += `\n_Evaluated at ${new Date(report.timestamp).toLocaleString()}_\n`;

  return comment;
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '...';
}
