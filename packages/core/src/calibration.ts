import fs from 'fs/promises';
import YAML from 'yaml';
import { z } from 'zod';

export const CalibrationLabelSchema = z.object({
  promptName: z.string(),
  caseName: z.string(),
  output: z.string(),
  label: z.enum(['good', 'bad']),
});

export type CalibrationLabel = z.infer<typeof CalibrationLabelSchema>;

export const CalibrationFileSchema = z.array(CalibrationLabelSchema);

export async function loadCalibrationLabels(
  filePath: string
): Promise<CalibrationLabel[]> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const parsed = YAML.parse(content);
    return CalibrationFileSchema.parse(parsed);
  } catch (error) {
    return [];
  }
}

export function calculateJudgeAgreement(
  labels: CalibrationLabel[],
  judgeResults: Array<{
    caseName: string;
    promptName: string;
    output: string;
    judgePreferred: 'base' | 'head' | 'tie';
    isHead: boolean;
  }>
): number {
  if (labels.length === 0 || judgeResults.length === 0) {
    return 0;
  }

  let agreements = 0;
  let comparisons = 0;

  for (const result of judgeResults) {
    const label = labels.find(
      (l) =>
        l.promptName === result.promptName &&
        l.caseName === result.caseName &&
        l.output === result.output
    );

    if (!label) continue;

    comparisons++;

    const humanSaysGood = label.label === 'good';
    const judgeSaysGood =
      (result.isHead && result.judgePreferred === 'head') ||
      (!result.isHead && result.judgePreferred === 'base') ||
      result.judgePreferred === 'tie';

    if (humanSaysGood === judgeSaysGood) {
      agreements++;
    }
  }

  if (comparisons === 0) return 0;
  return agreements / comparisons;
}
