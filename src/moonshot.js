"use strict";

const fs = require("fs");
const OpenAI = require("openai");
const {
  PROMPT_PATH,
  MOONSHOT_BASE_URL,
  MOONSHOT_MODEL,
  MOONSHOT_TEMPERATURE,
  getEnv,
} = require("./config");

function getMoonshotClient() {
  const apiKey = getEnv("MOON_SHOT_KEY");
  return new OpenAI({
    apiKey,
    baseURL: MOONSHOT_BASE_URL,
  });
}

function loadPromptTemplate() {
  return fs.readFileSync(PROMPT_PATH, "utf8");
}

function buildPrompt(prompt, changeList, meta = {}) {
  const { prTitle = "", repoFullName = "", prId = "" } = meta;
  const template = loadPromptTemplate();
  return template
    .replace("{{PROMPT}}", prompt)
    .replace("{{PR_TITLE}}", prTitle)
    .replace("{{REPO}}", repoFullName)
    .replace("{{PR_ID}}", String(prId))
    .replace("{{CHANGE_LIST}}", JSON.stringify(changeList, null, 2));
}

function extractJson(text) {
  if (!text) return "";
  const trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (match) return match[1].trim();
  }
  return trimmed;
}

function parseJsonResponse(text) {
  const payload = extractJson(text);
  if (!payload) return { parsed: null, error: "empty_response" };
  try {
    return { parsed: JSON.parse(payload), error: null };
  } catch (error) {
    return { parsed: null, error: error.message };
  }
}

function extractUsageMetadata(response) {
  const usage = response?.usage;
  if (!usage) return null;
  return {
    promptTokens: usage.prompt_tokens ?? null,
    responseTokens: usage.completion_tokens ?? null,
    totalTokens: usage.total_tokens ?? null,
    cachedTokens: usage.cached_tokens ?? null,
    toolUsePromptTokens: usage.prompt_tokens_details?.cached_tokens ?? null,
    thoughtsTokens: usage.completion_tokens_details?.reasoning_tokens ?? null,
    source: "usage",
  };
}

async function attemptMoonshotCall(client, model, fullPrompt, fileCount) {
  console.log(
    `[moonshot] Start analysis for ${fileCount} file(s) using ${model}`
  );
  const start = Date.now();
  const response = await client.chat.completions.create({
    model,
    messages: [{ role: "user", content: fullPrompt }],
    temperature: MOONSHOT_TEMPERATURE,
  });
  const elapsedMs = Date.now() - start;
  console.log(`[moonshot] Done in ${elapsedMs} ms with ${model}`);

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
        source: "usage_missing",
      };
  const inputTokens = usageRecord.promptTokens ?? "?";
  const outputTokens = usageRecord.responseTokens ?? "?";
  const totalTokens = usageRecord.totalTokens ?? "?";
  console.log(
    `[moonshot] Tokens (${model}): input=${inputTokens} output=${outputTokens} total=${totalTokens}`
  );

  const rawText = response?.choices?.[0]?.message?.content ?? "";
  const { parsed, error } = parseJsonResponse(rawText);
  if (error) {
    console.warn(`[moonshot] JSON parse failed: ${error}`);
  }
  return {
    rawText,
    structured: parsed,
    parseError: error,
    tokenUsage: usageRecord,
  };
}

async function callMoonshotAI(prompt, changeList, meta) {
  const client = getMoonshotClient();
  const fullPrompt = buildPrompt(prompt, changeList, meta);
  const tokenUsage = [];

  try {
    const result = await attemptMoonshotCall(
      client,
      MOONSHOT_MODEL,
      fullPrompt,
      changeList.length
    );
    if (result.tokenUsage) {
      tokenUsage.push(result.tokenUsage);
    }
    return { ...result, tokenUsage };
  } catch (error) {
    const status = error?.status || error?.response?.status;
    const message = error?.message || "";
    const isRateLimit =
      status === 429 ||
      message.includes("429") ||
      message.includes("rate limit") ||
      message.includes("Rate limit") ||
      message.includes("RATE_LIMIT");

    if (isRateLimit) {
      tokenUsage.push({
        model: MOONSHOT_MODEL,
        elapsedMs: null,
        promptTokens: null,
        responseTokens: null,
        totalTokens: null,
        cachedTokens: null,
        toolUsePromptTokens: null,
        thoughtsTokens: null,
        source: "error",
      });
      console.warn("[moonshot] Rate limit hit, skipping retry");
      return {
        rawText: "",
        structured: null,
        parseError: "rate_limit",
        quotaExceeded: true,
        tokenUsage,
      };
    }
    throw error;
  }
}

module.exports = {
  callMoonshotAI,
};
