export interface LLMResponse {
  content: string;
  latencyMs: number;
  cost: number;
  error?: string;
  refusal?: boolean;
}

export interface ModelCall {
  model: string;
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface Provider {
  name: string;
  call(params: ModelCall): Promise<LLMResponse>;
  estimateCost(model: string, inputTokens: number, outputTokens: number): number;
}

export type Assertion =
  | { type: 'contains'; value: string }
  | { type: 'not_contains'; value: string }
  | { type: 'regex'; pattern: string }
  | { type: 'json_equals'; path: string; value: any }
  | { type: 'json_in'; path: string; values: any[] }
  | { type: 'length_min'; value: number }
  | { type: 'length_max'; value: number };

export interface ContextFreeScore {
  validJson: boolean;
  jsonSchemaMatch?: boolean;
  refusal: boolean;
  error: boolean;
  length: number;
  latencyMs: number;
  cost: number;
}

export interface AssertionResult {
  type: string;
  passed: boolean;
  expected?: any;
  actual?: any;
  message?: string;
}

export interface JudgeResult {
  preferredVersion: 'base' | 'head' | 'tie';
  reasoning: string;
  confidence: number;
}

export interface CaseResult {
  caseName?: string;
  inputs: Record<string, any>;
  critical: boolean;
  baseOutput: string;
  headOutput: string;
  baseContextFree: ContextFreeScore;
  headContextFree: ContextFreeScore;
  baseAssertions: AssertionResult[];
  headAssertions: AssertionResult[];
  judgeResult?: JudgeResult;
  flaky: boolean;
  runs: number;
}

export interface PromptResult {
  promptName: string;
  promptPath: string;
  model: string;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  criticalFailures: number;
  flakyCount: number;
  basePassRate: number;
  headPassRate: number;
  passRateDelta: number;
  totalCostBase: number;
  totalCostHead: number;
  avgLatencyBase: number;
  avgLatencyHead: number;
  judgeAgreement?: number;
  caseResults: CaseResult[];
}

export interface EvalReport {
  timestamp: string;
  baseRef: string;
  headRef: string;
  prompts: PromptResult[];
  passed: boolean;
  totalCost: number;
  calibrationAgreement?: number;
  calibrationSampleSize?: number;
}

export interface CacheEntry {
  hash: string;
  response: LLMResponse;
  timestamp: number;
}
