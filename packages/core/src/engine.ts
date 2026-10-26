import fs from 'fs/promises';
import path from 'path';
import YAML from 'yaml';
import type {
  PromptGateConfig,
  PromptConfig,
  TestCase,
  TestSet,
} from './config.js';
import { PromptGateConfigSchema, TestSetSchema } from './config.js';
import type {
  Provider,
  EvalReport,
  PromptResult,
  CaseResult,
  LLMResponse,
} from './types.js';
import { ResponseCache } from './cache.js';
import { checkAssertion } from './assertions.js';
import {
  computeContextFreeScore,
  runBidirectionalJudge,
} from './scoring.js';
import { loadCalibrationLabels, calculateJudgeAgreement } from './calibration.js';

export interface EngineOptions {
  configPath: string;
  provider: Provider;
  baseRef: string;
  headRef: string;
  changedFiles?: string[];
}

export class PromptGateEngine {
  private config!: PromptGateConfig;
  private provider: Provider;
  private cache: ResponseCache;
  private options: EngineOptions;

  constructor(options: EngineOptions) {
    this.options = options;
    this.provider = options.provider;
    this.cache = new ResponseCache();
  }

  async loadConfig(): Promise<void> {
    const configPath = path.join(this.options.configPath);
    const configContent = await fs.readFile(configPath, 'utf-8');
    const rawConfig = YAML.parse(configContent);
    this.config = PromptGateConfigSchema.parse(rawConfig);

    if (this.config.scoring.enableCache !== undefined) {
      this.cache = new ResponseCache(this.config.scoring.enableCache);
    }
  }

  async run(): Promise<EvalReport> {
    await this.loadConfig();

    const promptsToTest = this.getPromptsToTest();
    const results: PromptResult[] = [];

    for (const promptConfig of promptsToTest) {
      const result = await this.evalPrompt(promptConfig);
      if (result !== null) {
        results.push(result);
      }
    }

    const totalCost = results.reduce(
      (sum, r) => sum + r.totalCostBase + r.totalCostHead,
      0
    );

    const passed = results.every(
      (r) =>
        r.criticalFailures === 0 &&
        r.passRateDelta >= -this.config.scoring.passRateThreshold
    );

    let calibrationAgreement: number | undefined;
    let calibrationSampleSize: number | undefined;

    try {
      const labelsPath = path.join(path.dirname(this.options.configPath), 'calibration-labels.yaml');
      const labels = await loadCalibrationLabels(labelsPath);
      
      if (labels.length > 0) {
        // Transform results into format expected by calculateJudgeAgreement
        const judgeResults: Array<{
          caseName: string;
          promptName: string;
          output: string;
          judgePreferred: 'base' | 'head' | 'tie';
          isHead: boolean;
        }> = [];

        for (const promptResult of results) {
          for (const caseResult of promptResult.caseResults) {
            if (caseResult.judgeResult) {
              judgeResults.push({
                caseName: caseResult.caseName || '',
                promptName: promptResult.promptName,
                output: caseResult.headOutput,
                judgePreferred: caseResult.judgeResult.preferredVersion,
                isHead: true,
              });
            }
          }
        }

        const agreement = calculateJudgeAgreement(labels, judgeResults);
        if (agreement > 0) {
          calibrationAgreement = agreement * 100; // Convert to percentage
          calibrationSampleSize = judgeResults.length;
        }
      }
    } catch {
      // Calibration labels optional
    }

    return {
      timestamp: new Date().toISOString(),
      baseRef: this.options.baseRef,
      headRef: this.options.headRef,
      prompts: results,
      passed,
      totalCost,
      calibrationAgreement,
      calibrationSampleSize,
    };
  }

  private getPromptsToTest(): PromptConfig[] {
    if (!this.options.changedFiles || this.options.changedFiles.length === 0) {
      return this.config.prompts;
    }

    return this.config.prompts.filter((p) => {
      const promptChanged = this.options.changedFiles!.includes(p.path);
      const testSetChanged = this.options.changedFiles!.includes(p.testSet);
      return promptChanged || testSetChanged;
    });
  }

  private async evalPrompt(
    promptConfig: PromptConfig
  ): Promise<PromptResult | null> {
    const testSet = await this.loadTestSet(promptConfig.testSet);
    
    // Try git show for base, fall back to file read
    let basePromptText = await this.loadPromptFromRef(
      promptConfig.path,
      this.options.baseRef
    );
    if (!basePromptText) {
      try {
        basePromptText = await this.loadPrompt(promptConfig.path);
      } catch {
        return null;
      }
    }
    
    // For head, read from workspace (current checkout)
    let headPromptText: string | null;
    try {
      headPromptText = await this.loadPrompt(promptConfig.path);
    } catch {
      // Fall back to git show for head
      headPromptText = await this.loadPromptFromRef(
        promptConfig.path,
        this.options.headRef
      );
    }
    
    if (!headPromptText) {
      return null;
    }

    const caseResults: CaseResult[] = [];

    for (const testCase of testSet) {
      const caseResult = await this.evalCase(
        promptConfig,
        testCase,
        basePromptText,
        headPromptText
      );
      caseResults.push(caseResult);
    }

    const passedCases = caseResults.filter(
      (c) =>
        !c.baseContextFree.error &&
        !c.headContextFree.error &&
        c.baseAssertions.every((a) => a.passed) &&
        c.headAssertions.every((a) => a.passed) &&
        (!c.judgeResult || c.judgeResult.preferredVersion !== 'base')
    ).length;

    const criticalFailures = caseResults.filter(
      (c) =>
        c.critical &&
        (c.headContextFree.error ||
          c.headAssertions.some((a) => !a.passed) ||
          c.judgeResult?.preferredVersion === 'base')
    ).length;

    const flakyCount = caseResults.filter((c) => c.flaky).length;

    const basePassRate =
      caseResults.filter(
        (c) =>
          !c.baseContextFree.error &&
          c.baseAssertions.every((a) => a.passed)
      ).length / caseResults.length;

    const headPassRate =
      caseResults.filter(
        (c) =>
          !c.headContextFree.error &&
          c.headAssertions.every((a) => a.passed)
      ).length / caseResults.length;

    const totalCostBase = caseResults.reduce(
      (sum, c) => sum + c.baseContextFree.cost,
      0
    );
    const totalCostHead = caseResults.reduce(
      (sum, c) => sum + c.headContextFree.cost,
      0
    );

    const avgLatencyBase =
      caseResults.reduce((sum, c) => sum + c.baseContextFree.latencyMs, 0) /
      caseResults.length;
    const avgLatencyHead =
      caseResults.reduce((sum, c) => sum + c.headContextFree.latencyMs, 0) /
      caseResults.length;

    return {
      promptName: promptConfig.name,
      promptPath: promptConfig.path,
      model: promptConfig.model,
      totalCases: caseResults.length,
      passedCases,
      failedCases: caseResults.length - passedCases,
      criticalFailures,
      flakyCount,
      basePassRate,
      headPassRate,
      passRateDelta: headPassRate - basePassRate,
      totalCostBase,
      totalCostHead,
      avgLatencyBase,
      avgLatencyHead,
      caseResults,
    };
  }

  private async evalCase(
    promptConfig: PromptConfig,
    testCase: TestCase,
    basePromptText: string,
    headPromptText: string
  ): Promise<CaseResult> {
    const runs = this.config.scoring.runs;
    const baseOutputs: string[] = [];
    const headOutputs: string[] = [];
    let baseResponse!: LLMResponse;
    let headResponse!: LLMResponse;

    for (let i = 0; i < runs; i++) {
      const basePrompt = this.fillPrompt(basePromptText, testCase.inputs);
      const headPrompt = this.fillPrompt(headPromptText, testCase.inputs);

      baseResponse = await this.callLLM(
        promptConfig,
        basePrompt
      );
      headResponse = await this.callLLM(
        promptConfig,
        headPrompt
      );

      baseOutputs.push(baseResponse.content);
      headOutputs.push(headResponse.content);
    }

    const flaky =
      new Set(baseOutputs).size > 1 || new Set(headOutputs).size > 1;

    const baseContextFree = computeContextFreeScore(baseResponse);
    const headContextFree = computeContextFreeScore(headResponse);

    const baseAssertions =
      testCase.assertions?.map((a) =>
        checkAssertion(a as any, baseResponse.content)
      ) || [];
    const headAssertions =
      testCase.assertions?.map((a) =>
        checkAssertion(a as any, headResponse.content)
      ) || [];

    let judgeResult;
    if (
      promptConfig.rubric &&
      !baseResponse.error &&
      !headResponse.error &&
      baseAssertions.every((a) => a.passed) &&
      headAssertions.every((a) => a.passed)
    ) {
      judgeResult = await runBidirectionalJudge(
        this.provider,
        promptConfig.rubric,
        headPromptText,
        testCase.inputs,
        baseResponse.content,
        headResponse.content
      );
    }

    return {
      caseName: testCase.name,
      inputs: testCase.inputs,
      critical: testCase.critical,
      baseOutput: baseResponse.content,
      headOutput: headResponse.content,
      baseContextFree,
      headContextFree,
      baseAssertions,
      headAssertions,
      judgeResult,
      flaky,
      runs,
    };
  }

  private async callLLM(
    config: PromptConfig,
    prompt: string
  ): Promise<LLMResponse> {
    const hash = this.cache.hash(
      prompt,
      config.model,
      config.systemPrompt,
      config.temperature,
      config.maxTokens
    );

    const cached = this.cache.get(hash);
    if (cached) {
      return cached;
    }

    const response = await this.provider.call({
      model: config.model,
      prompt,
      systemPrompt: config.systemPrompt,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
    });

    this.cache.set(hash, response);
    return response;
  }

  private fillPrompt(
    template: string,
    inputs: Record<string, any>
  ): string {
    let result = template;
    for (const [key, value] of Object.entries(inputs)) {
      const placeholder = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      result = result.replace(placeholder, String(value));
    }
    return result;
  }

  private async loadPrompt(filePath: string): Promise<string> {
    return fs.readFile(filePath, 'utf-8');
  }

  private async loadPromptFromRef(promptPath: string, ref: string): Promise<string | null> {
    const { execSync } = await import('child_process');
    try {
      const output = execSync(`git show ${ref}:${promptPath}`, {
        cwd: process.cwd(),
        encoding: 'utf-8',
      });
      return output;
    } catch (error: any) {
      return null;
    }
  }

  private async loadTestSet(filePath: string): Promise<TestSet> {
    const content = await fs.readFile(filePath, 'utf-8');
    const parsed = YAML.parse(content);
    return TestSetSchema.parse(parsed);
  }
}
