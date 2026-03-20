import fs from 'node:fs';
import path from 'node:path';
import { shouldIncludeFile } from '../fileFilter';
import { getTodayAnalysisDir } from '../prScheduler';
import {
  COMMENT_AUTHOR_UUID,
  EXCERPT_CONTEXT_LINES,
  EXCERPT_MAX_CHARS,
  MAX_FILES_FOR_FULL_CONTENT,
  MAX_FULL_CONTENT_CHARS,
  getAuthHeader,
  isIgnoredRepo,
  shouldSkipInputRateLimit,
} from './config';
import {
  parsePrUrl,
  fetchJson,
  fetchText,
  fetchFileContent,
  postPRComment,
  searchPullRequestsByTitle,
} from './bitbucket';
import {
  splitDiffByFile,
  getChangedFilesFromDiff,
  hasParamOrFunctionalChange,
  hasMultipleHunks,
  buildContentExcerpt,
} from './diff';
import { callMoonshotAI, type MoonshotResult } from './moonshot';
import {
  hasSpeculativeNotBugs,
  formatSpeculativeNotBugs,
  demoteVocCdcMulesoftBugs,
  renderMarkdownFromStructured,
  type Structured,
} from './render';

interface RelatedPrDiffGaps {
  searchedTitle: string;
  matchStrategy: string;
  currentPr: { id: number; title: string; destination: string };
  candidatesFound: number;
  eligibleRelatedPrs: RelatedPrEntry[];
  skipped: boolean;
  reason?: string;
  error?: string;
}

interface RelatedPrEntry {
  id: number;
  title: string;
  state: string;
  destination: string;
  missingFiles: string[];
  error?: string;
}

interface AnalysisResult {
  success: boolean;
  skipped?: boolean;
  reason?: string;
  message?: string;
  quotaExceeded?: boolean;
  analysis?: MoonshotResult;
  bugs?: unknown[];
  prId: number;
  repoFullName: string;
  prTitle: string;
  relatedPrDiffGaps?: RelatedPrDiffGaps;
}

async function sendWeChatWebhook(
  prTitle: string,
  prAuthor: string,
  repoFullName: string,
  prUrl: string,
  bugContent: string,
): Promise<unknown> {
  const webhookUrl =
    'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=84df2ed2-887c-4599-83db-86e296e1233f';

  const content = `**${prTitle}**\n\nAuthor: ${prAuthor}\nRepo: ${repoFullName}\n\nPR URL: ${prUrl}\n\n---\n\n${bugContent}`;

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        msgtype: 'markdown',
        markdown: {
          content: content,
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to send WeChat webhook: ${res.status} ${res.statusText} - ${body}`);
    }

    const data = await res.json();
    console.log(`Successfully sent WeChat webhook notification`);
    return data;
  } catch (error) {
    console.error('Failed to send WeChat webhook:', (error as Error).message);
  }
}

function renderRelatedPrDiffGaps(relatedPrDiffGaps: RelatedPrDiffGaps | null): string {
  if (!relatedPrDiffGaps || relatedPrDiffGaps.skipped) return '';
  const relatedList = Array.isArray(relatedPrDiffGaps.eligibleRelatedPrs)
    ? relatedPrDiffGaps.eligibleRelatedPrs
    : [];
  const withMissing = relatedList.filter(
    (item) => Array.isArray(item.missingFiles) && item.missingFiles.length > 0,
  );
  if (withMissing.length === 0) return '';
  const lines = ['### Related PR Diff Gaps'];
  for (const item of withMissing) {
    const state = String(item.state || '').toUpperCase() || 'UNKNOWN';
    const dest = String(item.destination || 'unknown');
    lines.push(`- Related PR #${item.id} (${state} -> ${dest}): missing files in current PR`);
    for (const file of item.missingFiles) {
      lines.push(`  - ${file}`);
    }
  }
  return lines.join('\n');
}

async function computeRelatedPrDiffGaps({
  pr,
  repoFullName,
  prId,
  prTitle,
  diffText,
  authHeader,
}: {
  pr: Record<string, unknown>;
  repoFullName: string;
  prId: number;
  prTitle: string;
  diffText: string;
  authHeader: string;
}): Promise<RelatedPrDiffGaps> {
  const dest = pr?.destination as Record<string, unknown> | undefined;
  const destBranch = String((dest?.branch as Record<string, unknown>)?.name || '');
  const trimmedTitle = String(prTitle || '').trim();
  const base: RelatedPrDiffGaps = {
    searchedTitle: trimmedTitle,
    matchStrategy: 'case_insensitive_exact',
    currentPr: {
      id: prId,
      title: prTitle || '',
      destination: destBranch || '',
    },
    candidatesFound: 0,
    eligibleRelatedPrs: [],
    skipped: false,
  };

  if (!trimmedTitle) {
    return { ...base, skipped: true, reason: 'missing_title' };
  }
  if (destBranch !== 'main') {
    return {
      ...base,
      skipped: true,
      reason: `destination_not_main:${destBranch || 'unknown'}`,
    };
  }

  try {
    const candidates = await searchPullRequestsByTitle(repoFullName, trimmedTitle, authHeader);
    const normalizedTitle = trimmedTitle.toLowerCase();
    const exactMatches = candidates.filter(
      (item: Record<string, unknown>) =>
        String(item?.title || '')
          .trim()
          .toLowerCase() === normalizedTitle,
    );
    const withoutCurrent = exactMatches.filter(
      (item: Record<string, unknown>) => Number(item?.id) !== Number(prId),
    );
    base.candidatesFound = withoutCurrent.length;

    const eligible = withoutCurrent.filter((item: Record<string, unknown>) => {
      const state = String(item?.state || '').toUpperCase();
      const itemDest = (item?.destination as Record<string, unknown>)?.branch as
        | Record<string, unknown>
        | undefined;
      const dest = String(itemDest?.name || '');
      return state === 'MERGED' && dest === 'develop';
    });

    if (eligible.length === 0) {
      return base;
    }

    const currentFiles = getChangedFilesFromDiff(diffText);
    const results: RelatedPrEntry[] = [];
    for (const related of eligible) {
      const entry: RelatedPrEntry = {
        id: related.id as number,
        title: (related.title as string) || '',
        state: (related.state as string) || '',
        destination:
          (((related.destination as Record<string, unknown>)?.branch as Record<string, unknown>)
            ?.name as string) || '',
        missingFiles: [],
      };
      const links = related.links as Record<string, Record<string, string>> | undefined;
      const diffUrl = links?.diff?.href;
      if (!diffUrl) {
        entry.error = 'diff_url_missing';
        results.push(entry);
        continue;
      }
      try {
        const relatedDiff = await fetchText(diffUrl, authHeader);
        const relatedFiles = getChangedFilesFromDiff(relatedDiff!);
        const missing = [...relatedFiles].filter((file) => !currentFiles.has(file));
        entry.missingFiles = missing.sort();
      } catch (error) {
        entry.error = (error as Error).message;
      }
      results.push(entry);
    }

    base.eligibleRelatedPrs = results;
    return base;
  } catch (error) {
    return { ...base, skipped: true, reason: 'search_failed', error: (error as Error).message };
  }
}

export async function analyzePR(prUrl: string): Promise<AnalysisResult> {
  const authHeader = getAuthHeader();
  const { repoFullName, prId } = parsePrUrl(prUrl);

  if (isIgnoredRepo(repoFullName)) {
    console.log(`[analyze] Skipping PR #${prId} from ignored repo: ${repoFullName}`);
    return {
      success: true,
      skipped: true,
      reason: 'ignored_repo',
      prId,
      repoFullName,
      prTitle: '',
    };
  }

  console.log(`Analyzing PR #${prId} from ${repoFullName}`);

  const prApi = `https://api.bitbucket.org/2.0/repositories/${repoFullName}/pullrequests/${prId}`;
  const pr = await fetchJson(prApi, authHeader);
  const diffUrl = (pr.links as Record<string, Record<string, string>>)?.diff?.href;
  const commitHash = ((pr.source as Record<string, unknown>)?.commit as Record<string, string>)
    ?.hash;

  if (!diffUrl) {
    throw new Error('PR diff URL not found');
  }
  if (!commitHash) {
    throw new Error('PR commit hash not found');
  }

  const diffText = (await fetchText(diffUrl, authHeader))!;
  const fileDiffs = splitDiffByFile(diffText);
  const relatedPrDiffGaps = await computeRelatedPrDiffGaps({
    pr,
    repoFullName,
    prId,
    prTitle: pr.title as string,
    diffText,
    authHeader,
  });
  const includedFileDiffs: { filePath: string; diff: string }[] = [];
  const excludedFiles: string[] = [];

  for (const file of fileDiffs) {
    if (shouldIncludeFile(file.filePath, file.diff)) {
      includedFileDiffs.push(file);
    } else {
      excludedFiles.push(file.filePath);
    }
  }

  console.log(`\n=== File Filtering Results ===`);
  console.log(`Total files: ${fileDiffs.length}`);
  console.log(`Included files: ${includedFileDiffs.length}`);
  console.log(`Excluded files: ${excludedFiles.length}`);
  if (excludedFiles.length > 0) {
    console.log(`Excluded file paths:`, excludedFiles);
  }
  console.log(`=============================\n`);

  const fetchedFiles = new Map<string, string | null>();
  const promptChangeList: Record<string, unknown>[] = [];
  const changeListForSave: Record<string, unknown>[] = [];
  const filterStats = {
    total: fileDiffs.length,
    included: includedFileDiffs.length,
    excluded: excludedFiles.length,
  };
  const skipInputRateLimit = shouldSkipInputRateLimit(includedFileDiffs.length);
  const skipFullContent = includedFileDiffs.length > MAX_FILES_FOR_FULL_CONTENT;
  if (skipFullContent) {
    console.log(
      `[analyze] ${includedFileDiffs.length} files > ${MAX_FILES_FOR_FULL_CONTENT}; using diff-only without full content`,
    );
  }

  for (const file of includedFileDiffs) {
    const hasFunctionalChange = hasParamOrFunctionalChange(file.diff);
    const hasMultipleHunks_ = hasMultipleHunks(file.diff);
    const shouldFetchContent = hasFunctionalChange || hasMultipleHunks_;

    if (!skipFullContent && shouldFetchContent && !fetchedFiles.has(file.filePath)) {
      const fullContent = await fetchFileContent(
        repoFullName,
        commitHash,
        file.filePath,
        authHeader,
      );
      fetchedFiles.set(file.filePath, fullContent);
      if (fullContent === null) {
        console.log(`[analyze] File content not found (404): ${file.filePath}`);
      } else {
        const reason = hasFunctionalChange ? 'functional change' : 'multiple hunks';
        console.log(
          `[analyze] Fetched content (${reason}): ${file.filePath} (${fullContent.length} chars)`,
        );
      }
    } else if (!shouldFetchContent) {
      console.log(`[analyze] Diff-only (no functional change or multiple hunks): ${file.filePath}`);
    }

    const promptEntry: Record<string, unknown> = {
      file: file.filePath,
      diff: file.diff,
      hasFunctionalChange,
      hasMultipleHunks: hasMultipleHunks_,
    };
    const saveEntry: Record<string, unknown> = {
      file: file.filePath,
      hasFunctionalChange,
      hasMultipleHunks: hasMultipleHunks_,
    };
    if (shouldFetchContent) {
      const fullContent = fetchedFiles.get(file.filePath);
      if (fullContent !== null && fullContent !== undefined) {
        const contentLength = fullContent.length;
        promptEntry.full_content_length = contentLength;
        saveEntry.full_content_length = contentLength;
        if (contentLength > MAX_FULL_CONTENT_CHARS) {
          const excerpt = buildContentExcerpt(
            fullContent,
            file.diff,
            EXCERPT_CONTEXT_LINES,
            EXCERPT_MAX_CHARS,
          );
          if (excerpt) {
            promptEntry.full_content_excerpt = excerpt;
            promptEntry.full_content_truncated = true;
            saveEntry.full_content = fullContent.slice(0, MAX_FULL_CONTENT_CHARS);
            saveEntry.full_content_truncated = true;
            console.log(
              `[analyze] Truncated content for ${file.filePath} (excerpt length ${excerpt.length} chars)`,
            );
          } else {
            const truncated = fullContent.slice(0, MAX_FULL_CONTENT_CHARS);
            promptEntry.full_content = truncated;
            promptEntry.full_content_truncated = true;
            saveEntry.full_content = truncated;
            saveEntry.full_content_truncated = true;
            console.log(
              `[analyze] Truncated content for ${file.filePath} (head ${MAX_FULL_CONTENT_CHARS} chars)`,
            );
          }
        } else {
          promptEntry.full_content = fullContent;
          saveEntry.full_content = fullContent;
        }
      }
    }
    promptChangeList.push(promptEntry);
    changeListForSave.push(saveEntry);
  }

  if (changeListForSave.length === 0) {
    console.log('[analyze] No files to analyze after filtering');
    return {
      success: true,
      message: 'No files to analyze after filtering.',
      bugs: [],
      prId,
      repoFullName,
      prTitle: pr.title as string,
      relatedPrDiffGaps,
    };
  }

  const prompt =
    'Review these changes for functional, CONFIRMED bugs. Focus on behavior changes or parameter mismatches that will cause runtime errors or incorrect behavior. Also provide architecture/management/quantity suggestions (not bugs) in a top-level suggestions array.';

  let analysis: MoonshotResult;
  if (skipInputRateLimit) {
    console.warn(
      `[analyze] Input rate limit triggered (${includedFileDiffs.length} files). Skipping LLM call.`,
    );
    analysis = {
      rawText: '',
      structured: null,
      parseError: 'input_rate_limit',
      quotaExceeded: true,
      tokenUsage: [],
    };
  } else {
    analysis = await callMoonshotAI(prompt, promptChangeList, {
      prTitle: pr.title as string,
      repoFullName,
      prId,
    });
    if (analysis?.structured) {
      analysis.structured = demoteVocCdcMulesoftBugs(
        analysis.structured as unknown as Structured,
      ) as unknown as Record<string, unknown>;
    }
    console.log(`[analyze] Moonshot analysis length: ${analysis.rawText.length} chars`);
  }

  if (analysis.quotaExceeded) {
    const isInputRateLimit = analysis.parseError === 'input_rate_limit';
    const rateLimitLabel = isInputRateLimit ? 'input rate limit' : 'rate limit';
    console.warn(`[analyze] ${rateLimitLabel} triggered, saving partial results`);

    try {
      const hasBugs = false;
      const todayDir = getTodayAnalysisDir(hasBugs);
      if (!fs.existsSync(todayDir)) {
        fs.mkdirSync(todayDir, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${timestamp}-pr-${prId}.json`;
      const filepath = path.join(todayDir, filename);

      const dataToSave = {
        prId,
        repoFullName,
        prTitle: pr.title,
        timestamp: new Date().toISOString(),
        error: isInputRateLimit
          ? `Input rate limit: ${includedFileDiffs.length} files`
          : 'Rate limit exceeded',
        filterStats,
        changeList: changeListForSave,
        excludedFiles,
        relatedPrDiffGaps,
        tokenUsage: analysis.tokenUsage ?? [],
        analysis: {
          summary: isInputRateLimit
            ? 'Analysis skipped: input rate limit'
            : 'Analysis failed: rate limit',
          bugs: [],
          notBugs: [],
        },
      };

      fs.writeFileSync(filepath, JSON.stringify(dataToSave, null, 2), 'utf8');
      console.log(`Saved partial analysis results to: ${filepath}`);
    } catch (saveError) {
      console.error('Failed to save partial analysis results:', (saveError as Error).message);
    }

    try {
      const prUrlForWebhook = `https://bitbucket.org/${repoFullName}/pull-requests/${prId}`;
      const author = pr.author as Record<string, string> | undefined;
      const prAuthor = author?.display_name || author?.username || 'Unknown';
      const bugContent = isInputRateLimit
        ? 'No bugs analyzed due to input rate limit'
        : 'No bugs analyzed due to rate limit';
      await sendWeChatWebhook(
        pr.title as string,
        prAuthor,
        repoFullName,
        prUrlForWebhook,
        bugContent,
      );
      console.log('Sent webhook notification for quota exceeded');
    } catch (webhookError) {
      console.error('Failed to send webhook notification:', (webhookError as Error).message);
    }

    return {
      success: false,
      quotaExceeded: true,
      prId,
      repoFullName,
      prTitle: pr.title as string,
    };
  }

  try {
    const structured = analysis.structured as unknown as Structured | null;
    const bugsArray = structured?.bugs || [];
    const hasBugs = Array.isArray(bugsArray) && bugsArray.length > 0;

    const todayDir = getTodayAnalysisDir(hasBugs);
    if (!fs.existsSync(todayDir)) {
      fs.mkdirSync(todayDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${timestamp}-pr-${prId}.json`;
    const filepath = path.join(todayDir, filename);

    const dataToSave = {
      prId,
      repoFullName,
      prTitle: pr.title,
      timestamp: new Date().toISOString(),
      filterStats,
      changeList: changeListForSave,
      excludedFiles,
      relatedPrDiffGaps,
      tokenUsage: analysis.tokenUsage ?? [],
      analysis: analysis.structured || {
        summary: 'Failed to parse LLM JSON output',
        bugs: [],
        notBugs: [],
        parseError: analysis.parseError,
      },
    };

    fs.writeFileSync(filepath, JSON.stringify(dataToSave, null, 2), 'utf8');
    const bugStatusMsg = hasBugs ? 'with-bugs' : 'without-bugs';
    console.log(`Saved analysis results to: ${filepath} (${bugStatusMsg})`);
  } catch (saveError) {
    console.error('Failed to save analysis results:', (saveError as Error).message);
  }

  if (!analysis.structured) {
    console.warn('[analyze] LLM output not valid JSON. Skipping PR comment.');
    return { success: true, analysis, prId, repoFullName, prTitle: pr.title as string };
  }
  const structured = analysis.structured as unknown as Structured;
  const formattedAnalysis = renderMarkdownFromStructured(structured);
  const trimmedAnalysis = (formattedAnalysis || '').trim();
  const relatedGapsMarkdown = renderRelatedPrDiffGaps(relatedPrDiffGaps);
  const hasCommentContent = Boolean(trimmedAnalysis) || Boolean(relatedGapsMarkdown);
  const notBugs = Array.isArray(structured.notBugs) ? structured.notBugs : [];
  const hasSpeculative = hasSpeculativeNotBugs(notBugs);
  const speculativeContent = hasSpeculative ? formatSpeculativeNotBugs(notBugs) : '';
  const shouldSendWebhook = Boolean(trimmedAnalysis) || hasSpeculative;

  if (!hasCommentContent) {
    console.log('[analyze] No confirmed high severity bugs. Skipping PR comment.');
    if (shouldSendWebhook) {
      try {
        const prUrlForWebhook = `https://bitbucket.org/${repoFullName}/pull-requests/${prId}`;
        const author = pr.author as Record<string, string> | undefined;
        const prAuthor = author?.display_name || author?.username || 'Unknown';
        await sendWeChatWebhook(
          pr.title as string,
          prAuthor,
          repoFullName,
          prUrlForWebhook,
          speculativeContent,
        );
      } catch (webhookError) {
        console.error('Failed to send webhook notification:', (webhookError as Error).message);
      }
    }
    return { success: true, analysis, prId, repoFullName, prTitle: pr.title as string };
  }

  const commentSections: string[] = [];
  if (trimmedAnalysis) {
    commentSections.push(trimmedAnalysis);
  }
  if (relatedGapsMarkdown) {
    commentSections.push(relatedGapsMarkdown);
  }

  const comment = `## Automated Code Review Analysis

${commentSections.join('\n\n')}

---

*This analysis was generated automatically by Bug Agent using Moonshot (Kimi).*`;

  const authorUuid = (pr.author as Record<string, string>)?.uuid || '';
  const canComment = authorUuid === COMMENT_AUTHOR_UUID;

  if (canComment) {
    try {
      await postPRComment(repoFullName, prId, comment);
      console.log(`Successfully posted analysis comment to PR #${prId}`);
    } catch (error) {
      console.error('Failed to post comment to PR:', (error as Error).message);
      console.log('\n=== Analysis Result ===');
      console.log(analysis);
      console.log('======================\n');
      throw error;
    }
  } else {
    console.log(
      `[analyze] Skipping PR comment (author ${authorUuid || 'unknown'} not in allowlist)`,
    );
  }

  if (shouldSendWebhook) {
    try {
      const prUrlForWebhook = `https://bitbucket.org/${repoFullName}/pull-requests/${prId}`;
      const author = pr.author as Record<string, string> | undefined;
      const prAuthor = author?.display_name || author?.username || 'Unknown';
      await sendWeChatWebhook(
        pr.title as string,
        prAuthor,
        repoFullName,
        prUrlForWebhook,
        trimmedAnalysis,
      );
    } catch (webhookError) {
      console.error('Failed to send webhook notification:', (webhookError as Error).message);
    }
  }

  return { success: true, analysis, prId, repoFullName, prTitle: pr.title as string };
}
