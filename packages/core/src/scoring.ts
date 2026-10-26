import type {
  ContextFreeScore,
  LLMResponse,
  JudgeResult,
  Provider,
} from './types.js';
import { DEFAULT_JUDGE_MODEL } from './models.js';

export function parseJudgeResponse(content: string): {
  preferred: string;
  reasoning: string;
  confidence: number;
} {
  if (!content || !content.trim()) {
    throw new Error('Empty judge response');
  }

  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  let raw = (fenced ? fenced[1] : content).trim();

  const objectMatch = raw.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    raw = objectMatch[0];
  }

  raw = raw.replace(/,\s*([}\]])/g, '$1');

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    const prefMatch = content.match(
      /preferred["'\s:=]+["']?(A|B|tie|base|head)/i
    );
    if (!prefMatch) {
      throw new Error('Judge response was not valid JSON');
    }
    const reasonMatch = content.match(
      /reasoning["'\s:=]+["']([^"']{1,500})/i
    );
    parsed = {
      preferred: prefMatch[1],
      reasoning: reasonMatch?.[1] || '',
      confidence: 0.5,
    };
  }

  const preferred = String(
    parsed.preferred ?? parsed.winner ?? parsed.choice ?? ''
  ).trim();
  if (!preferred) {
    throw new Error('Judge response missing preferred');
  }

  const confidence = Number(parsed.confidence);
  return {
    preferred,
    reasoning: String(parsed.reasoning ?? ''),
    confidence: Number.isFinite(confidence) ? confidence : 0.5,
  };
}

function mapPreferred(preferred: string): 'base' | 'head' | 'tie' {
  const p = preferred.toLowerCase();
  if (p === 'a' || p === 'base') return 'base';
  if (p === 'b' || p === 'head') return 'head';
  return 'tie';
}

function failedJudge(message: string): JudgeResult {
  return {
    preferredVersion: 'tie',
    reasoning: `Judge evaluation failed: ${message}`,
    confidence: 0,
    error: message,
  };
}

export function computeContextFreeScore(
  response: LLMResponse
): ContextFreeScore {
  let validJson = false;
  try {
    JSON.parse(response.content);
    validJson = true;
  } catch {
    validJson = false;
  }

  return {
    validJson,
    refusal: response.refusal || false,
    error: !!response.error,
    length: response.content.length,
    latencyMs: response.latencyMs,
    cost: response.cost,
  };
}

export async function runPairwiseJudge(
  provider: Provider,
  rubric: string,
  promptText: string,
  input: Record<string, any>,
  baseOutput: string,
  headOutput: string,
  judgeModel: string = DEFAULT_JUDGE_MODEL
): Promise<JudgeResult> {
  const judgePrompt = `You are evaluating two versions of an LLM prompt output. Your task is to determine which version is better or if they are equal.

RUBRIC:
${rubric}

PROMPT BEING EVALUATED:
${promptText}

INPUT:
${JSON.stringify(input, null, 2)}

VERSION A OUTPUT:
${baseOutput}

VERSION B OUTPUT:
${headOutput}

Compare the two outputs based on the rubric. Consider:
- Correctness and accuracy
- Completeness
- Quality and clarity
- Adherence to requirements

Respond in JSON format:
{
  "preferred": "A" | "B" | "tie",
  "reasoning": "Brief explanation of your decision",
  "confidence": 0.0-1.0
}`;

  try {
    const response = await provider.call({
      model: judgeModel,
      prompt: judgePrompt,
      temperature: 0.3,
    });

    if (response.error || response.refusal) {
      return failedJudge(response.error || 'Judge call refused');
    }

    const parsed = parseJudgeResponse(response.content);

    return {
      preferredVersion: mapPreferred(parsed.preferred),
      reasoning: parsed.reasoning || '',
      confidence: parsed.confidence || 0.5,
    };
  } catch (error: any) {
    return failedJudge(error.message || 'Judge evaluation failed');
  }
}

export async function runBidirectionalJudge(
  provider: Provider,
  rubric: string,
  promptText: string,
  input: Record<string, any>,
  baseOutput: string,
  headOutput: string,
  judgeModel: string = DEFAULT_JUDGE_MODEL
): Promise<JudgeResult> {
  const judge1 = await runPairwiseJudge(
    provider,
    rubric,
    promptText,
    input,
    baseOutput,
    headOutput,
    judgeModel
  );
  const judge2 = await runPairwiseJudge(
    provider,
    rubric,
    promptText,
    input,
    headOutput,
    baseOutput,
    judgeModel
  );

  if (judge1.error || judge2.error) {
    return {
      preferredVersion: 'tie',
      reasoning: `inconclusive (judge error). J1: ${judge1.reasoning}. J2: ${judge2.reasoning}`,
      confidence: 0,
      error: judge1.error || judge2.error,
    };
  }

  const reverseMapping: Record<string, 'base' | 'head' | 'tie'> = {
    base: 'head',
    head: 'base',
    tie: 'tie',
  };

  const judge2Reversed = reverseMapping[judge2.preferredVersion];

  if (judge1.preferredVersion === judge2Reversed) {
    return {
      preferredVersion: judge1.preferredVersion,
      reasoning: `Both judges agree: ${judge1.reasoning}`,
      confidence: (judge1.confidence + judge2.confidence) / 2,
    };
  }

  return {
    preferredVersion: 'tie',
    reasoning: `Judges disagree (position bias detected). J1: ${judge1.reasoning}. J2: ${judge2.reasoning}`,
    confidence: 0.5,
  };
}
