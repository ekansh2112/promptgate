import type {
  ContextFreeScore,
  LLMResponse,
  JudgeResult,
  Provider,
} from './types.js';

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
  headOutput: string
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
      model: 'gemini-2.0-flash-exp',
      prompt: judgePrompt,
      temperature: 0.3,
    });

    if (response.error || response.refusal) {
      throw new Error('Judge call failed');
    }

    const parsed = JSON.parse(response.content);
    
    return {
      preferredVersion:
        parsed.preferred === 'A'
          ? 'base'
          : parsed.preferred === 'B'
          ? 'head'
          : 'tie',
      reasoning: parsed.reasoning || '',
      confidence: parsed.confidence || 0.5,
    };
  } catch (error) {
    return {
      preferredVersion: 'tie',
      reasoning: 'Judge evaluation failed',
      confidence: 0,
    };
  }
}

export async function runBidirectionalJudge(
  provider: Provider,
  rubric: string,
  promptText: string,
  input: Record<string, any>,
  baseOutput: string,
  headOutput: string
): Promise<JudgeResult> {
  const [judge1, judge2] = await Promise.all([
    runPairwiseJudge(provider, rubric, promptText, input, baseOutput, headOutput),
    runPairwiseJudge(provider, rubric, promptText, input, headOutput, baseOutput),
  ]);

  const reverseMapping = {
    base: 'head',
    head: 'base',
    tie: 'tie',
  } as const;

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
