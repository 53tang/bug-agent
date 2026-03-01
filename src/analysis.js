"use strict";

const fs = require("fs");
const path = require("path");
const { shouldIncludeFile } = require("../fileFilter");
const { getTodayAnalysisDir } = require("../prScheduler");
const {
  COMMENT_AUTHOR_UUID,
  EXCERPT_CONTEXT_LINES,
  EXCERPT_MAX_CHARS,
  MAX_FILES_FOR_FULL_CONTENT,
  MAX_FULL_CONTENT_CHARS,
  getAuthHeader,
  isIgnoredRepo,
  shouldSkipInputRateLimit,
} = require("./config");
const {
  parsePrUrl,
  fetchJson,
  fetchText,
  fetchFileContent,
  postPRComment,
  searchPullRequestsByTitle,
} = require("./bitbucket");
const {
  splitDiffByFile,
  getChangedFilesFromDiff,
  hasParamOrFunctionalChange,
  hasMultipleHunks,
  buildContentExcerpt,
} = require("./diff");
const { callMoonshotAI } = require("./moonshot");
const {
  hasSpeculativeNotBugs,
  formatSpeculativeNotBugs,
  demoteVocCdcMulesoftBugs,
  renderMarkdownFromStructured,
} = require("./render");

async function sendWeChatWebhook(
  prTitle,
  prAuthor,
  repoFullName,
  prUrl,
  bugContent
) {
  const webhookUrl =
    "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=84df2ed2-887c-4599-83db-86e296e1233f";

  const content = `**${prTitle}**\n\nAuthor: ${prAuthor}\nRepo: ${repoFullName}\n\nPR URL: ${prUrl}\n\n---\n\n${bugContent}`;

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        msgtype: "markdown",
        markdown: {
          content: content,
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Failed to send WeChat webhook: ${res.status} ${res.statusText} - ${body}`
      );
    }

    const data = await res.json();
    console.log(`Successfully sent WeChat webhook notification`);
    return data;
  } catch (error) {
    console.error("Failed to send WeChat webhook:", error.message);
    // Don't throw - webhook failure shouldn't break the main flow
  }
}

function renderRelatedPrDiffGaps(relatedPrDiffGaps) {
  if (!relatedPrDiffGaps || relatedPrDiffGaps.skipped) return "";
  const relatedList = Array.isArray(relatedPrDiffGaps.eligibleRelatedPrs)
    ? relatedPrDiffGaps.eligibleRelatedPrs
    : [];
  const withMissing = relatedList.filter(
    (item) => Array.isArray(item.missingFiles) && item.missingFiles.length > 0
  );
  if (withMissing.length === 0) return "";
  const lines = ["### Related PR Diff Gaps"];
  for (const item of withMissing) {
    const state = String(item.state || "").toUpperCase() || "UNKNOWN";
    const dest = String(item.destination || "unknown");
    lines.push(
      `- Related PR #${item.id} (${state} -> ${dest}): missing files in current PR`
    );
    for (const file of item.missingFiles) {
      lines.push(`  - ${file}`);
    }
  }
  return lines.join("\n");
}

async function computeRelatedPrDiffGaps({
  pr,
  repoFullName,
  prId,
  prTitle,
  diffText,
  authHeader,
}) {
  const destBranch = String(pr?.destination?.branch?.name || "");
  const trimmedTitle = String(prTitle || "").trim();
  const base = {
    searchedTitle: trimmedTitle,
    matchStrategy: "case_insensitive_exact",
    currentPr: {
      id: prId,
      title: prTitle || "",
      destination: destBranch || "",
    },
    candidatesFound: 0,
    eligibleRelatedPrs: [],
    skipped: false,
  };

  if (!trimmedTitle) {
    return { ...base, skipped: true, reason: "missing_title" };
  }
  if (destBranch !== "main") {
    return {
      ...base,
      skipped: true,
      reason: `destination_not_main:${destBranch || "unknown"}`,
    };
  }

  try {
    const candidates = await searchPullRequestsByTitle(
      repoFullName,
      trimmedTitle,
      authHeader
    );
    const normalizedTitle = trimmedTitle.toLowerCase();
    const exactMatches = candidates.filter(
      (item) =>
        String(item?.title || "")
          .trim()
          .toLowerCase() === normalizedTitle
    );
    const withoutCurrent = exactMatches.filter(
      (item) => Number(item?.id) !== Number(prId)
    );
    base.candidatesFound = withoutCurrent.length;

    const eligible = withoutCurrent.filter((item) => {
      const state = String(item?.state || "").toUpperCase();
      const dest = String(item?.destination?.branch?.name || "");
      return state === "MERGED" && dest === "develop";
    });

    if (eligible.length === 0) {
      return base;
    }

    const currentFiles = getChangedFilesFromDiff(diffText);
    const results = [];
    for (const related of eligible) {
      const entry = {
        id: related.id,
        title: related.title || "",
        state: related.state || "",
        destination: related.destination?.branch?.name || "",
        missingFiles: [],
      };
      const diffUrl = related.links?.diff?.href;
      if (!diffUrl) {
        entry.error = "diff_url_missing";
        results.push(entry);
        continue;
      }
      try {
        const relatedDiff = await fetchText(diffUrl, authHeader);
        const relatedFiles = getChangedFilesFromDiff(relatedDiff);
        const missing = [...relatedFiles].filter(
          (file) => !currentFiles.has(file)
        );
        entry.missingFiles = missing.sort();
      } catch (error) {
        entry.error = error.message;
      }
      results.push(entry);
    }

    base.eligibleRelatedPrs = results;
    return base;
  } catch (error) {
    return { ...base, skipped: true, reason: "search_failed", error: error.message };
  }
}

async function analyzePR(prUrl) {
  const authHeader = getAuthHeader();
  const { repoFullName, prId } = parsePrUrl(prUrl);

  if (isIgnoredRepo(repoFullName)) {
    console.log(
      `[analyze] Skipping PR #${prId} from ignored repo: ${repoFullName}`
    );
    return {
      success: true,
      skipped: true,
      reason: "ignored_repo",
      prId,
      repoFullName,
      prTitle: "",
    };
  }

  console.log(`Analyzing PR #${prId} from ${repoFullName}`);

  const prApi = `https://api.bitbucket.org/2.0/repositories/${repoFullName}/pullrequests/${prId}`;
  const pr = await fetchJson(prApi, authHeader);
  const diffUrl = pr.links && pr.links.diff && pr.links.diff.href;
  const commitHash = pr.source && pr.source.commit && pr.source.commit.hash;

  if (!diffUrl) {
    throw new Error("PR diff URL not found");
  }
  if (!commitHash) {
    throw new Error("PR commit hash not found");
  }

  const diffText = await fetchText(diffUrl, authHeader);
  const fileDiffs = splitDiffByFile(diffText);
  const relatedPrDiffGaps = await computeRelatedPrDiffGaps({
    pr,
    repoFullName,
    prId,
    prTitle: pr.title,
    diffText,
    authHeader,
  });
  const includedFileDiffs = [];
  const excludedFiles = [];

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

  const fetchedFiles = new Map();
  const promptChangeList = [];
  const changeListForSave = [];
  const filterStats = {
    total: fileDiffs.length,
    included: includedFileDiffs.length,
    excluded: excludedFiles.length,
  };
  const skipInputRateLimit = shouldSkipInputRateLimit(includedFileDiffs.length);
  const skipFullContent = includedFileDiffs.length > MAX_FILES_FOR_FULL_CONTENT;
  if (skipFullContent) {
    console.log(
      `[analyze] ${includedFileDiffs.length} files > ${MAX_FILES_FOR_FULL_CONTENT}; using diff-only without full content`
    );
  }

  for (const file of includedFileDiffs) {
    const hasFunctionalChange = hasParamOrFunctionalChange(file.diff);
    const hasMultipleHunks_ = hasMultipleHunks(file.diff);
    const shouldFetchContent = hasFunctionalChange || hasMultipleHunks_;

    if (
      !skipFullContent &&
      shouldFetchContent &&
      !fetchedFiles.has(file.filePath)
    ) {
      const fullContent = await fetchFileContent(
        repoFullName,
        commitHash,
        file.filePath,
        authHeader
      );
      fetchedFiles.set(file.filePath, fullContent);
      if (fullContent === null) {
        console.log(`[analyze] File content not found (404): ${file.filePath}`);
      } else {
        const reason = hasFunctionalChange
          ? "functional change"
          : "multiple hunks";
        console.log(
          `[analyze] Fetched content (${reason}): ${file.filePath} (${fullContent.length} chars)`
        );
      }
    } else if (!shouldFetchContent) {
      console.log(
        `[analyze] Diff-only (no functional change or multiple hunks): ${file.filePath}`
      );
    }

    const promptEntry = {
      file: file.filePath,
      diff: file.diff,
      hasFunctionalChange,
      hasMultipleHunks: hasMultipleHunks_,
    };
    const saveEntry = {
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
            EXCERPT_MAX_CHARS
          );
          if (excerpt) {
            promptEntry.full_content_excerpt = excerpt;
            promptEntry.full_content_truncated = true;
            saveEntry.full_content = fullContent.slice(
              0,
              MAX_FULL_CONTENT_CHARS
            );
            saveEntry.full_content_truncated = true;
            console.log(
              `[analyze] Truncated content for ${file.filePath} (excerpt length ${excerpt.length} chars)`
            );
          } else {
            const truncated = fullContent.slice(0, MAX_FULL_CONTENT_CHARS);
            promptEntry.full_content = truncated;
            promptEntry.full_content_truncated = true;
            saveEntry.full_content = truncated;
            saveEntry.full_content_truncated = true;
            console.log(
              `[analyze] Truncated content for ${file.filePath} (head ${MAX_FULL_CONTENT_CHARS} chars)`
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
    console.log("[analyze] No files to analyze after filtering");
    return {
      success: true,
      message: "No files to analyze after filtering.",
      bugs: [],
      prId,
      repoFullName,
      prTitle: pr.title,
      relatedPrDiffGaps,
    };
  }

  const prompt =
    "Review these changes for functional, CONFIRMED bugs. Focus on behavior changes or parameter mismatches that will cause runtime errors or incorrect behavior. Also provide architecture/management/quantity suggestions (not bugs) in a top-level suggestions array.";

  let analysis;
  if (skipInputRateLimit) {
    console.warn(
      `[analyze] Input rate limit triggered (${includedFileDiffs.length} files). Skipping LLM call.`
    );
    analysis = {
      rawText: "",
      structured: null,
      parseError: "input_rate_limit",
      quotaExceeded: true,
      tokenUsage: [],
    };
  } else {
    analysis = await callMoonshotAI(prompt, promptChangeList, {
      prTitle: pr.title,
      repoFullName,
      prId,
    });
    if (analysis?.structured) {
      analysis.structured = demoteVocCdcMulesoftBugs(analysis.structured);
    }
    console.log(
      `[analyze] Moonshot analysis length: ${analysis.rawText.length} chars`
    );
  }

  // Check if quota was exceeded
  if (analysis.quotaExceeded) {
    const isInputRateLimit = analysis.parseError === "input_rate_limit";
    const rateLimitLabel = isInputRateLimit ? "input rate limit" : "rate limit";
    console.warn(
      `[analyze] ${rateLimitLabel} triggered, saving partial results`
    );

    // Save partial results
    try {
      const hasBugs = false; // Quota exceeded means no bugs analyzed
      const todayDir = getTodayAnalysisDir(hasBugs);
      if (!fs.existsSync(todayDir)) {
        fs.mkdirSync(todayDir, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `${timestamp}-pr-${prId}.json`;
      const filepath = path.join(todayDir, filename);

      const dataToSave = {
        prId,
        repoFullName,
        prTitle: pr.title,
        timestamp: new Date().toISOString(),
        error: isInputRateLimit
          ? `Input rate limit: ${includedFileDiffs.length} files`
          : "Rate limit exceeded",
        filterStats,
        changeList: changeListForSave,
        excludedFiles,
        relatedPrDiffGaps,
        tokenUsage: analysis.tokenUsage ?? [],
        analysis: {
          summary: isInputRateLimit
            ? "Analysis skipped: input rate limit"
            : "Analysis failed: rate limit",
          bugs: [],
          notBugs: [],
        },
      };

      fs.writeFileSync(filepath, JSON.stringify(dataToSave, null, 2), "utf8");
      console.log(`\n💾 Saved partial analysis results to: ${filepath}`);
    } catch (saveError) {
      console.error(
        "Failed to save partial analysis results:",
        saveError.message
      );
    }

    // Send webhook notification
    try {
      const prUrl = `https://bitbucket.org/${repoFullName}/pull-requests/${prId}`;
      const prAuthor =
        pr.author?.display_name || pr.author?.username || "Unknown";
      const bugContent = isInputRateLimit
        ? "No bugs analyzed due to input rate limit"
        : "No bugs analyzed due to rate limit";
      await sendWeChatWebhook(
        pr.title,
        prAuthor,
        repoFullName,
        prUrl,
        bugContent
      );
      console.log("\n📱 Sent webhook notification for quota exceeded");
    } catch (webhookError) {
      console.error(
        "Failed to send webhook notification:",
        webhookError.message
      );
    }

    return {
      success: false,
      quotaExceeded: true,
      prId,
      repoFullName,
      prTitle: pr.title,
    };
  }

  // Save PR analysis results to file
  try {
    // Determine if PR has bugs
    const bugsArray = analysis.structured?.bugs || [];
    const hasBugs = Array.isArray(bugsArray) && bugsArray.length > 0;

    const todayDir = getTodayAnalysisDir(hasBugs);
    if (!fs.existsSync(todayDir)) {
      fs.mkdirSync(todayDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
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
        summary: "Failed to parse LLM JSON output",
        bugs: [],
        notBugs: [],
        parseError: analysis.parseError,
      },
    };

    fs.writeFileSync(filepath, JSON.stringify(dataToSave, null, 2), "utf8");
    const bugStatusMsg = hasBugs ? "with-bugs" : "without-bugs";
    console.log(
      `\n💾 Saved analysis results to: ${filepath} (${bugStatusMsg})`
    );
  } catch (saveError) {
    console.error("Failed to save analysis results:", saveError.message);
    // Continue even if saving fails
  }

  if (!analysis.structured) {
    console.warn("[analyze] LLM output not valid JSON. Skipping PR comment.");
    return { success: true, analysis, prId, repoFullName, prTitle: pr.title };
  }
  const formattedAnalysis = renderMarkdownFromStructured(analysis.structured);
  const trimmedAnalysis = (formattedAnalysis || "").trim();
  const relatedGapsMarkdown = renderRelatedPrDiffGaps(relatedPrDiffGaps);
  const hasCommentContent =
    Boolean(trimmedAnalysis) || Boolean(relatedGapsMarkdown);
  const notBugs = Array.isArray(analysis.structured.notBugs)
    ? analysis.structured.notBugs
    : [];
  const hasSpeculative = hasSpeculativeNotBugs(notBugs);
  const speculativeContent = hasSpeculative
    ? formatSpeculativeNotBugs(notBugs)
    : "";
  const shouldSendWebhook = Boolean(trimmedAnalysis) || hasSpeculative;

  if (!hasCommentContent) {
    console.log(
      "[analyze] No confirmed high severity bugs. Skipping PR comment."
    );
    if (shouldSendWebhook) {
      try {
        const prUrl = `https://bitbucket.org/${repoFullName}/pull-requests/${prId}`;
        const prAuthor =
          pr.author?.display_name || pr.author?.username || "Unknown";
        await sendWeChatWebhook(
          pr.title,
          prAuthor,
          repoFullName,
          prUrl,
          speculativeContent
        );
      } catch (webhookError) {
        console.error(
          "Failed to send webhook notification:",
          webhookError.message
        );
      }
    }
    return { success: true, analysis, prId, repoFullName, prTitle: pr.title };
  }

  const commentSections = [];
  if (trimmedAnalysis) {
    commentSections.push(trimmedAnalysis);
  }
  if (relatedGapsMarkdown) {
    commentSections.push(relatedGapsMarkdown);
  }

  const comment = `## Automated Code Review Analysis

${commentSections.join("\n\n")}

---

*This analysis was generated automatically by Bug Agent using Moonshot (Kimi).*`;

  const authorUuid = pr.author?.uuid || "";
  const canComment = authorUuid === COMMENT_AUTHOR_UUID;

  if (canComment) {
    try {
      await postPRComment(repoFullName, prId, comment);
      console.log(`\n✅ Successfully posted analysis comment to PR #${prId}`);
    } catch (error) {
      console.error("Failed to post comment to PR:", error.message);
      // Log the analysis even if posting fails
      console.log("\n=== Analysis Result ===");
      console.log(analysis);
      console.log("======================\n");
      throw error; // Re-throw to handle in caller
    }
  } else {
    console.log(
      `[analyze] Skipping PR comment (author ${
        authorUuid || "unknown"
      } not in allowlist)`
    );
  }

  if (shouldSendWebhook) {
    try {
      const prUrl = `https://bitbucket.org/${repoFullName}/pull-requests/${prId}`;
      const prAuthor =
        pr.author?.display_name || pr.author?.username || "Unknown";
      await sendWeChatWebhook(
        pr.title,
        prAuthor,
        repoFullName,
        prUrl,
        trimmedAnalysis
      );
    } catch (webhookError) {
      console.error(
        "Failed to send webhook notification:",
        webhookError.message
      );
    }
  }

  return { success: true, analysis, prId, repoFullName, prTitle: pr.title };
}

module.exports = { analyzePR };
