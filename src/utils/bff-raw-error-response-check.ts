import { createMoonshotAI } from '@ai-sdk/moonshotai';
import { generateText, Output } from 'ai';
import { z } from 'zod';
import { getEnv, MOONSHOT_MODEL, MOONSHOT_TEMPERATURE } from '../config';
import type { FileDiff } from '../diff';
import type { BffRawErrorLeakCheckResult, BffRawErrorLeakViolation } from '../analysis/types';

const MOONSHOT_API_BASE_URL = 'https://api.moonshot.cn/v1';

const BFF_ERROR_LEAK_PROMPT = `You are a security code reviewer. You will be given unified diffs for files under src/bff/.

Your task: find catch blocks (or error-handling code) in the ADDED lines (+) where the raw caught error object is returned or serialized directly to an API/HTTP response. This leaks sensitive internals such as API keys, auth headers, or stack traces embedded in Error objects.

Flag a violation when an added line in a catch block does any of the following with the caught variable:
- JSON.stringify(err) / JSON.stringify(error) — serializing the whole error
- body: err / body: error — assigning the raw object to a response body field
- data: err / data: error — same
- return err / return error — returning the raw object
- res.json(err) / res.send(err) — sending it via express/http helpers
- Any other pattern that passes the full caught object to an HTTP/API response

Do NOT flag:
- error.message, error.stack, err.message — accessing a specific safe property
- Custom mapped DTOs or error codes (e.g. { code: err.code, message: err.message })
- Logger calls (console.error, logger.error) — these are not response leaks
- Re-thrown errors (throw err) — not a response leak

For each violation, return the file path, the exact added line that is problematic (without the leading + prefix), and a short description of why it leaks.

Return only violations you are confident about. If a BFF file has no catch-block raw-error leaks, return an empty array.`;

const bffErrorLeakOutputSchema = z.object({
  violations: z.array(
    z.object({
      filePath: z.string(),
      lineContent: z.string(),
      description: z.string(),
    }),
  ),
});

/** Obvious leak patterns on added lines — does not replace the LLM, but avoids empty results when the model misses a clear hit. */
const JSON_STRINGIFY_RAW_CAUGHT = /JSON\.stringify\(\s*\b(error|err)\b\s*(?:,|\))/;
const BODY_RAW_CAUGHT = /\bbody\s*:\s*\b(error|err)\b/;

const DETERMINISTIC_DESC =
  'Raw `Error` serialized in API response — may expose API keys or stack traces. Use `error.message`.';

function extractAddedLineContents(diff: string): string[] {
  const out: string[] = [];
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      out.push(line.slice(1));
    }
  }
  return out;
}

function lineMatchesDeterministicLeak(line: string): boolean {
  const t = line.trim();
  if (JSON_STRINGIFY_RAW_CAUGHT.test(t)) return true;
  if (BODY_RAW_CAUGHT.test(t)) return true;
  return false;
}

/** Scans unified-diff additions under src/bff/ for obvious raw-error leaks (LLM backup). */
function findDeterministicBffRawErrorLeaks(fileDiffs: FileDiff[]): BffRawErrorLeakViolation[] {
  const out: BffRawErrorLeakViolation[] = [];
  for (const { filePath, diff } of fileDiffs) {
    if (!isBffPath(filePath)) continue;
    for (const content of extractAddedLineContents(diff)) {
      if (lineMatchesDeterministicLeak(content)) {
        out.push({ filePath, lineContent: content, description: DETERMINISTIC_DESC });
      }
    }
  }
  return out;
}

function violationKey(v: { filePath: string; lineContent: string }): string {
  return `${v.filePath}\n${v.lineContent.trim()}`;
}

function mergeViolations(
  deterministic: BffRawErrorLeakViolation[],
  llm: BffRawErrorLeakViolation[],
): BffRawErrorLeakViolation[] {
  const seen = new Set<string>();
  const merged: BffRawErrorLeakViolation[] = [];
  for (const v of [...deterministic, ...llm]) {
    const k = violationKey(v);
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push(v);
  }
  return merged;
}

export function isBffPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  /** Repo-relative paths often lack a leading slash (`src/bff/...` not `/src/bff/...`). */
  return /(^|\/)src\/bff\//.test(normalized);
}

export async function checkBffRawErrorResponses(
  fileDiffs: FileDiff[],
): Promise<BffRawErrorLeakCheckResult> {
  const bffDiffs = fileDiffs.filter((f) => isBffPath(f.filePath));
  if (bffDiffs.length === 0) {
    return { violations: [] };
  }

  const diffBlock = bffDiffs
    .map((f) => `File: ${f.filePath}\n\`\`\`diff\n${f.diff}\n\`\`\``)
    .join('\n\n');
  const fullPrompt = `${BFF_ERROR_LEAK_PROMPT}\n\n${diffBlock}`;

  try {
    const moonshot = createMoonshotAI({
      apiKey: getEnv('MOON_SHOT_KEY'),
      baseURL: MOONSHOT_API_BASE_URL,
    });

    const { output } = await generateText({
      model: moonshot(MOONSHOT_MODEL),
      prompt: fullPrompt,
      temperature: MOONSHOT_TEMPERATURE,
      output: Output.object({ schema: bffErrorLeakOutputSchema }),
    });

    const fromLlm: BffRawErrorLeakViolation[] = (output?.violations ?? []).map((v) => ({
      filePath: v.filePath,
      lineContent: v.lineContent,
      description: v.description,
    }));
    const fromScan = findDeterministicBffRawErrorLeaks(bffDiffs);
    /** LLM first so descriptions from the model win when the same line is also matched heuristically. */
    return { violations: mergeViolations(fromLlm, fromScan) };
  } catch (error) {
    console.error('[bff-error-check] LLM check failed, skipping:', (error as Error).message);
    return { violations: findDeterministicBffRawErrorLeaks(bffDiffs) };
  }
}

export function renderBffRawErrorLeakCheck(result: BffRawErrorLeakCheckResult): string {
  if (!result.violations.length) return '';

  const lines: string[] = ['### BFF: raw error leaked to client response'];
  for (const v of result.violations) {
    lines.push('');
    lines.push(`\`${v.filePath}\``);
    lines.push('```');
    lines.push(v.lineContent.trim());
    lines.push('```');
    if (v.description) lines.push(v.description);
  }
  return lines.join('\n');
}
