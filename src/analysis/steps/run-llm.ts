import { callMoonshotAI, type AnalysisOutput, type MoonshotResult } from '../../moonshot';
import { demoteVocCdcMulesoftBugs } from '../../render';

export async function runLlmAnalysis(
  promptChangeList: Record<string, unknown>[],
  prTitle: string,
  repoFullName: string,
  prId: number,
  skipInputRateLimit: boolean,
): Promise<MoonshotResult> {
  if (skipInputRateLimit) {
    console.warn(
      `[analyze] Input rate limit triggered (${promptChangeList.length} files). Skipping LLM call.`,
    );
    return {
      rawText: '',
      structured: null,
      parseError: 'input_rate_limit',
      quotaExceeded: true,
      tokenUsage: [],
    };
  }

  const prompt =
    'Review these changes for functional, CONFIRMED bugs. Focus on behavior changes or parameter mismatches that will cause runtime errors or incorrect behavior.';

  const analysis = await callMoonshotAI(prompt, promptChangeList, {
    prTitle,
    repoFullName,
    prId,
  });
  if (analysis.structured) {
    analysis.structured = demoteVocCdcMulesoftBugs(analysis.structured) as AnalysisOutput;
  }
  console.log(`[analyze] Moonshot analysis length: ${analysis.rawText.length} chars`);
  return analysis;
}
