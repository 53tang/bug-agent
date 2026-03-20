import { z } from 'zod';

/** One reported bug aligned with prompts/code-review-system.txt */
export const bugSchema = z.object({
  title: z.string().optional(),
  issue: z.string().optional(),
  description: z.string().optional(),
  filePath: z.string().optional(),
  file: z.string().optional(),
  lineHint: z.string().optional(),
  risk: z.string().optional(),
  codeSnippet: z.string().optional(),
});

/** Speculative or ruled-out items (e.g. reason "speculative") */
export const notBugSchema = z.object({
  topic: z.string().optional(),
  reason: z.string().optional(),
});

/** Full LLM JSON shape: summary + bugs + notBugs */
export const analysisOutputSchema = z.object({
  summary: z.string().describe('Short sentence summarizing the review'),
  bugs: z.array(bugSchema).max(3),
  notBugs: z.array(notBugSchema),
});

export type AnalysisOutput = z.infer<typeof analysisOutputSchema>;
