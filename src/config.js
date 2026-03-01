"use strict";

const path = require("path");

const PROMPT_PATH = path.join(__dirname, "..", "prompt.txt");
const MAX_FULL_CONTENT_CHARS = 4000;
const EXCERPT_CONTEXT_LINES = 25;
const EXCERPT_MAX_CHARS = 6000;
const MAX_FILES_FOR_FULL_CONTENT = 25;
const MOONSHOT_BASE_URL = "https://api.moonshot.cn/v1";
const MOONSHOT_MODEL = "kimi-k2.5";
const MOONSHOT_TEMPERATURE = 1; // only 1 is allowed for kimi-k2.5
const IGNORED_REPOS = new Set(["smart_eco-platform/api-integration-aws"]);
const INPUT_RATE_LIMIT_FILE_THRESHOLD = 30;
const COMMENT_AUTHOR_UUID = "{5e1bd749-f9a6-49a1-a580-afadbe72fc5b}";

function getEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set`);
  }
  return value;
}

function getAuthHeader() {
  const email = getEnv("BITBUCKET_EMAIL");
  const token = getEnv("BITBUCKET_API_TOKEN");
  const creds = Buffer.from(`${email}:${token}`).toString("base64");
  return `Basic ${creds}`;
}

function isIgnoredRepo(repoFullName) {
  return IGNORED_REPOS.has(String(repoFullName || "").trim());
}

function shouldSkipInputRateLimit(includedFileCount) {
  return includedFileCount > INPUT_RATE_LIMIT_FILE_THRESHOLD;
}

module.exports = {
  PROMPT_PATH,
  MAX_FULL_CONTENT_CHARS,
  EXCERPT_CONTEXT_LINES,
  EXCERPT_MAX_CHARS,
  MAX_FILES_FOR_FULL_CONTENT,
  MOONSHOT_BASE_URL,
  MOONSHOT_MODEL,
  MOONSHOT_TEMPERATURE,
  COMMENT_AUTHOR_UUID,
  getEnv,
  getAuthHeader,
  isIgnoredRepo,
  shouldSkipInputRateLimit,
};
