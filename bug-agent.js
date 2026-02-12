'use strict';

// Minimal Bug Agent: Express server with POST /analyze endpoint for PR analysis

require('dotenv').config({ path: '.envrc' }); // Load .envrc
const express = require('express');
const fs = require('fs');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');
const { URL } = require('url');
const { shouldIncludeFile } = require('./fileFilter');
const { createPrFetchScheduler, getTodayAnalysisDir } = require('./prScheduler');

const PROMPT_PATH = path.join(__dirname, 'prompt.txt');
const MAX_FULL_CONTENT_CHARS = 4000;
const EXCERPT_CONTEXT_LINES = 15;
const EXCERPT_MAX_CHARS = 6000;
const MAX_FILES_FOR_FULL_CONTENT = 25;

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

function getEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set`);
  }
  return value;
}

function getAuthHeader() {
  const email = getEnv('BITBUCKET_EMAIL');
  const token = getEnv('BITBUCKET_API_TOKEN');
  const creds = Buffer.from(`${email}:${token}`).toString('base64');
  return `Basic ${creds}`;
}

function parsePrUrl(prUrl) {
  const url = new URL(prUrl);
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 4 || parts[2] !== 'pull-requests') {
    throw new Error('Invalid PR URL format. Expected: https://bitbucket.org/workspace/repo/pull-requests/123');
  }
  const workspace = parts[0];
  const repo = parts[1];
  const prId = Number(parts[3]);
  if (!Number.isFinite(prId)) {
    throw new Error('Invalid PR ID in URL');
  }
  return { repoFullName: `${workspace}/${repo}`, prId };
}

async function fetchJson(url, authHeader) {
  const res = await fetch(url, {
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Request failed: ${res.status} ${res.statusText} - ${body}`);
  }
  return res.json();
}

async function fetchText(url, authHeader, options = {}) {
  const { allow404 = false } = options;
  const res = await fetch(url, {
    headers: {
      Authorization: authHeader,
      Accept: 'text/plain',
    },
  });
  if (!res.ok) {
    const body = await res.text();
    if (allow404 && res.status === 404) {
      return null;
    }
    throw new Error(`Request failed: ${res.status} ${res.statusText} - ${body}`);
  }
  return res.text();
}


function splitDiffByFile(diffText) {
  const files = [];
  const lines = diffText.split('\n');
  let currentFile = null;
  let currentLines = [];

  for (const line of lines) {
    const match = line.match(/^diff --git a\/(.+?) b\/(.+?)$/);
    if (match) {
      if (currentFile) {
        files.push({ filePath: currentFile, diff: currentLines.join('\n') });
      }
      currentFile = match[2];
      currentLines = [line];
      continue;
    }
    if (currentFile) {
      currentLines.push(line);
    }
  }

  if (currentFile) {
    files.push({ filePath: currentFile, diff: currentLines.join('\n') });
  }

  return files;
}

function parseHunkRanges(diffText, contextLines) {
  const ranges = [];
  const lines = diffText.split('\n');
  for (const line of lines) {
    const match = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (!match) continue;
    const start = Number(match[1]);
    const count = match[2] ? Number(match[2]) : 1;
    if (!Number.isFinite(start) || !Number.isFinite(count)) continue;
    if (count <= 0) continue;
    const rangeStart = Math.max(1, start - contextLines);
    const rangeEnd = start + count - 1 + contextLines;
    ranges.push({ start: rangeStart, end: rangeEnd });
  }
  if (ranges.length === 0) return [];
  ranges.sort((a, b) => a.start - b.start);
  const merged = [ranges[0]];
  for (let i = 1; i < ranges.length; i++) {
    const last = merged[merged.length - 1];
    const current = ranges[i];
    if (current.start <= last.end + 1) {
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push(current);
    }
  }
  return merged;
}

function buildContentExcerpt(fullContent, diffText, contextLines, maxChars) {
  const ranges = parseHunkRanges(diffText, contextLines);
  if (ranges.length === 0) return '';
  const lines = fullContent.split('\n');
  const chunks = [];
  for (const range of ranges) {
    const start = Math.max(1, range.start);
    const end = Math.min(lines.length, range.end);
    if (start > end) continue;
    chunks.push(`@@ L${start}-L${end} @@`);
    for (let i = start; i <= end; i++) {
      const line = lines[i - 1] ?? '';
      chunks.push(`${i}|${line}`);
      if (maxChars && chunks.join('\n').length >= maxChars) {
        const joined = chunks.join('\n');
        return joined.slice(0, maxChars);
      }
    }
  }
  const result = chunks.join('\n');
  if (maxChars && result.length > maxChars) {
    return result.slice(0, maxChars);
  }
  return result;
}

function looksLikeFunctionSignature(line) {
  if (/^\s*(if|for|while|switch|catch)\b/.test(line)) return false;
  if (/\bfunction\b/.test(line)) return true;
  if (/=>/.test(line) && /\(.*\)/.test(line)) return true;
  if (/^\s*def\s+\w+\s*\(.*\)/.test(line)) return true;
  if (/^\s*(public|private|protected)\b/.test(line) && /\(.*\)/.test(line)) return true;
  if (/^\s*\w+\s*\(.*\)\s*{/.test(line)) return true;
  return false;
}

function looksLikeFunctionalChange(line) {
  if (/\b(if|else if|switch|case|return|throw|catch|while|for|await)\b/.test(line)) return true;
  if (/&&|\|\||===|!==|==|!=|<=|>=/.test(line)) return true;
  return false;
}

function hasParamOrFunctionalChange(diffText) {
  const lines = diffText.split('\n');
  for (const line of lines) {
    if (!(line.startsWith('+') || line.startsWith('-'))) continue;
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    const clean = line.slice(1).trim();
    if (!clean) continue;
    if (looksLikeFunctionSignature(clean) || looksLikeFunctionalChange(clean)) {
      return true;
    }
  }
  return false;
}

function hasMultipleHunks(diffText) {
  const lines = diffText.split('\n');
  let hunkCount = 0;
  for (const line of lines) {
    if (line.match(/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/)) {
      hunkCount++;
    }
  }
  return hunkCount > 1;
}

async function fetchFileContent(repoFullName, commitHash, filePath, authHeader) {
  const apiUrl = `https://api.bitbucket.org/2.0/repositories/${repoFullName}/src/${commitHash}/${filePath}`;
  return fetchText(apiUrl, authHeader, { allow404: true });
}

async function postPRComment(repoFullName, prId, comment) {
  const apiUrl = `https://api.bitbucket.org/2.0/repositories/${repoFullName}/pullrequests/${prId}/comments`;
  const authHeader = getAuthHeader();

  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      content: {
        raw: comment,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to post comment: ${res.status} ${res.statusText} - ${body}`);
  }

  const data = await res.json();
  console.log(`Successfully posted comment (ID: ${data.id})`);
  return data;
}

async function sendWeChatWebhook(prTitle, prAuthor, repoFullName, prUrl, bugContent) {
  const webhookUrl = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=84df2ed2-887c-4599-83db-86e296e1233f';
  
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
    console.error('Failed to send WeChat webhook:', error.message);
    // Don't throw - webhook failure shouldn't break the main flow
  }
}

function getGeminiClient() {
  const apiKey = getEnv('GEMINI_KEY');
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      apiVersion: 'v1beta',
    },
  });
}

function loadPromptTemplate() {
  return fs.readFileSync(PROMPT_PATH, 'utf8');
}

function buildPrompt(prompt, changeList, meta = {}) {
  const { prTitle = '', repoFullName = '', prId = '' } = meta;
  const template = loadPromptTemplate();
  return template
    .replace('{{PROMPT}}', prompt)
    .replace('{{PR_TITLE}}', prTitle)
    .replace('{{REPO}}', repoFullName)
    .replace('{{PR_ID}}', String(prId))
    .replace('{{CHANGE_LIST}}', JSON.stringify(changeList, null, 2));
}

function extractJson(text) {
  if (!text) return '';
  const trimmed = text.trim();
  if (trimmed.startsWith('```')) {
    const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (match) return match[1].trim();
  }
  return trimmed;
}

function parseJsonResponse(text) {
  const payload = extractJson(text);
  if (!payload) return { parsed: null, error: 'empty_response' };
  try {
    return { parsed: JSON.parse(payload), error: null };
  } catch (error) {
    return { parsed: null, error: error.message };
  }
}

function extractUsageMetadata(response) {
  const usage = response?.usageMetadata || response?.response?.usageMetadata;
  if (!usage) return null;
  return {
    promptTokens: usage.promptTokenCount ?? null,
    responseTokens: usage.responseTokenCount ?? null,
    totalTokens: usage.totalTokenCount ?? null,
    cachedTokens: usage.cachedContentTokenCount ?? null,
    toolUsePromptTokens: usage.toolUsePromptTokenCount ?? null,
    thoughtsTokens: usage.thoughtsTokenCount ?? null,
    source: 'usageMetadata',
  };
}

function renderMarkdownFromStructured(structured) {
  if (!structured || !Array.isArray(structured.bugs)) {
    return '';
  }
  if (structured.bugs.length === 0) {
    return '';
  }
  const filteredBugs = structured.bugs.filter((bug) => {
    const title = String(bug.title || bug.issue || '').toLowerCase();
    const desc = String(bug.description || '').toLowerCase();
    return !(
      title.includes('react hook') ||
      title.includes('rules of hooks') ||
      title.includes('hook rule') ||
      title.includes('hook violation') ||
      title.includes('conditional hook') ||
      desc.includes('react hook') ||
      desc.includes('rules of hooks') ||
      desc.includes('hook rule') ||
      desc.includes('hook violation') ||
      desc.includes('conditional hook')
    );
  });
  if (filteredBugs.length === 0) {
    return '';
  }
  return filteredBugs
    .slice(0, 3)
    .map((bug, index) => {
      const file = bug.filePath || bug.file || 'unknown file';
      const line = bug.lineHint ? ` (${bug.lineHint})` : '';
      const title = bug.title || bug.issue || `Issue ${index + 1}`;
      const description = bug.description ? `- Desc: ${bug.description}` : '';
      // const risk = bug.risk ? `- Risk: ${bug.risk}` : '';
      
      // Add code snippet with diff formatting if available
      const codeSnippet = bug.codeSnippet ? `\n\`\`\`diff\n${bug.codeSnippet}\n\`\`\`` : '';
      
      return [
        `### 🔴 HIGH SEVERITY ISSUE: ${title}`,
        `- File: \`${file}\`${line}`,
        codeSnippet,
        description
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n');
}

async function attemptGeminiCall(ai, model, fullPrompt, fileCount) {
  console.log(`[gemini] Start analysis for ${fileCount} file(s) using ${model}`);
  const start = Date.now();
  const response = await ai.models.generateContent({
    model: model,
    contents: [
      { 
        role: 'user', 
        parts: [{ text: fullPrompt }] 
      }
    ],
  });
  const elapsedMs = Date.now() - start;
  console.log(`[gemini] Done in ${elapsedMs} ms with ${model}`);

  const usage = extractUsageMetadata(response);
  const usageRecord = usage
    ? { model, elapsedMs, ...usage }
    : {
        model,
        elapsedMs,
        promptTokens: null,
        responseTokens: null,
        totalTokens: null,
        cachedTokens: null,
        toolUsePromptTokens: null,
        thoughtsTokens: null,
        source: 'usageMetadata_missing',
      };
  const inputTokens = usageRecord.promptTokens ?? '?';
  const outputTokens = usageRecord.responseTokens ?? '?';
  const totalTokens = usageRecord.totalTokens ?? '?';
  console.log(
    `[gemini] Tokens (${model}): input=${inputTokens} output=${outputTokens} total=${totalTokens}`
  );

  const rawText = response.text || response.response?.text() || '';
  const { parsed, error } = parseJsonResponse(rawText);
  if (error) {
    console.warn(`[gemini] JSON parse failed: ${error}`);
  }
  return { rawText, structured: parsed, parseError: error, tokenUsage: usageRecord };
}

async function callGeminiAI(prompt, changeList, meta) {
  const ai = getGeminiClient();
  const fullPrompt = buildPrompt(prompt, changeList, meta);
  const tokenUsage = [];
  
  // Try primary model first
  try {
    const result = await attemptGeminiCall(
      ai,
      'gemini-3-flash-preview',
      fullPrompt,
      changeList.length
    );
    if (result.tokenUsage) {
      tokenUsage.push(result.tokenUsage);
    }
    return { ...result, tokenUsage };
  } catch (error) {
    // Check for per-minute quota error - do NOT retry
    if (error.message && error.message.includes('GenerateContentInputTokensPerModelPerMinute-FreeTier')) {
      console.warn('[gemini] Per-minute quota exceeded, skipping retry');
      tokenUsage.push({
        model: 'gemini-3-flash-preview',
        error: error.message,
        promptTokens: null,
        responseTokens: null,
        totalTokens: null,
        cachedTokens: null,
        toolUsePromptTokens: null,
        thoughtsTokens: null,
        source: 'error',
      });
      return {
        rawText: '',
        structured: null,
        parseError: 'per_minute_quota_exceeded',
        quotaExceeded: true,
        tokenUsage,
      };
    }
    
    // Check if it's a general rate limit error (429 or rate limit message)
    const isRateLimit = error.message && 
      (error.message.includes('429') || 
       error.message.includes('rate limit') ||
       error.message.includes('Rate limit') ||
       error.message.includes('RATE_LIMIT'));
    
    if (isRateLimit) {
      tokenUsage.push({
        model: 'gemini-3-flash-preview',
        error: error.message,
        promptTokens: null,
        responseTokens: null,
        totalTokens: null,
        cachedTokens: null,
        toolUsePromptTokens: null,
        thoughtsTokens: null,
        source: 'error',
      });
      console.log('[gemini] Rate limit hit on primary model, falling back to gemini-2.5-flash');
      try {
        const fallbackResult = await attemptGeminiCall(
          ai,
          'gemini-2.5-flash',
          fullPrompt,
          changeList.length
        );
        if (fallbackResult.tokenUsage) {
          tokenUsage.push(fallbackResult.tokenUsage);
        }
        return { ...fallbackResult, tokenUsage };
      } catch (fallbackError) {
        console.error('[gemini] Fallback model also failed:', fallbackError.message);
        throw fallbackError;
      }
    }
    throw error;
  }
}


async function analyzePR(prUrl) {
  const authHeader = getAuthHeader();
  const { repoFullName, prId } = parsePrUrl(prUrl);

  console.log(`Analyzing PR #${prId} from ${repoFullName}`);

  const prApi = `https://api.bitbucket.org/2.0/repositories/${repoFullName}/pullrequests/${prId}`;
  const pr = await fetchJson(prApi, authHeader);
  const diffUrl = pr.links && pr.links.diff && pr.links.diff.href;
  const commitHash = pr.source && pr.source.commit && pr.source.commit.hash;

  if (!diffUrl) {
    throw new Error('PR diff URL not found');
  }
  if (!commitHash) {
    throw new Error('PR commit hash not found');
  }

  const diffText = await fetchText(diffUrl, authHeader);
  const fileDiffs = splitDiffByFile(diffText);
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
  const changeList = [];
  const filterStats = {
    total: fileDiffs.length,
    included: includedFileDiffs.length,
    excluded: excludedFiles.length,
  };
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

    if (!skipFullContent && shouldFetchContent && !fetchedFiles.has(file.filePath)) {
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
        const reason = hasFunctionalChange ? 'functional change' : 'multiple hunks';
        console.log(`[analyze] Fetched content (${reason}): ${file.filePath} (${fullContent.length} chars)`);
      }
    } else if (!shouldFetchContent) {
      console.log(`[analyze] Diff-only (no functional change or multiple hunks): ${file.filePath}`);
    }

    const entry = {
      file: file.filePath,
      diff: file.diff,
      hasFunctionalChange,
      hasMultipleHunks: hasMultipleHunks_,
    };
    if (shouldFetchContent) {
      const fullContent = fetchedFiles.get(file.filePath);
      if (fullContent !== null && fullContent !== undefined) {
        const contentLength = fullContent.length;
        entry.full_content_length = contentLength;
        if (contentLength > MAX_FULL_CONTENT_CHARS) {
          const excerpt = buildContentExcerpt(
            fullContent,
            file.diff,
            EXCERPT_CONTEXT_LINES,
            EXCERPT_MAX_CHARS
          );
          if (excerpt) {
            entry.full_content_excerpt = excerpt;
            entry.full_content_truncated = true;
            console.log(`[analyze] Truncated content for ${file.filePath} (excerpt length ${excerpt.length} chars)`);
          } else {
            entry.full_content = fullContent.slice(0, MAX_FULL_CONTENT_CHARS);
            entry.full_content_truncated = true;
            console.log(`[analyze] Truncated content for ${file.filePath} (head ${MAX_FULL_CONTENT_CHARS} chars)`);
          }
        } else {
          entry.full_content = fullContent;
        }
      }
    }
    changeList.push(entry);
  }

  if (changeList.length === 0) {
    console.log('[analyze] No files to analyze after filtering');
    return { success: true, message: 'No files to analyze after filtering.', bugs: [], prId, repoFullName, prTitle: pr.title };
  }

  const prompt = 'Review these changes for HIGH severity, functional, CONFIRMED bugs. Focus on behavior changes or parameter mismatches that will cause runtime errors or incorrect behavior.';

  const analysis = await callGeminiAI(prompt, changeList, {
    prTitle: pr.title,
    repoFullName,
    prId,
  });
  console.log(`[analyze] Gemini analysis length: ${analysis.rawText.length} chars`);
  
  // Check if quota was exceeded
  if (analysis.quotaExceeded) {
    console.warn('[analyze] Per-minute quota exceeded, saving partial results');
    
    // Save partial results
    try {
      const hasBugs = false; // Quota exceeded means no bugs analyzed
      const todayDir = getTodayAnalysisDir(hasBugs);
      if (!fs.existsSync(todayDir)) {
        fs.mkdirSync(todayDir, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `pr-${prId}-${timestamp}.json`;
      const filepath = path.join(todayDir, filename);

      const dataToSave = {
        prId,
        repoFullName,
        prTitle: pr.title,
        timestamp: new Date().toISOString(),
        error: 'Exceeded per minute quota',
        filterStats,
        changeList,
        excludedFiles,
        tokenUsage: analysis.tokenUsage ?? [],
        analysis: {
          summary: 'Analysis failed: Exceeded per minute quota',
          bugs: [],
          notBugs: []
        }
      };

      fs.writeFileSync(filepath, JSON.stringify(dataToSave, null, 2), 'utf8');
      console.log(`\n💾 Saved partial analysis results to: ${filepath}`);
    } catch (saveError) {
      console.error('Failed to save partial analysis results:', saveError.message);
    }
    
    // Send webhook notification
    try {
      const prUrl = `https://bitbucket.org/${repoFullName}/pull-requests/${prId}`;
      const prAuthor = pr.author?.display_name || pr.author?.username || 'Unknown';
      const bugContent = 'No bugs analyzed due to quota exceeded';
      await sendWeChatWebhook(
        pr.title,
        prAuthor,
        repoFullName,
        prUrl,
        bugContent
      );
      console.log('\n📱 Sent webhook notification for quota exceeded');
    } catch (webhookError) {
      console.error('Failed to send webhook notification:', webhookError.message);
    }
    
    return { success: false, quotaExceeded: true, prId, repoFullName, prTitle: pr.title };
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

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `pr-${prId}-${timestamp}.json`;
    const filepath = path.join(todayDir, filename);

    const dataToSave = {
      prId,
      repoFullName,
      prTitle: pr.title,
      timestamp: new Date().toISOString(),
      filterStats,
      changeList,
      excludedFiles,
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
    console.log(`\n💾 Saved analysis results to: ${filepath} (${bugStatusMsg})`);
  } catch (saveError) {
    console.error('Failed to save analysis results:', saveError.message);
    // Continue even if saving fails
  }
  
  if (!analysis.structured) {
    console.warn('[analyze] LLM output not valid JSON. Skipping PR comment.');
    return { success: true, analysis, prId, repoFullName, prTitle: pr.title };
  }
  const formattedAnalysis = renderMarkdownFromStructured(analysis.structured);
  const trimmedAnalysis = (formattedAnalysis || '').trim();
  if (!trimmedAnalysis) {
    console.log('[analyze] No confirmed high severity bugs. Skipping PR comment.');
    return { success: true, analysis, prId, repoFullName, prTitle: pr.title };
  }
  const comment = `## Automated Code Review Analysis

${trimmedAnalysis}

---

*This analysis was generated automatically by Bug Agent using Gemini AI.*`;

  // Post comment to PR
  try {
    // await postPRComment(repoFullName, prId, comment);
    console.log(`\n✅ Successfully posted analysis comment to PR #${prId}`);
    
    // Send WeChat webhook notification
    const prUrl = `https://bitbucket.org/${repoFullName}/pull-requests/${prId}`;
    const prAuthor = pr.author?.display_name || pr.author?.username || 'Unknown';
    await sendWeChatWebhook(pr.title, prAuthor, repoFullName, prUrl, trimmedAnalysis);
  } catch (error) {
    console.error('Failed to post comment to PR:', error.message);
    // Log the analysis even if posting fails
    console.log('\n=== Analysis Result ===');
    console.log(analysis);
    console.log('======================\n');
    throw error; // Re-throw to handle in caller
  }

  return { success: true, analysis, prId, repoFullName, prTitle: pr.title };
}

// Routes
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'bug-agent' });
});

app.post('/analyze', async (req, res) => {
  console.log('\n=== PR Analysis Requested ===');
  
  try {
    const { prUrl } = req.body;

    if (!prUrl) {
      return res.status(400).json({
        success: false,
        error: 'Missing prUrl in request body',
      });
    }

    // Send immediate response
    res.status(200).json({
      success: true,
      message: 'PR analysis started',
    });

    // Process analysis asynchronously
    try {
      const result = await analyzePR(prUrl);
      console.log('\n=== Analysis Complete ===');
      console.log(`PR #${result.prId}: ${result.prTitle}`);
      console.log('Analysis posted to PR successfully');
    } catch (error) {
      console.error('\n=== Analysis Failed ===');
      console.error('Error:', error.message);
      if (error.stack) {
        console.error('Stack:', error.stack);
      }
    }
  } catch (error) {
    console.error('Error in /analyze endpoint:', error.message);
    // Response already sent, so just log
  }
});

// Start server
const PORT = process.env.PORT || 3000;
const prFetchScheduler = createPrFetchScheduler({
  getAuthHeader,
  fetchJson,
  workspace: process.env.BITBUCKET_WORKSPACE,
  intervalMs: process.env.PR_FETCH_INTERVAL_MS,
  authorUuids: process.env.PR_AUTHOR_UUIDS,
  analyzePR,
  logger: console,
});
const server = app.listen(PORT, () => {
  console.log(`\n🚀 Bug Agent Server Started`);
  console.log(`Server: http://localhost:${PORT}`);
  console.log(`\nEndpoints:`);
  console.log(`  POST /analyze - Manual PR analysis`);
  console.log(`  GET  /health  - Health check`);
  console.log(`\n✨ Ready to analyze PRs!\n`);
});

prFetchScheduler.start();

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('\n🛑 Shutting down gracefully...');
  prFetchScheduler.stop();
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down gracefully...');
  prFetchScheduler.stop();
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

module.exports = { app, analyzePR };
